import React, { useEffect, useRef, useState } from "react";
import Sidebar from "../Sidebar/Sidebar";
import ChatWindow from "../ChatWindow/ChatWindow";
import CustomerSidebar from "../RoleViews/CustomerSidebar";
import SupplierSidebar from "../RoleViews/SupplierSidebar";
import EngineerSidebar from "../RoleViews/EngineerSidebar";

import { getUserProfile, getAccessToken } from "../../AWS/auth";
import { CHAT_CONFIG } from "../../Config/ChatConfig";
import {
  saveSessionState,
  loadSessionState,
  clearSessionState,
} from "../../utils/Sessionstorage";
import {
  initialiseChat,
  syncChatSession,
  renameChat,
  createSession,
} from "../../api/api-config";

import "./Chat.css";

const cleanupTempSessionFromStorage = () => {
  try {
    const raw = localStorage.getItem("chat-session-state");
    if (!raw) return;

    const parsed = JSON.parse(raw);
    if (parsed?.activeSessionId?.startsWith("temp-")) {
      console.warn("Removing stale temp session from storage");
      localStorage.removeItem("chat-session-state");
    }
  } catch (e) {
    console.warn("Failed to cleanup session storage", e);
    localStorage.removeItem("chat-session-state");
  }
};

const normalizeSessionsPayload = (data) => {
  if (
    data?.groupedSessions?.myAssistant ||
    data?.groupedSessions?.customerRequest ||
    data?.groupedSessions?.supplierTask ||
    data?.groupedSessions?.requests ||
    data?.groupedSessions?.tasks
  ) {
    return {
      requests:
        data.groupedSessions.requests ||
        data.groupedSessions.customerRequest ||
        [],
      tasks:
        data.groupedSessions.tasks || data.groupedSessions.supplierTask || [],
      groupedSessions: {
        myAssistant: data.groupedSessions.myAssistant || [],
        customerRequest:
          data.groupedSessions.customerRequest ||
          data.groupedSessions.requests ||
          [],
        supplierTask:
          data.groupedSessions.supplierTask ||
          data.groupedSessions.tasks ||
          [],
      },
    };
  }

  if (data?.sessions?.requests || data?.sessions?.tasks) {
    return {
      requests: data.sessions.requests || [],
      tasks: data.sessions.tasks || [],
      groupedSessions: {
        myAssistant: [],
        customerRequest: data.sessions.requests || [],
        supplierTask: data.sessions.tasks || [],
      },
    };
  }

  if (Array.isArray(data?.sessions)) {
    const arr = data.sessions;
    const requests = [];
    const tasks = [];

    arr.forEach((s) => {
      const st = (s?.sessionType || "").toLowerCase();
      const sid = s?.sessionId;
      if (st === "request" || sid === "default-chat") requests.push(s);
      else tasks.push(s);
    });

    return {
      requests,
      tasks,
      groupedSessions: {
        myAssistant: [],
        customerRequest: requests,
        supplierTask: tasks,
      },
    };
  }

  return {
    requests: [],
    tasks: [],
    groupedSessions: {
      myAssistant: [],
      customerRequest: [],
      supplierTask: [],
    },
  };
};

const hasValidFormState = (state) => {
  if (!state || typeof state !== "object") return false;
  if (Array.isArray(state?.fields) && state.fields.length > 0) return true;

  const keys = [
    "CustomerName",
    "CustomerPartName",
    "CustomerPartNumber",
    "RequestDescription",
    "RequestCompletionDate",
    "RequestPriority",
  ];

  return keys.some(
    (k) =>
      state?.[k] !== undefined &&
      state?.[k] !== null &&
      String(state?.[k]).trim() !== ""
  );
};

const normalizeFormState = (state) => {
  return hasValidFormState(state) ? state : null;
};

// Performance branch realtime POC.
// Keep a fallback URL so localhost works even before Amplify/env config is updated.
const WEBSOCKET_URL = (
  import.meta.env.VITE_WEBSOCKET_URL ||
  "wss://pmtwm0gzsk.execute-api.ap-south-1.amazonaws.com/dev"
).replace(/\/$/, "");

const buildMessagesSignature = (items = []) => {
  if (!Array.isArray(items) || !items.length) return "empty";

  return items
    .map((m) => {
      const id = m?.id || "";
      const role = m?.role || m?.sender || "";
      const text =
        typeof m?.text === "string"
          ? m.text
          : typeof m?.content === "string"
          ? m.content
          : Array.isArray(m?.content) && m.content[0]?.text
          ? m.content[0].text
          : "";

      const artifactType = m?.artifact?.type || m?.Artifact?.type || "";
      const taskStatus = m?.taskStatus || m?.TaskStatus || "";

      return `${id}|${role}|${artifactType}|${taskStatus}|${String(text).slice(-180)}`;
    })
    .join("||");
};

const buildMessageMergeKey = (message = {}) => {
  const role = String(message?.role || message?.sender || "").trim();
  const text =
    typeof message?.text === "string"
      ? message.text
      : typeof message?.content === "string"
      ? message.content
      : Array.isArray(message?.content) && message.content[0]?.text
      ? message.content[0].text
      : "";

  const timestamp = String(
    message?.timestamp ||
      message?.createdAt ||
      message?.Timestamp ||
      message?.CreatedAt ||
      ""
  ).trim();

  const artifactType = String(
    message?.artifact?.type ||
      message?.Artifact?.type ||
      message?.eventType ||
      message?.EventType ||
      ""
  ).trim();

  return `${role}|${timestamp}|${artifactType}|${String(text).trim()}`;
};

const mergeUniqueMessages = (currentMessages = [], incomingMessages = []) => {
  const merged = Array.isArray(currentMessages) ? [...currentMessages] : [];
  const seen = new Set(merged.map(buildMessageMergeKey));

  for (const message of Array.isArray(incomingMessages) ? incomingMessages : []) {
    const key = buildMessageMergeKey(message);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(message);
  }

  return merged;
};

const isRequestMonitoringSessionId = (sessionId) => {
  const sid = String(sessionId || "").trim().toLowerCase();

  return (
    sid === "request monitoring & status" ||
    sid.includes("request monitoring") ||
    sid.includes("monitoring & status")
  );
};

const isAutoRefreshEligibleSession = (sessionId) => {
  const sid = String(sessionId || "").trim().toLowerCase();

  if (!sid) return false;
  if (sid.startsWith("temp-")) return false;
  if (sid === "default-chat") return false;
  if (sid === "new customer request") return false;
  if (sid === "new supplier request") return false;
  if (isRequestMonitoringSessionId(sid)) return false;

  return true;
};

// Engineering users should land on the Customer Request Assistant instead of
// automatically opening the newest/topmost business request.
const findCustomerRequestHelperSessionId = (normalizedSessions = {}) => {
  const assistantList = normalizedSessions?.groupedSessions?.myAssistant || [];

  const helper = assistantList.find((item) => {
    const title = String(item?.title || "").trim().toLowerCase();
    const sessionId = String(item?.sessionId || "").trim().toLowerCase();
    const sessionType = String(
      item?.sessionType || item?.SessionType || item?.kcSessionType || ""
    )
      .trim()
      .toLowerCase();

    return (
      sessionId === "new customer request" ||
      (sessionType === "my assistant" && title === "customer request")
    );
  });

  return helper?.sessionId || "New Customer Request";
};


const Chat = ({ theme, toggleTheme, onLogout }) => {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [user, setUser] = useState(null);
  const [sessions, setSessions] = useState({
    requests: [],
    tasks: [],
    groupedSessions: {
      myAssistant: [],
      customerRequest: [],
      supplierTask: [],
    },
  });
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [sessionMessagesMap, setSessionMessagesMap] = useState({});
  const [loadingSessionId, setLoadingSessionId] = useState(null);
  const [showIdleWarning, setShowIdleWarning] = useState(false);
  const [idleSecondsLeft, setIdleSecondsLeft] = useState(null);
  const [formStateMap, setFormStateMap] = useState({});
  const [formDirtyMap, setFormDirtyMap] = useState({});

  // Agent Mode is removed from the UI.
  // Keep frontend fixed to normal /chat mode so old localStorage cannot call /agentcore-chat.
  const agentMode = false;

  const activeSessionIdRef = useRef(activeSessionId);
  const userEmailRef = useRef("");
  const messagesRef = useRef(messages);
  const formDirtyMapRef = useRef(formDirtyMap);

  // Background request preloading:
  // keep a live cache ref so the preload queue can skip sessions that are
  // already available without forcing request navigation or UI changes.
  const sessionMessagesMapRef = useRef(sessionMessagesMap);
  const backgroundPreloadQueueRef = useRef([]);
  const backgroundPreloadQueuedIdsRef = useRef(new Set());
  const backgroundPreloadInFlightIdsRef = useRef(new Set());
  const backgroundPreloadRunningRef = useRef(false);

  // Reuse an in-flight /initialise request for the same user and session.
  // This prevents rapid clicks from sending the same request at the same time.
  const initialiseRequestsRef = useRef(new Map());

  // Delta-sync state is tracked per session.
  const syncCursorMapRef = useRef({});
  const syncRequestVersionMapRef = useRef({});
  const realtimeSyncRequestsRef = useRef(new Map());

  // User-scoped WebSocket:
  // - one live socket per logged-in browser/user
  // - request changes travel as message payloads
  // - non-active requests are marked dirty and synced when opened
  const realtimeDirtySessionsRef = useRef(new Set());
  const runRealtimeSyncRef = useRef(null);

  const role = String(user?.profile || user?.role || "")
    .toLowerCase()
    .trim();
  const isEngineer = role === "engineering";
  const isCustomer = role === "customer";
  const isSupplier = role === "supplier";
  const isRoleBasedView = isEngineer || isCustomer || isSupplier;

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  useEffect(() => {
    userEmailRef.current = user?.email || "";
  }, [user?.email]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    sessionMessagesMapRef.current = sessionMessagesMap;
  }, [sessionMessagesMap]);

  useEffect(() => {
    formDirtyMapRef.current = formDirtyMap;
  }, [formDirtyMap]);

  useEffect(() => {
    localStorage.setItem("agentMode", "false");
  }, []);

  const initialiseChatDeduped = (token, email, sessionId = null) => {
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const normalizedSessionId =
      sessionId === null || sessionId === undefined
        ? "__initial__"
        : String(sessionId).trim();

    const requestKey = `${normalizedEmail}::${normalizedSessionId}`;
    const existingRequest = initialiseRequestsRef.current.get(requestKey);

    if (existingRequest) {
      return existingRequest;
    }

    const request = initialiseChat(token, email, sessionId);
    initialiseRequestsRef.current.set(requestKey, request);

    const clearRequest = () => {
      if (initialiseRequestsRef.current.get(requestKey) === request) {
        initialiseRequestsRef.current.delete(requestKey);
      }
    };

    request.then(clearRequest, clearRequest);

    return request;
  };

  const rememberSyncState = (sessionId, data = {}) => {
    if (!sessionId) return;

    const cursor = String(data?.syncCursor || data?.cursor || "").trim();
    const requestVersion = String(
      data?.syncRequestVersion || data?.requestVersion || ""
    ).trim();

    if (cursor) {
      syncCursorMapRef.current[sessionId] = cursor;
    }

    if (requestVersion) {
      syncRequestVersionMapRef.current[sessionId] = requestVersion;
    }
  };

  const normalizeMessages = (rawMessages = []) =>
    rawMessages.map((m, i) => {
      let text = "";

      if (typeof m?.content === "string") {
        text = m.content;
      } else if (Array.isArray(m?.content) && m.content[0]?.text) {
        text = m.content[0].text;
      } else if (typeof m?.text === "string") {
        text = m.text;
      }

      const attachmentsRaw = m.attachments ?? m.Attachments ?? [];
      const attachments = Array.isArray(attachmentsRaw) ? attachmentsRaw : [];

      return {
        id: m.id || `msg-${i}`,
        sender: m.sender || (m.role === "assistant" ? "bot" : "user"),
        role: m.role || (m.sender === "bot" ? "assistant" : "user"),
        text,
        content: m.content ?? text,
        attachments,
        artifact: m.artifact || m.Artifact || null,
        supplierTask: m.supplierTask || m.SupplierTask || null,
        taskId: m.taskId || m.TaskId || "",
        taskStatus: m.taskStatus || m.TaskStatus || "",
        sessionType: m.sessionType || m.SessionType || "",
        // Preserve the real backend message time so ChatWindow can render
        // WhatsApp-style timestamps without inventing a new time on refresh.
        timestamp:
          m.timestamp ||
          m.Timestamp ||
          m.createdAt ||
          m.CreatedAt ||
          m.messageTimestamp ||
          m.MessageTimestamp ||
          m.sentAt ||
          m.SentAt ||
          "",
        createdAt:
          m.createdAt ||
          m.CreatedAt ||
          m.timestamp ||
          m.Timestamp ||
          m.messageTimestamp ||
          m.MessageTimestamp ||
          m.sentAt ||
          m.SentAt ||
          "",
      };
    });

  const syncUserWithBackendProfile = (baseProfile, data) => {
    const backendProfile = String(
      data?.profile || baseProfile?.profile || baseProfile?.role || ""
    ).trim();

    setUser((prev) => ({
      ...(prev || {}),
      ...(baseProfile || {}),
      profile: backendProfile,
      role: backendProfile,
    }));
  };

  const updateMessages = (sessionId, updater) => {
    setMessages((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;

      if (sessionId) {
        setSessionMessagesMap((prevMap) => ({
          ...prevMap,
          [sessionId]: next,
        }));
      }

      return next;
    });
  };

  const setFormForSession = (sessionId, nextFormState) => {
    if (!sessionId) return;
    const normalized = normalizeFormState(nextFormState);

    setFormStateMap((prev) => {
      const copy = { ...prev };
      if (normalized) copy[sessionId] = normalized;
      else delete copy[sessionId];
      return copy;
    });
  };

  const setFormDirtyForSession = (sessionId, isDirty) => {
    if (!sessionId) return;

    setFormDirtyMap((prev) => {
      const next = { ...prev };
      if (isDirty) next[sessionId] = true;
      else delete next[sessionId];
      return next;
    });
  };

  const getSessionSource = (s) =>
    String(s?.source || s?.rowSource || s?.itemSource || "")
      .toLowerCase()
      .trim();

  const isBusinessOnlyRequestRow = (s) => {
    const source = getSessionSource(s);
    return (
      source === "business_request" ||
      source === "customer_request_table" ||
      source === "request_record"
    );
  };

  const isCustomerRequestFlowFormState = (formState) => {
    if (!formState) return false;

    const step = String(
      formState?.step ||
        formState?.currentStep ||
        formState?.flowStep ||
        formState?.stage ||
        ""
    )
      .toLowerCase()
      .trim();

    const flowType = String(
      formState?.flowType ||
        formState?.type ||
        formState?.requestType ||
        formState?.mode ||
        ""
    )
      .toLowerCase()
      .trim();

    return (
      flowType.includes("customer_request") ||
      flowType.includes("customer request") ||
      step === "select_customer" ||
      step === "customer_selection" ||
      step === "customer_part_name" ||
      step === "part_name" ||
      step === "part_number" ||
      step === "customer_part_number" ||
      step === "request_form" ||
      step === "form"
    );
  };

  const isStarterAliasSession = (sessionId) => {
    const sid = String(sessionId || "").toLowerCase().trim();
    return (
      sid === "new customer request" ||
      sid === "customer request" ||
      sid === "default-chat" ||
      sid.startsWith("temp-")
    );
  };

  const isCustomerRequestHelperMeta = (s) => {
    const title = String(s?.title || "").toLowerCase().trim();
    const sid = String(s?.sessionId || "").toLowerCase().trim();
    const sessionType = String(
      s?.sessionType || s?.SessionType || s?.kcSessionType || ""
    )
      .toLowerCase()
      .trim();

    return (
      sessionType === "my assistant" &&
      (sid === "new customer request" || title === "customer request")
    );
  };

  const getCustomerRequestHelperSessionId = () => {
    const assistantList = sessions?.groupedSessions?.myAssistant || [];
    const helper = assistantList.find((s) => isCustomerRequestHelperMeta(s));
    return helper?.sessionId || "New Customer Request";
  };

  const isCustomerRequestHelperSessionId = (sessionId) => {
    const sid = String(sessionId || "").trim().toLowerCase();
    const helperSid = String(getCustomerRequestHelperSessionId() || "")
      .trim()
      .toLowerCase();

    return sid === helperSid || sid === "new customer request";
  };

  const extractRequestIdFromSessionId = (sessionId) => {
    const sid = String(sessionId || "").trim();
    if (!sid) return "";

    const parts = sid.split("#");
    if (parts.length >= 3 && /^REQC$/i.test(parts[0])) {
      return parts.slice(0, 3).join("#");
    }
    if (parts.length >= 3 && /^REQS$/i.test(parts[0])) {
      return parts.slice(0, 3).join("#");
    }
    if (/^REQ-/i.test(parts[0])) {
      return parts[0];
    }
    return parts[0] || sid;
  };

  const buildImmediateCustomerRequestRow = (sessionId, formState) => {
    const customerPartName = String(formState?.CustomerPartName || "").trim();
    const customerPartNumber = String(formState?.CustomerPartNumber || "").trim();
    const customerName = String(formState?.CustomerName || "").trim();
    const requestId =
      String(formState?.RequestId || "").trim() ||
      extractRequestIdFromSessionId(sessionId);

    const nowIso = new Date().toISOString();

    return {
      sessionId,
      title: customerPartName || requestId || sessionId,
      createdAt: nowIso,
      lastActivityAt: nowIso,
      kcSessionType: "Customer Request",
      sessionType: "Customer Request",
      requestId,
      requestStatus: "REQUEST-CREATE",
      rawRequestStatus: "REQUEST-CREATE",
      customerName,
      customerPartName,
      customerPartNumber,
    };
  };

  const upsertBySessionId = (list = [], item) => {
    const sid = String(item?.sessionId || "").trim();
    if (!sid) return Array.isArray(list) ? list : [];

    const arr = Array.isArray(list) ? [...list] : [];
    const idx = arr.findIndex(
      (x) => String(x?.sessionId || "").trim().toLowerCase() === sid.toLowerCase()
    );

    if (idx >= 0) {
      arr[idx] = {
        ...arr[idx],
        ...item,
      };
      return arr;
    }

    return [item, ...arr];
  };

  const mergeSyncedSessionMeta = (meta) => {
    if (!meta || typeof meta !== "object") return;

    const sessionId = String(
      meta?.sessionId || meta?.SessionId || meta?.taskId || meta?.TaskId || ""
    ).trim();
    if (!sessionId) return;

    const upperId = sessionId.toUpperCase();
    const sessionType = String(
      meta?.sessionType || meta?.SessionType || meta?.kcSessionType || meta?.taskType || ""
    )
      .trim()
      .toLowerCase();

    const isSupplierMeta =
      upperId.startsWith("TSKS") ||
      upperId.startsWith("TSKE") ||
      sessionType === "supplier task" ||
      sessionType === "supplier request";

    const normalizedMeta = {
      ...meta,
      sessionId,
    };

    setSessions((previous) => {
      if (isSupplierMeta) {
        return {
          ...previous,
          tasks: upsertBySessionId(previous?.tasks || [], normalizedMeta),
          groupedSessions: {
            myAssistant: [...(previous?.groupedSessions?.myAssistant || [])],
            customerRequest: [
              ...(previous?.groupedSessions?.customerRequest || []),
            ],
            supplierTask: upsertBySessionId(
              previous?.groupedSessions?.supplierTask || [],
              normalizedMeta
            ),
          },
        };
      }

      return {
        ...previous,
        requests: upsertBySessionId(previous?.requests || [], normalizedMeta),
        groupedSessions: {
          myAssistant: [...(previous?.groupedSessions?.myAssistant || [])],
          customerRequest: upsertBySessionId(
            previous?.groupedSessions?.customerRequest || [],
            normalizedMeta
          ),
          supplierTask: [...(previous?.groupedSessions?.supplierTask || [])],
        },
      };
    });
  };

  const findExistingSessionIdForChatType = (chatType) => {
    const assistantList = sessions?.groupedSessions?.myAssistant || [];

    if (chatType === "NEW_CUSTOMER_REQUEST") {
      const found = assistantList.find((s) => isCustomerRequestHelperMeta(s));
      return found?.sessionId || null;
    }

    if (chatType === "NEW_SUPPLIER_REQUEST") {
      const found = assistantList.find((s) => {
        const title = String(s?.title || "").toLowerCase().trim();
        const sid = String(s?.sessionId || "").toLowerCase().trim();

        return (
          title.includes("supplier request") ||
          title.includes("supplier task") ||
          sid === "new supplier request"
        );
      });

      return found?.sessionId || null;
    }

    if (chatType === "REQUEST_MONITORING_STATUS") {
      const found = assistantList.find((s) => {
        const title = String(s?.title || "").toLowerCase().trim();
        const sid = String(s?.sessionId || "").toLowerCase().trim();

        return (
          title.includes("monitoring") ||
          title.includes("status") ||
          sid === "request monitoring & status"
        );
      });

      return found?.sessionId || null;
    }

    return null;
  };

  const adoptServerSessionId = async (serverSessionId) => {
    if (!serverSessionId || !activeSessionId) return;
    if (serverSessionId === activeSessionId) return;

    const oldId = activeSessionId;
    const oldFormState = formStateMap?.[oldId] || null;
    const oldMessages = sessionMessagesMap?.[oldId] || [];
    const oldIsHelper = isCustomerRequestHelperSessionId(oldId);

    const canAutoAdopt =
      oldId.startsWith("temp-") ||
      oldId === "default-chat" ||
      isStarterAliasSession(oldId) ||
      isCustomerRequestFlowFormState(oldFormState);

    if (!canAutoAdopt) {
      console.warn(
        "Skipping adoptServerSessionId because current session should remain stable",
        { oldId, serverSessionId }
      );
      return;
    }

    setSessionMessagesMap((prev) => {
      const copy = { ...prev };
      copy[serverSessionId] = copy[oldId] || [];
      delete copy[oldId];
      return copy;
    });

    setFormStateMap((prev) => {
      const copy = { ...prev };
      if (copy[oldId]) {
        copy[serverSessionId] = copy[oldId];
        delete copy[oldId];
      }
      return copy;
    });

    setSessions((prev) => {
      if (oldIsHelper) {
        const immediateRow = buildImmediateCustomerRequestRow(
          serverSessionId,
          oldFormState || {}
        );

        return {
          ...prev,
          requests: upsertBySessionId(prev.requests || [], immediateRow),
          groupedSessions: {
            myAssistant: [...(prev.groupedSessions?.myAssistant || [])],
            customerRequest: upsertBySessionId(
              prev.groupedSessions?.customerRequest || [],
              immediateRow
            ),
            supplierTask: [...(prev.groupedSessions?.supplierTask || [])],
          },
        };
      }

      const tasks = (prev.tasks || []).map((s) =>
        s.sessionId === oldId ? { ...s, sessionId: serverSessionId } : s
      );
      const requests = (prev.requests || []).map((s) =>
        s.sessionId === oldId ? { ...s, sessionId: serverSessionId } : s
      );

      const groupedSessions = {
        myAssistant: (prev.groupedSessions?.myAssistant || []).map((s) =>
          s.sessionId === oldId ? { ...s, sessionId: serverSessionId } : s
        ),
        customerRequest: (prev.groupedSessions?.customerRequest || []).map((s) =>
          s.sessionId === oldId ? { ...s, sessionId: serverSessionId } : s
        ),
        supplierTask: (prev.groupedSessions?.supplierTask || []).map((s) =>
          s.sessionId === oldId ? { ...s, sessionId: serverSessionId } : s
        ),
      };

      return { ...prev, tasks, requests, groupedSessions };
    });

    setActiveSessionId(serverSessionId);

    const prevState = loadSessionState();
    saveSessionState({
      activeSessionId: serverSessionId,
      lastActivityAt: Date.now(),
      sessionStartedAt: prevState?.sessionStartedAt || Date.now(),
    });

    try {
      const token = await getAccessToken();
      if (!token || !user?.email) return;

      const init = await initialiseChatDeduped(token, user.email, serverSessionId);
      rememberSyncState(serverSessionId, init);

      syncUserWithBackendProfile(user, init);

      const normalizedSessions = normalizeSessionsPayload(init);

      setSessions((prev) => {
        const backendCustomerRequest =
          normalizedSessions?.groupedSessions?.customerRequest || [];

        const hasServerSessionInSidebar = backendCustomerRequest.some(
          (s) =>
            String(s?.sessionId || "").trim().toLowerCase() ===
            String(serverSessionId).trim().toLowerCase()
        );

        if (!hasServerSessionInSidebar && oldIsHelper) {
          const immediateRow = buildImmediateCustomerRequestRow(
            serverSessionId,
            oldFormState || {}
          );

          return {
            ...normalizedSessions,
            requests: upsertBySessionId(normalizedSessions.requests || [], immediateRow),
            groupedSessions: {
              myAssistant: normalizedSessions.groupedSessions?.myAssistant || [],
              customerRequest: upsertBySessionId(
                normalizedSessions.groupedSessions?.customerRequest || [],
                immediateRow
              ),
              supplierTask: normalizedSessions.groupedSessions?.supplierTask || [],
            },
          };
        }

        return normalizedSessions;
      });

      if (isCustomerRequestHelperSessionId(serverSessionId)) {
        setFormForSession(serverSessionId, null);
        setMessages([]);
        setSessionMessagesMap((prev) => ({
          ...prev,
          [serverSessionId]: [],
        }));
        return;
      }

      const nextFormState = init?.formState || oldFormState || null;
      setFormForSession(serverSessionId, nextFormState);

      if (init?.messages) {
        const normalized = normalizeMessages(init.messages || []);
        const finalMessages = normalized.length ? normalized : oldMessages;

        setMessages(finalMessages);
        setSessionMessagesMap((prev) => ({
          ...prev,
          [serverSessionId]: finalMessages,
        }));
      }
    } catch (e) {
      console.warn("Failed to refresh sessions after adoptServerSessionId", e);
    }
  };

  const handleNewChat = () => {
    const tempId = `temp-${Date.now()}`;
    setActiveSessionId(tempId);
    setSessionMessagesMap((prev) => ({ ...prev, [tempId]: [] }));
    setMessages([]);
    setFormForSession(tempId, null);
  };

  const openCustomerRequestStarter = async (targetSessionId = null) => {
    try {
      const starterId =
        targetSessionId || getCustomerRequestHelperSessionId();

      setActiveSessionId(starterId);
      setMessages([]);
      setFormForSession(starterId, null);

      setSessionMessagesMap((prev) => ({
        ...prev,
        [starterId]: [],
      }));

      const prevState = loadSessionState();

      saveSessionState({
        activeSessionId: starterId,
        lastActivityAt: Date.now(),
        sessionStartedAt: prevState?.sessionStartedAt || Date.now(),
      });

      // No /initialise call is needed here.
      // The session list is already available from the initial app load.
    } catch (e) {
      console.error("Failed to open customer request starter", e);
    }
  };

  const handleCreateChatType = async (chatType) => {
    try {
      if (chatType === "NEW_CUSTOMER_REQUEST") {
        await openCustomerRequestStarter();
        return;
      }

      if (!user?.email) return;

      const token = await getAccessToken();
      if (!token) return;

      const existingId = findExistingSessionIdForChatType(chatType);

      if (existingId) {
        await handleSessionClick(existingId);
        return;
      }

      const created = await createSession(token, user.email, chatType);
      const newId = created?.sessionId || created?.SessionId;
      if (!newId) throw new Error("No sessionId returned from createSession");

      setActiveSessionId(newId);
      setSessionMessagesMap((prev) => ({ ...prev, [newId]: [] }));
      setMessages([]);
      setFormForSession(newId, null);

      const prevState = loadSessionState();
      saveSessionState({
        activeSessionId: newId,
        lastActivityAt: Date.now(),
        sessionStartedAt: prevState?.sessionStartedAt || Date.now(),
      });

      // Request Monitoring uses the dedicated lightweight GET /status endpoint
      // inside ChatWindow. Do not load the full /initialise payload here.
      if (chatType === "REQUEST_MONITORING_STATUS") {
        return;
      }

      const data = await initialiseChatDeduped(token, user.email, newId);
      rememberSyncState(newId, data);
      const normalized = normalizeMessages(data.messages || []);

      syncUserWithBackendProfile(user, data);
      setSessions(normalizeSessionsPayload(data));
      setMessages(normalized);
      setSessionMessagesMap((prev) => ({ ...prev, [newId]: normalized }));
      setFormForSession(newId, data?.formState || null);
    } catch (e) {
      console.error("handleCreateChatType failed", e);
      handleNewChat();
    }
  };

  useEffect(() => {
    cleanupTempSessionFromStorage();

    const init = async () => {
      try {
        const profile = await getUserProfile();
        const token = await getAccessToken();
        if (!profile || !token) return;

        const saved = loadSessionState();
        const requestedId = saved?.activeSessionId || null;
        const safeRequestedId =
          requestedId && requestedId.startsWith("temp-") ? null : requestedId;

        const data = await initialiseChatDeduped(token, profile.email, safeRequestedId);

        syncUserWithBackendProfile(profile, data);

        const normalizedSessions = normalizeSessionsPayload(data);
        const resolvedProfile = String(
          data?.profile || profile?.profile || profile?.role || ""
        )
          .trim()
          .toLowerCase();

        // Engineering landing-page rule: do not auto-open the topmost request.
        // Always start on the Customer Request Assistant launcher where the
        // engineer can intentionally choose Create New or Work on Existing.
        const engineerLandingSessionId =
          resolvedProfile === "engineering"
            ? findCustomerRequestHelperSessionId(normalizedSessions)
            : "";

        const sid = engineerLandingSessionId || data.activeSessionId || null;
        if (sid) rememberSyncState(sid, data);

        const normalized = engineerLandingSessionId
          ? []
          : normalizeMessages(data.messages || []);

        setSessions(normalizedSessions);

        if (engineerLandingSessionId || (sid && isCustomerRequestHelperSessionId(sid))) {
          setActiveSessionId(sid);
          setMessages([]);
          setFormForSession(sid, null);
          setFormDirtyForSession(sid, false);
          setSessionMessagesMap((prev) => ({ ...prev, [sid]: [] }));

          const prevState = loadSessionState();
          saveSessionState({
            activeSessionId: sid,
            lastActivityAt: Date.now(),
            sessionStartedAt: prevState?.sessionStartedAt || Date.now(),
          });
        } else {
          if (sid) setFormForSession(sid, data?.formState || null);

          setActiveSessionId(sid);
          setMessages(normalized);

          if (sid) {
            setSessionMessagesMap((prev) => ({ ...prev, [sid]: normalized }));
          }
        }

        // Agent Mode UI has been removed. Always keep normal chat mode.
        localStorage.setItem("agentMode", "false");
      } catch (err) {
        console.error("Initialise failed", err);
      }
    };

    init();
  }, []);


  // ===============================
  // ✅ REALTIME WEBSOCKET -> DELTA SYNC
  // WebSocket carries only a small SESSION_UPDATED notification.
  // Actual authorized data is then fetched from POST /sync-test.
  // Full 30-second /initialise polling has been removed on this performance branch.
  // WebSocket reconnect calls /sync-test once to recover missed updates.
  // ===============================
  const runRealtimeSync = async (sessionId, trigger = "websocket") => {
    const latestSessionId = String(sessionId || "").trim();
    const latestUserEmail = String(userEmailRef.current || "").trim();

    if (!latestSessionId || !latestUserEmail) return null;
    if (!isAutoRefreshEligibleSession(latestSessionId)) return null;
    if (isCustomerRequestHelperSessionId(latestSessionId)) return null;

    const requestKey = `${latestUserEmail.toLowerCase()}::${latestSessionId}`;
    const existingRequest = realtimeSyncRequestsRef.current.get(requestKey);
    if (existingRequest) return existingRequest;

    const request = (async () => {
      try {
        const token = await getAccessToken();
        if (!token) return null;

        const data = await syncChatSession(
          token,
          latestUserEmail,
          latestSessionId,
          syncCursorMapRef.current?.[latestSessionId] || "",
          syncRequestVersionMapRef.current?.[latestSessionId] || ""
        );

        rememberSyncState(latestSessionId, data);

        // Ignore UI application if the user changed sessions while sync was running.
        if (activeSessionIdRef.current !== latestSessionId) return data;

        if (data?.requestMeta) {
          mergeSyncedSessionMeta(data.requestMeta);
        }

        const activeFormIsDirty = Boolean(
          formDirtyMapRef.current?.[latestSessionId]
        );

        if (data?.formState && !activeFormIsDirty) {
          setFormForSession(latestSessionId, data.formState);
        }

        const incomingMessages = normalizeMessages([
          ...(Array.isArray(data?.messages) ? data.messages : []),
          ...(Array.isArray(data?.snapshotMessages)
            ? data.snapshotMessages
            : []),
        ]);

        if (data?.replaceMessages) {
          const currentSignature = buildMessagesSignature(messagesRef.current);
          const nextSignature = buildMessagesSignature(incomingMessages);

          if (currentSignature !== nextSignature) {
            setMessages(incomingMessages);
            messagesRef.current = incomingMessages;
            setSessionMessagesMap((previous) => ({
              ...previous,
              [latestSessionId]: incomingMessages,
            }));
          }
        } else if (incomingMessages.length) {
          const mergedMessages = mergeUniqueMessages(
            messagesRef.current,
            incomingMessages
          );

          const currentSignature = buildMessagesSignature(messagesRef.current);
          const nextSignature = buildMessagesSignature(mergedMessages);

          if (currentSignature !== nextSignature) {
            setMessages(mergedMessages);
            messagesRef.current = mergedMessages;
            setSessionMessagesMap((previous) => ({
              ...previous,
              [latestSessionId]: mergedMessages,
            }));
          }
        }

        console.log("✅ Realtime delta sync complete", {
          trigger,
          sessionId: latestSessionId,
          messageCount: Array.isArray(data?.messages) ? data.messages.length : 0,
          hasMore: Boolean(data?.hasMore),
        });

        return data;
      } catch (error) {
        console.warn("Realtime delta sync failed", {
          trigger,
          sessionId: latestSessionId,
          error,
        });
        return null;
      }
    })();

    realtimeSyncRequestsRef.current.set(requestKey, request);

    const clearRequest = () => {
      if (realtimeSyncRequestsRef.current.get(requestKey) === request) {
        realtimeSyncRequestsRef.current.delete(requestKey);
      }
    };

    request.then(clearRequest, clearRequest);
    return request;
  };

  // Always expose the latest sync implementation to the long-lived WebSocket
  // handlers. This avoids reconnecting the socket just because React re-rendered.
  runRealtimeSyncRef.current = runRealtimeSync;

  useEffect(() => {
    if (!user?.email) return undefined;

    const email = String(user.email).trim();
    if (!email) return undefined;

    let disposed = false;
    let socket = null;
    let reconnectTimer = null;
    let reconnectAttempt = 0;

    const connectWebSocket = () => {
      if (disposed) return;

      const separator = WEBSOCKET_URL.includes("?") ? "&" : "?";

      // USER-SCOPED CONNECTION:
      // The WebSocket belongs to the logged-in browser/user, not to one RequestId.
      // POC note: userEmail is still passed as a query parameter because the
      // current $connect route is not yet using production authentication.
      const socketUrl =
        `${WEBSOCKET_URL}${separator}` +
        `userEmail=${encodeURIComponent(email)}`;

      try {
        socket = new WebSocket(socketUrl);
      } catch (error) {
        console.warn("WebSocket creation failed", error);
        return;
      }

      socket.onopen = () => {
        if (disposed) return;

        reconnectAttempt = 0;

        const currentSessionId = String(
          activeSessionIdRef.current || ""
        ).trim();

        console.log("✅ User-scoped realtime WebSocket connected", {
          userEmail: email,
          activeSessionId: currentSessionId,
        });

        // Recover anything written while the socket was disconnected.
        // Only the currently open eligible request needs an immediate sync.
        if (
          currentSessionId &&
          isAutoRefreshEligibleSession(currentSessionId)
        ) {
          runRealtimeSyncRef.current?.(
            currentSessionId,
            "websocket-open"
          );
        }
      };

      socket.onmessage = (event) => {
        if (disposed) return;

        try {
          const payload = JSON.parse(event.data || "{}");

          const messageType = String(
            payload?.type || ""
          ).trim();

          const messageSessionId = String(
            payload?.sessionId ||
              payload?.SessionId ||
              payload?.requestSessionId ||
              ""
          ).trim();

          if (
            messageType !== "SESSION_UPDATED" &&
            messageType !== "REQUEST_UPDATED"
          ) {
            return;
          }

          if (!messageSessionId) {
            console.warn(
              "Ignoring realtime notification without sessionId",
              payload
            );
            return;
          }

          const currentActiveSessionId = String(
            activeSessionIdRef.current || ""
          ).trim();

          console.log("📩 Realtime request update received", {
            changedSessionId: messageSessionId,
            activeSessionId: currentActiveSessionId,
            updateType: payload?.updateType || "",
          });

          if (messageSessionId === currentActiveSessionId) {
            // The request currently visible on screen changed.
            // Pull only the delta immediately.
            realtimeDirtySessionsRef.current.delete(messageSessionId);

            runRealtimeSyncRef.current?.(
              messageSessionId,
              payload?.updateType || messageType
            );
            return;
          }

          // A DIFFERENT request changed while the user is working elsewhere.
          // Do not switch the user's screen and do not fetch a potentially large
          // first sync in the background. Mark it dirty; when the user opens it,
          // handleSessionClick() will run a delta sync before treating cache as fresh.
          realtimeDirtySessionsRef.current.add(messageSessionId);

          console.log("🔔 Inactive request marked for realtime sync", {
            sessionId: messageSessionId,
            updateType: payload?.updateType || "",
          });
        } catch (error) {
          console.warn("Ignoring invalid WebSocket message", error);
        }
      };

      socket.onerror = (error) => {
        if (!disposed) {
          console.warn("Realtime WebSocket error", error);
        }
      };

      socket.onclose = () => {
        if (disposed) return;

        const delayMs = Math.min(
          1000 * 2 ** reconnectAttempt,
          10000
        );
        reconnectAttempt += 1;

        console.warn(
          `Realtime WebSocket closed; reconnecting in ${delayMs}ms`
        );

        reconnectTimer = setTimeout(
          connectWebSocket,
          delayMs
        );
      };
    };

    connectWebSocket();

    return () => {
      disposed = true;

      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }

      if (socket) {
        socket.onopen = null;
        socket.onmessage = null;
        socket.onerror = null;
        socket.onclose = null;

        if (
          socket.readyState === WebSocket.OPEN ||
          socket.readyState === WebSocket.CONNECTING
        ) {
          socket.close();
        }
      }
    };
  }, [user?.email]);


  useEffect(() => {
    if (!activeSessionId) return;

    const prev = loadSessionState();
    saveSessionState({
      activeSessionId,
      lastActivityAt: Date.now(),
      sessionStartedAt: prev?.sessionStartedAt || Date.now(),
    });
  }, [activeSessionId]);

  useEffect(() => {
    const markActivity = () => {
      const saved = loadSessionState();
      if (!saved) return;

      saveSessionState({
        ...saved,
        lastActivityAt: Date.now(),
      });

      setShowIdleWarning(false);
      setIdleSecondsLeft(null);
    };

    window.addEventListener("click", markActivity);
    window.addEventListener("keydown", markActivity);

    return () => {
      window.removeEventListener("click", markActivity);
      window.removeEventListener("keydown", markActivity);
    };
  }, []);

  useEffect(() => {
    if (!activeSessionId) return;

    const checkIdleWarning = () => {
      const saved = loadSessionState();
      if (!saved?.lastActivityAt) return;

      const now = Date.now();
      const idleTime = now - saved.lastActivityAt;
      const remaining = CHAT_CONFIG.IDLE_TIMEOUT_MS - idleTime;

      if (remaining <= CHAT_CONFIG.WARNING_BEFORE_MS && remaining > 0) {
        setShowIdleWarning(true);
        setIdleSecondsLeft(Math.ceil(remaining / 1000));
      } else {
        setShowIdleWarning(false);
        setIdleSecondsLeft(null);
      }
    };

    checkIdleWarning();
    const interval = setInterval(checkIdleWarning, 1000);
    return () => clearInterval(interval);
  }, [activeSessionId]);

  useEffect(() => {
    if (!activeSessionId) return;

    const checkTimers = () => {
      const saved = loadSessionState();
      if (!saved) return;

      const now = Date.now();
      const idleExpired = now - saved.lastActivityAt > CHAT_CONFIG.IDLE_TIMEOUT_MS;
      const sessionExpired =
        now - saved.sessionStartedAt > CHAT_CONFIG.MAX_SESSION_MS;

      if (idleExpired || sessionExpired) {
        console.warn("Session expired");
        clearSessionState();
        handleNewChat();
        setShowIdleWarning(false);
      }
    };

    const interval = setInterval(checkTimers, 30 * 1000);
    return () => clearInterval(interval);
  }, [activeSessionId]);

  const handleAutoRename = async (firstMessage) => {
    if (!activeSessionId || !user) return;

    const title = (firstMessage || "").slice(0, 60);

    setSessions((prev) => {
      const requests = prev.requests || [];
      const tasks = prev.tasks || [];

      const inRequests = requests.some((s) => s.sessionId === activeSessionId);
      const inTasks = tasks.some((s) => s.sessionId === activeSessionId);

      if (inRequests) {
        return {
          ...prev,
          requests: requests.map((s) =>
            s.sessionId === activeSessionId ? { ...s, title } : s
          ),
          tasks,
        };
      }

      if (inTasks) {
        return {
          ...prev,
          requests,
          tasks: tasks.map((s) =>
            s.sessionId === activeSessionId ? { ...s, title } : s
          ),
        };
      }

      const isRequest =
        activeSessionId === "default-chat" ||
        (activeSessionId || "").toUpperCase().startsWith("REQ-") ||
        (activeSessionId || "").toUpperCase().startsWith("REQUEST-") ||
        (activeSessionId || "").startsWith("default-chat-");

      const newItem = {
        sessionId: activeSessionId,
        title,
        createdAt: Date.now(),
      };

      return isRequest
        ? { ...prev, requests: [...requests, newItem], tasks }
        : { ...prev, requests, tasks: [...tasks, newItem] };
    });

    try {
      const token = await getAccessToken();
      await renameChat(token, user.email, activeSessionId, title);
    } catch (err) {
      console.error("Rename persist failed", err);
    }
  };

  const buildBusinessRequestFallbackMessages = (sessionId) => {
    const meta = (sessions?.requests || []).find((s) => s.sessionId === sessionId);
    if (!meta) return [];

    const requestId = meta?.requestId || meta?.sessionId || "-";
    const customerPartNumber = meta?.customerPartNumber || "-";
    const customerPartName = meta?.customerPartName || "-";
    const complianceStatus = meta?.complianceStatus || "Pending";
    const fmdStatus = meta?.fmdStatus || "Pending";

    return [
      {
        id: `fallback-${sessionId}`,
        sender: "bot",
        role: "assistant",
        text:
          `Request ID: ${requestId}\n\n` +
          `Customer Part Number: ${customerPartNumber}\n\n` +
          `Customer Part Name: ${customerPartName}\n\n` +
          `Compliance Status: ${complianceStatus}\n\n` +
          `FMD Status: ${fmdStatus}`,
        content:
          `Request ID: ${requestId}\n\n` +
          `Customer Part Number: ${customerPartNumber}\n\n` +
          `Customer Part Name: ${customerPartName}\n\n` +
          `Compliance Status: ${complianceStatus}\n\n` +
          `FMD Status: ${fmdStatus}`,
        attachments: [],
      },
    ];
  };

  const isSupplierTaskMeta = (meta) => {
    const sid = String(meta?.sessionId || meta?.taskId || "").toUpperCase();
    const sessionType = String(
      meta?.sessionType || meta?.kcSessionType || meta?.taskType || ""
    )
      .toLowerCase()
      .trim();

    return (
      sid.startsWith("TSKS") ||
      sid.startsWith("TSKE") ||
      sessionType === "supplier task" ||
      sessionType === "supplier request"
    );
  };

  const buildSupplierTaskFallbackMessages = (sessionId, meta = null) => {
    const taskMeta =
      meta ||
      [
        ...(sessions?.tasks || []),
        ...(sessions?.groupedSessions?.supplierTask || []),
      ].find((s) => String(s?.sessionId || s?.taskId || "") === String(sessionId));

    if (!taskMeta) return [];

    const taskId = taskMeta?.taskId || taskMeta?.sessionId || sessionId || "-";
    const taskName =
      taskMeta?.taskName ||
      taskMeta?.title ||
      taskMeta?.displaySessionId ||
      "Supplier Request";
    const taskStatus = taskMeta?.taskStatus || taskMeta?.status || "CREATE";
    const taskPriority = taskMeta?.taskPriority || taskMeta?.priority || "MEDIUM";
    const taskType = taskMeta?.taskType || "Supplier Request";
    const requestId = taskMeta?.requestId || taskMeta?.taskAssignedBy || "-";
    const assignedFor =
      taskMeta?.taskAssignedFor ||
      taskMeta?.customerPart ||
      [taskMeta?.customerName, taskMeta?.customerPartNumber, taskMeta?.customerPartName]
        .filter(Boolean)
        .join("#") ||
      "-";
    const uploadUrl = taskMeta?.supplierPortalUrl || "http://localhost:5173";
    const description = taskMeta?.taskDescription || "-";

    const missingRaw = taskMeta?.missingInformation || [];
    const missingList = Array.isArray(missingRaw)
      ? missingRaw
      : missingRaw
      ? [missingRaw]
      : ["Full Material Disclosure document"];

    const missingText = missingList
      .filter(Boolean)
      .map((x) => `- ${String(x)}`)
      .join("\n");

    const text =
      `✅ **Supplier Task Loaded**\n\n` +
      `**Task:** ${taskName}\n` +
      `**Task ID:** ${taskId}\n` +
      `**Task Type:** ${taskType}\n` +
      `**Status:** ${taskStatus}\n` +
      `**Priority:** ${taskPriority}\n` +
      `**Assigned By Request:** ${requestId}\n` +
      `**Customer / Part:** ${assignedFor}\n\n` +
      `**Requested Information:**\n${missingText}\n\n` +
      `**Description:** ${description}\n\n` +
      `**Upload URL:** ${uploadUrl}\n\n` +
      `Please upload the requested document/information, then submit the task for engineering review.`;

    return [
      {
        id: `supplier-task-${taskId}`,
        sender: "bot",
        role: "assistant",
        text,
        content: text,
        attachments: [],
        artifact: {
          type: "supplier_task",
          taskId,
          taskItem: taskMeta,
          taskName,
          taskStatus,
          taskPriority,
          taskType,
          requestId,
          assignedFor,
          supplierPortalUrl: uploadUrl,
          missingInformation: missingList,
        },
        supplierTask: {
          type: "supplier_task",
          taskId,
          taskItem: taskMeta,
          taskName,
          taskStatus,
          taskPriority,
          taskType,
          requestId,
          assignedFor,
          supplierPortalUrl: uploadUrl,
          missingInformation: missingList,
        },
      },
    ];
  };

  const handleSessionClick = async (sessionId) => {
    try {
      if (!sessionId) return;

      if (isCustomerRequestHelperSessionId(sessionId)) {
        setLoadingSessionId(null);
        await openCustomerRequestStarter(sessionId);
        return;
      }

      // Request Monitoring is a lightweight dashboard, not a chat-history load.
      // Reuse its cached dashboard immediately and let ChatWindow refresh it
      // through GET /status without calling the full /initialise endpoint.
      if (isRequestMonitoringSessionId(sessionId)) {
        setLoadingSessionId(null);
        setActiveSessionId(sessionId);

        // Never restore old monitoring chat messages such as "get status".
        setMessages([]);

        setSessionMessagesMap((previous) => ({
          ...previous,
          [sessionId]: [],
        }));

        setFormForSession(sessionId, null);

        const previousState = loadSessionState();
        saveSessionState({
          activeSessionId: sessionId,
          lastActivityAt: Date.now(),
          sessionStartedAt:
            previousState?.sessionStartedAt || Date.now(),
        });

        return;
      }

      setActiveSessionId(sessionId);
      activeSessionIdRef.current = sessionId;

      const hasCachedSession = Object.prototype.hasOwnProperty.call(
        sessionMessagesMap,
        sessionId
      );

      const cachedMessages = hasCachedSession
        ? sessionMessagesMap[sessionId]
        : null;

      // Cache-first navigation:
      // Show already loaded data immediately and avoid another full /initialise.
      // Realtime WebSocket + /sync-test will fetch backend changes.
      if (hasCachedSession && Array.isArray(cachedMessages)) {
        setLoadingSessionId(null);
        setMessages(cachedMessages);

        const previousState = loadSessionState();

        saveSessionState({
          activeSessionId: sessionId,
          lastActivityAt: Date.now(),
          sessionStartedAt:
            previousState?.sessionStartedAt || Date.now(),
        });

        // If this request changed in the backend while another request was open,
        // keep cache-first navigation but refresh the delta immediately after open.
        if (realtimeDirtySessionsRef.current.has(sessionId)) {
          runRealtimeSync(sessionId, "open-dirty-session").then((data) => {
            if (data) {
              realtimeDirtySessionsRef.current.delete(sessionId);
            }
          });
        }

        return;
      }

      // Session has never been loaded in this browser session.
      setLoadingSessionId(sessionId);
      setMessages([]);

      const token = await getAccessToken();
      if (!token || !user) return;

      const selectedRequestMeta = [
        ...(sessions?.requests || []),
        ...(sessions?.tasks || []),
        ...(sessions?.groupedSessions?.myAssistant || []),
        ...(sessions?.groupedSessions?.customerRequest || []),
        ...(sessions?.groupedSessions?.supplierTask || []),
      ].find((item) => item.sessionId === sessionId);

      if (
        selectedRequestMeta &&
        isSupplierTaskMeta(selectedRequestMeta)
      ) {
        const supplierFallback = buildSupplierTaskFallbackMessages(
          sessionId,
          selectedRequestMeta
        );

        if (supplierFallback.length) {
          setMessages(supplierFallback);

          setSessionMessagesMap((previous) => ({
            ...previous,
            [sessionId]: supplierFallback,
          }));
        }
      }

      const data = await initialiseChatDeduped(
        token,
        user.email,
        sessionId
      );
      rememberSyncState(sessionId, data);
      realtimeDirtySessionsRef.current.delete(sessionId);

      const normalized = normalizeMessages(data.messages || []);

      syncUserWithBackendProfile(user, data);
      setSessions(normalizeSessionsPayload(data));

      const existingFormStateForSession =
        formStateMap?.[sessionId] || null;

      setFormForSession(
        sessionId,
        data?.formState ||
          existingFormStateForSession ||
          null
      );

      if (
        !normalized.length &&
        selectedRequestMeta &&
        isBusinessOnlyRequestRow(selectedRequestMeta)
      ) {
        const fallback =
          buildBusinessRequestFallbackMessages(sessionId);

        setMessages(fallback);

        setSessionMessagesMap((previous) => ({
          ...previous,
          [sessionId]: fallback,
        }));

        return;
      }

      const supplierFallback =
        selectedRequestMeta &&
        isSupplierTaskMeta(selectedRequestMeta)
          ? buildSupplierTaskFallbackMessages(
              sessionId,
              selectedRequestMeta
            )
          : [];

      const finalMessages =
        normalized.length > 0
          ? normalized
          : supplierFallback.length > 0
          ? supplierFallback
          : [];

      setMessages(finalMessages);

      setSessionMessagesMap((previous) => ({
        ...previous,
        [sessionId]: finalMessages,
      }));
    } catch (error) {
      console.error("Failed to load history", error);
      setMessages([]);
      setFormForSession(sessionId, null);
    } finally {
      setLoadingSessionId((current) =>
        current === sessionId ? null : current
      );
    }
  };


  // ============================================================
  // BACKGROUND CUSTOMER REQUEST PRELOAD
  //
  // KC requirement:
  // - login/landing page remains immediately usable
  // - customer requests are loaded quietly in sidebar order
  // - clicking a preloaded request opens from sessionMessagesMap instantly
  // - clicking a request that is not ready yet still uses the normal loader
  //
  // Keep this sequential (one request at a time) so login does not create
  // a burst of /initialise calls.
  // ============================================================
  useEffect(() => {
    const email = String(user?.email || "").trim();
    if (!email) return undefined;

    const requestRows =
      Array.isArray(sessions?.requests) && sessions.requests.length > 0
        ? sessions.requests
        : Array.isArray(sessions?.groupedSessions?.customerRequest)
        ? sessions.groupedSessions.customerRequest
        : [];

    if (!requestRows.length) return undefined;

    // Preserve the same order supplied to the sidebar.
    // Only real Customer Request sessions are background-preloaded.
    for (const requestMeta of requestRows) {
      const sessionId = String(
        requestMeta?.sessionId || requestMeta?.SessionId || ""
      ).trim();

      if (!sessionId) continue;
      if (!sessionId.toUpperCase().startsWith("REQC#")) continue;
      if (!isAutoRefreshEligibleSession(sessionId)) continue;
      if (isCustomerRequestHelperSessionId(sessionId)) continue;

      const alreadyCached = Object.prototype.hasOwnProperty.call(
        sessionMessagesMapRef.current,
        sessionId
      );

      if (alreadyCached) continue;
      if (backgroundPreloadQueuedIdsRef.current.has(sessionId)) continue;
      if (backgroundPreloadInFlightIdsRef.current.has(sessionId)) continue;

      backgroundPreloadQueueRef.current.push({
        sessionId,
        requestMeta,
      });
      backgroundPreloadQueuedIdsRef.current.add(sessionId);
    }

    if (!backgroundPreloadQueueRef.current.length) return undefined;

    const drainBackgroundPreloadQueue = async () => {
      if (backgroundPreloadRunningRef.current) return;

      backgroundPreloadRunningRef.current = true;

      try {
        const token = await getAccessToken();
        if (!token) return;

        while (backgroundPreloadQueueRef.current.length > 0) {
          const nextItem = backgroundPreloadQueueRef.current.shift();
          const sessionId = String(nextItem?.sessionId || "").trim();
          const requestMeta = nextItem?.requestMeta || null;

          if (!sessionId) continue;

          backgroundPreloadQueuedIdsRef.current.delete(sessionId);

          // The user may have opened this request while it was waiting in the
          // background queue. If so, the normal click flow already cached it.
          if (
            Object.prototype.hasOwnProperty.call(
              sessionMessagesMapRef.current,
              sessionId
            )
          ) {
            continue;
          }

          if (backgroundPreloadInFlightIdsRef.current.has(sessionId)) {
            continue;
          }

          backgroundPreloadInFlightIdsRef.current.add(sessionId);

          try {
            // initialiseChatDeduped also protects us if the user clicks the
            // same request while this background request is already in flight.
            const data = await initialiseChatDeduped(
              token,
              email,
              sessionId
            );

            rememberSyncState(sessionId, data);

            const normalized = normalizeMessages(data?.messages || []);

            let finalMessages = normalized;

            // Preserve the same fallback behavior used by handleSessionClick()
            // for a business-only customer request row.
            if (
              !finalMessages.length &&
              requestMeta &&
              isBusinessOnlyRequestRow(requestMeta)
            ) {
              finalMessages =
                buildBusinessRequestFallbackMessages(sessionId);
            }

            // Do not overwrite a session that the user loaded/updated while
            // this background request was running.
            setSessionMessagesMap((previous) => {
              if (
                Object.prototype.hasOwnProperty.call(previous, sessionId)
              ) {
                sessionMessagesMapRef.current = previous;
                return previous;
              }

              const next = {
                ...previous,
                [sessionId]: finalMessages,
              };

              sessionMessagesMapRef.current = next;
              return next;
            });

            // Cache form state too, otherwise a preloaded request could have
            // messages available but miss its saved workflow/form state.
            if (
              data?.formState &&
              !formDirtyMapRef.current?.[sessionId]
            ) {
              setFormForSession(sessionId, data.formState);
            }

            console.log("✅ Background request preload complete", {
              sessionId,
              messageCount: finalMessages.length,
            });
          } catch (error) {
            // A failed background preload must never break login/navigation.
            // If the user clicks this request later, the normal loader +
            // handleSessionClick path will still fetch it.
            console.warn("Background request preload failed", {
              sessionId,
              error,
            });
          } finally {
            backgroundPreloadInFlightIdsRef.current.delete(sessionId);
          }
        }
      } finally {
        backgroundPreloadRunningRef.current = false;

        // If a sessions update added more work during the tiny window where
        // this queue was finishing, drain that work as well.
        if (backgroundPreloadQueueRef.current.length > 0) {
          setTimeout(() => {
            void drainBackgroundPreloadQueue();
          }, 0);
        }
      }
    };

    // Give the landing page a short head start so preloading never blocks
    // the first visible render after login.
    const preloadStartTimer = setTimeout(() => {
      void drainBackgroundPreloadQueue();
    }, 300);

    return () => {
      clearTimeout(preloadStartTimer);
    };
  }, [
    user?.email,
    sessions?.requests,
    sessions?.groupedSessions?.customerRequest,
  ]);


  const handleOpenRequestFromStatusTable = (customerPartNumber) => {
    if (!customerPartNumber) return;

    const list =
      sessions?.groupedSessions?.customerRequest || sessions?.requests || [];
    const part = String(customerPartNumber || "").toLowerCase().trim();

    const found = list.find((s) => {
      const sid = String(s?.sessionId || "").toLowerCase();
      const title = String(s?.title || "").toLowerCase();
      return sid.includes(part) || title.includes(part);
    });

    if (found?.sessionId) {
      handleSessionClick(found.sessionId);
    } else {
      console.warn("Request session not found for:", customerPartNumber);
    }
  };

  const handleOpenExistingCustomerRequest = (sessionId) => {
    if (!sessionId) return;
    handleSessionClick(sessionId);
  };

  const handleRenameChat = async (sessionId, newTitleFromSidebar) => {
    const newTitle = newTitleFromSidebar || prompt("Rename chat");
    if (!newTitle || !user) return;

    try {
      const token = await getAccessToken();
      await renameChat(token, user.email, sessionId, newTitle);

      setSessions((prev) => ({
        ...prev,
        requests: (prev.requests || []).map((s) =>
          s.sessionId === sessionId ? { ...s, title: newTitle } : s
        ),
        tasks: (prev.tasks || []).map((s) =>
          s.sessionId === sessionId ? { ...s, title: newTitle } : s
        ),
        groupedSessions: {
          myAssistant: (prev.groupedSessions?.myAssistant || []).map((s) =>
            s.sessionId === sessionId ? { ...s, title: newTitle } : s
          ),
          customerRequest: (prev.groupedSessions?.customerRequest || []).map((s) =>
            s.sessionId === sessionId ? { ...s, title: newTitle } : s
          ),
          supplierTask: (prev.groupedSessions?.supplierTask || []).map((s) =>
            s.sessionId === sessionId ? { ...s, title: newTitle } : s
          ),
        },
      }));
    } catch (err) {
      console.error("Rename failed", err);
    }
  };

  const sidebarChats = (() => {
    const all = [...(sessions?.requests || []), ...(sessions?.tasks || [])];

    const map = new Map();
    for (const s of all) {
      const id = s.sessionId;
      if (!id) continue;

      const sortTime = s.lastActivityAt || s.updatedAt || s.createdAt || 0;
      const prev = map.get(id);
      const prevTime = prev?._sortTime || 0;

      if (!prev || sortTime > prevTime) {
        map.set(id, { ...s, _sortTime: sortTime });
      }
    }

    return Array.from(map.values())
      .sort((a, b) => (b._sortTime || 0) - (a._sortTime || 0))
      .map((s) => {
        const last =
          Array.isArray(s.lastMessages) && s.lastMessages.length
            ? s.lastMessages[s.lastMessages.length - 1]
            : null;

        const preview =
          typeof last?.content === "string"
            ? last.content
            : Array.isArray(last?.content) && last.content[0]?.text
            ? last.content[0].text
            : "";

        return {
          id: s.sessionId,
          title: s.title || "Chat",
          createdAt: s.createdAt || s._sortTime,
          preview,
        };
      });
  })();

  const activeFormState = activeSessionId ? formStateMap[activeSessionId] : null;
  const activeFormIsDirty = Boolean(
    activeSessionId && formDirtyMap[activeSessionId]
  );

  // Backend is the single source of truth for the Request Progress Timeline.
  // Match only the active request row returned by /initialise; do not derive
  // lifecycle status from form state, chat text, or local optimistic messages.
  const activeBackendRequestMeta = (() => {
    const activeId = String(activeSessionId || "").trim().toLowerCase();
    if (!activeId) return null;

    const backendRows = [
      ...(sessions?.groupedSessions?.customerRequest || []),
      ...(sessions?.requests || []),
    ];

    return (
      backendRows.find(
        (item) =>
          String(item?.sessionId || item?.SessionId || "")
            .trim()
            .toLowerCase() === activeId
      ) || null
    );
  })();

  const activeBackendRequestStatus = String(
    activeBackendRequestMeta?.requestStatus ||
      activeBackendRequestMeta?.RequestStatus ||
      activeBackendRequestMeta?.rawRequestStatus ||
      activeBackendRequestMeta?.RawRequestStatus ||
      activeBackendRequestMeta?.status ||
      activeBackendRequestMeta?.Status ||
      ""
  ).trim();

  const customerRequestHelperSessionId = getCustomerRequestHelperSessionId();

  const isCustomerRequestStarterSession =
    !!activeSessionId &&
    String(activeSessionId || "").toLowerCase().trim() ===
      String(customerRequestHelperSessionId || "").toLowerCase().trim();

  const customerRequestSuggestions = (
    sessions?.groupedSessions?.customerRequest ||
    sessions?.requests ||
    []
  ).filter((s) => {
    const title = String(s?.title || "").toLowerCase().trim();
    const sid = String(s?.sessionId || "").toLowerCase().trim();
    const kcType = String(s?.kcSessionType || s?.SessionType || "")
      .toLowerCase()
      .trim();

    if (
      title === "my assistant - new customer request" ||
      sid === "new customer request"
    ) {
      return false;
    }

    if (
      title === "my assistant - new supplier request" ||
      sid === "new supplier request"
    ) {
      return false;
    }

    if (
      kcType === "request monitoring & status" ||
      title === "my assistant - request status & dashboard" ||
      sid === "request monitoring & status"
    ) {
      return false;
    }

    if (sid === String(activeSessionId || "").toLowerCase().trim()) {
      return false;
    }

    if (isBusinessOnlyRequestRow(s)) {
      return false;
    }

    return true;
  });

  return (
    <div className="chat-layout">
      {showIdleWarning && (
        <div className="idle-warning-banner">
          ⚠️ You’ll be logged out in <strong>{idleSecondsLeft}</strong> seconds
          due to inactivity
        </div>
      )}

      {isRoleBasedView ? (
        isEngineer ? (
          <EngineerSidebar
            requests={sessions?.requests || []}
            groupedSessions={sessions?.groupedSessions || {}}
            activeId={activeSessionId}
            onSelectRequest={handleSessionClick}
            user={user}
            sidebarOpen={sidebarOpen}
            setSidebarOpen={setSidebarOpen}
            onCreate={handleCreateChatType}
            theme={theme}
            toggleTheme={toggleTheme}
            onLogout={onLogout}
          />
        ) : isCustomer ? (
          <CustomerSidebar
            requests={sessions?.requests || []}
            groupedSessions={sessions?.groupedSessions || {}}
            activeId={activeSessionId}
            onSelectRequest={handleSessionClick}
            user={user}
            sidebarOpen={sidebarOpen}
            setSidebarOpen={setSidebarOpen}
            onCreate={handleCreateChatType}
            theme={theme}
            toggleTheme={toggleTheme}
            onLogout={onLogout}
          />
        ) : (
          <SupplierSidebar
            requests={sessions?.requests || []}
            groupedSessions={sessions?.groupedSessions || {}}
            activeId={activeSessionId}
            onSelectRequest={handleSessionClick}
            user={user}
            sidebarOpen={sidebarOpen}
            setSidebarOpen={setSidebarOpen}
            theme={theme}
            toggleTheme={toggleTheme}
            onLogout={onLogout}
          />
        )
      ) : (
        <Sidebar
          user={user}
          chats={sidebarChats}
          activeId={activeSessionId}
          setActive={handleSessionClick}
          onCreate={handleCreateChatType}
          onRename={handleRenameChat}
          theme={theme}
          toggleTheme={toggleTheme}
          onLogout={onLogout}
          sidebarOpen={sidebarOpen}
          setSidebarOpen={setSidebarOpen}
        />
      )}

      <ChatWindow
        chat={{
          id: activeSessionId,
          messages,
          requestStatus: activeBackendRequestStatus,
          requestMeta: activeBackendRequestMeta,
        }}
        isSessionLoading={loadingSessionId === activeSessionId}
        updateMessages={(updater) => updateMessages(activeSessionId, updater)}
        user={user}
        onFirstMessage={handleAutoRename}
        adoptServerSessionId={adoptServerSessionId}
        showIdleWarning={showIdleWarning}
        idleSecondsLeft={idleSecondsLeft}
        agentMode={agentMode}
        formState={activeFormState}
        onFormStateChange={(sessionId, nextFormState) =>
          setFormForSession(sessionId, nextFormState)
        }
        isFormDirty={activeFormIsDirty}
        onFormDirtyChange={(sessionId, isDirty) =>
          setFormDirtyForSession(sessionId, isDirty)
        }
        onOpenRequestFromStatusTable={handleOpenRequestFromStatusTable}
        isCustomerRequestStarterSession={isCustomerRequestStarterSession}
        customerRequestSuggestions={customerRequestSuggestions}
        onOpenExistingCustomerRequest={handleOpenExistingCustomerRequest}
      />
    </div>
  );
};

export default Chat;