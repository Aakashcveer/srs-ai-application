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
import { initialiseChat, renameChat, createSession } from "../../api/api-config";

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

const AUTO_REFRESH_INTERVAL_MS = 30000;

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

const isAutoRefreshEligibleSession = (sessionId) => {
  const sid = String(sessionId || "").trim().toLowerCase();

  if (!sid) return false;
  if (sid.startsWith("temp-")) return false;
  if (sid === "default-chat") return false;
  if (sid === "new customer request") return false;
  if (sid === "new supplier request") return false;

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
  const isAutoRefreshingRef = useRef(false);

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
    formDirtyMapRef.current = formDirtyMap;
  }, [formDirtyMap]);

  useEffect(() => {
    localStorage.setItem("agentMode", "false");
  }, []);

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

      const init = await initialiseChat(token, user.email, serverSessionId);

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
      const starterId = targetSessionId || getCustomerRequestHelperSessionId();

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

      if (!user?.email) return;

      const token = await getAccessToken();
      if (!token) return;

      const data = await initialiseChat(token, user.email, starterId);

      syncUserWithBackendProfile(user, data);
      setSessions(normalizeSessionsPayload(data));

      setMessages([]);
      setFormForSession(starterId, null);
      setSessionMessagesMap((prev) => ({
        ...prev,
        [starterId]: [],
      }));
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

      const data = await initialiseChat(token, user.email, newId);
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

        const data = await initialiseChat(token, profile.email, safeRequestedId);

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


  useEffect(() => {
    if (!activeSessionId || !user?.email) return;
    if (!isAutoRefreshEligibleSession(activeSessionId)) return;
    if (isCustomerRequestHelperSessionId(activeSessionId)) return;

    const refreshActiveSessionFromBackend = async () => {
      const latestSessionId = activeSessionIdRef.current;
      const latestUserEmail = userEmailRef.current;

      if (!latestSessionId || !latestUserEmail) return;
      if (!isAutoRefreshEligibleSession(latestSessionId)) return;
      if (isCustomerRequestHelperSessionId(latestSessionId)) return;
      if (document.visibilityState === "hidden") return;
      if (isAutoRefreshingRef.current) return;

      isAutoRefreshingRef.current = true;

      try {
        const token = await getAccessToken();
        if (!token) return;

        const data = await initialiseChat(token, latestUserEmail, latestSessionId);
        const normalized = normalizeMessages(data.messages || []);

        syncUserWithBackendProfile(user, data);
        setSessions(normalizeSessionsPayload(data));

        const activeFormIsDirty = Boolean(
          formDirtyMapRef.current?.[latestSessionId]
        );

        // Never replace an unsaved form with the older backend formState returned
        // by /initialise. Messages/status can still refresh in the background.
        if (data?.formState && !activeFormIsDirty) {
          setFormForSession(latestSessionId, data.formState);
        }

        if (!normalized.length) return;

        const currentSignature = buildMessagesSignature(messagesRef.current);
        const nextSignature = buildMessagesSignature(normalized);

        if (currentSignature !== nextSignature) {
          setMessages(normalized);
          messagesRef.current = normalized;

          setSessionMessagesMap((prev) => ({
            ...prev,
            [latestSessionId]: normalized,
          }));
        }
      } catch (err) {
        console.warn("Auto refresh active session failed", err);
      } finally {
        isAutoRefreshingRef.current = false;
      }
    };

    const interval = setInterval(
      refreshActiveSessionFromBackend,
      AUTO_REFRESH_INTERVAL_MS
    );

    return () => clearInterval(interval);
  }, [activeSessionId, user?.email]);

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
      if (isCustomerRequestHelperSessionId(sessionId)) {
        await openCustomerRequestStarter(sessionId);
        return;
      }

      setMessages([]);
      setActiveSessionId(sessionId);

      if (sessionMessagesMap[sessionId]) {
        setMessages(sessionMessagesMap[sessionId]);
      }

      const token = await getAccessToken();
      if (!token || !user) return;

      const selectedRequestMeta = [
        ...(sessions?.requests || []),
        ...(sessions?.tasks || []),
        ...(sessions?.groupedSessions?.myAssistant || []),
        ...(sessions?.groupedSessions?.customerRequest || []),
        ...(sessions?.groupedSessions?.supplierTask || []),
      ].find((r) => r.sessionId === sessionId);

      const existingFormState = formStateMap?.[sessionId] || null;

      if (selectedRequestMeta && isSupplierTaskMeta(selectedRequestMeta)) {
        const supplierFallback = buildSupplierTaskFallbackMessages(
          sessionId,
          selectedRequestMeta
        );

        if (supplierFallback.length) {
          setMessages(supplierFallback);
          setSessionMessagesMap((prev) => ({
            ...prev,
            [sessionId]: supplierFallback,
          }));
        }
      }

      const data = await initialiseChat(token, user.email, sessionId);
      const normalized = normalizeMessages(data.messages || []);

      syncUserWithBackendProfile(user, data);
      setSessions(normalizeSessionsPayload(data));

      const existingFormStateForSession = formStateMap?.[sessionId] || null;
      setFormForSession(
        sessionId,
        data?.formState || existingFormStateForSession || null
      );

      if (
        !normalized.length &&
        selectedRequestMeta &&
        isBusinessOnlyRequestRow(selectedRequestMeta)
      ) {
        const fallback = buildBusinessRequestFallbackMessages(sessionId);
        setMessages(fallback);
        setSessionMessagesMap((prev) => ({
          ...prev,
          [sessionId]: fallback,
        }));
        return;
      }

      const supplierFallback =
        selectedRequestMeta && isSupplierTaskMeta(selectedRequestMeta)
          ? buildSupplierTaskFallbackMessages(sessionId, selectedRequestMeta)
          : [];

      const finalMessages =
        normalized.length > 0
          ? normalized
          : supplierFallback.length > 0
          ? supplierFallback
          : sessionMessagesMap[sessionId] || [];

      setMessages(finalMessages);
      setSessionMessagesMap((prev) => ({
        ...prev,
        [sessionId]: finalMessages,
      }));
    } catch (err) {
      console.error("Failed to load history", err);
      setMessages([]);
      setFormForSession(sessionId, null);
    }
  };

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
        chat={{ id: activeSessionId, messages }}
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