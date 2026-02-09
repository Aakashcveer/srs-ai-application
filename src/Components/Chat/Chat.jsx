// src/Components/Chat/Chat.jsx
import React, { useEffect, useState } from "react";
import Sidebar from "../Sidebar/Sidebar";
import ChatWindow from "../ChatWindow/ChatWindow";

import { getUserProfile, getAccessToken } from "../../AWS/auth";
import { CHAT_CONFIG } from "../../Config/ChatConfig";
import {
  saveSessionState,
  loadSessionState,
  clearSessionState,
} from "../../utils/Sessionstorage";
import { initialiseChat, renameChat, deleteChat } from "../../api/api-config";

import "./Chat.css";

const cleanupTempSessionFromStorage = () => {
  try {
    const raw = localStorage.getItem("chat-session-state");
    if (!raw) return;

    const parsed = JSON.parse(raw);
    if (parsed?.activeSessionId?.startsWith("temp-")) {
      console.warn("🧹 Removing stale temp session from storage");
      localStorage.removeItem("chat-session-state");
    }
  } catch (e) {
    console.warn("Failed to cleanup session storage", e);
    localStorage.removeItem("chat-session-state");
  }
};

const Chat = ({ theme, toggleTheme, onLogout }) => {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [user, setUser] = useState(null);
  const [sessions, setSessions] = useState({});
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [messages, setMessages] = useState([]);

  const [sessionMessagesMap, setSessionMessagesMap] = useState({});

  const [showIdleWarning, setShowIdleWarning] = useState(false);
  const [idleSecondsLeft, setIdleSecondsLeft] = useState(null);

  // ✅ UPDATED: supports attachments + Attachments
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
      };
    });

  const updateMessages = (updater) => {
    setMessages((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;

      if (activeSessionId) {
        setSessionMessagesMap((prevMap) => ({
          ...prevMap,
          [activeSessionId]: next,
        }));
      }

      return next;
    });
  };

  // ===============================
  // ✅ UPDATED: adoptServerSessionId refreshes sessions after server returns real sessionId
  // ===============================
  const adoptServerSessionId = async (serverSessionId) => {
    if (!serverSessionId || !activeSessionId) return;
    if (serverSessionId === activeSessionId) return;

    const oldId = activeSessionId;

    setSessionMessagesMap((prev) => {
      const copy = { ...prev };
      const oldMsgs = copy[oldId] || [];
      copy[serverSessionId] = oldMsgs;
      delete copy[oldId];
      return copy;
    });

    setSessions((prev) => {
      const tasks = (prev.tasks || []).map((s) =>
        s.sessionId === oldId ? { ...s, sessionId: serverSessionId } : s
      );

      const requests = (prev.requests || []).map((s) =>
        s.sessionId === oldId ? { ...s, sessionId: serverSessionId } : s
      );

      return { ...prev, tasks, requests };
    });

    setActiveSessionId(serverSessionId);

    const prevState = loadSessionState();
    saveSessionState({
      activeSessionId: serverSessionId,
      lastActivityAt: Date.now(),
      sessionStartedAt: prevState?.sessionStartedAt || Date.now(),
    });

    // ✅ refresh sessions list from backend so sidebar updates immediately
    try {
      const token = await getAccessToken();
      if (!token || !user?.email) return;

      const init = await initialiseChat(token, user.email, serverSessionId);
      if (init?.sessions) setSessions(init.sessions);

      if (init?.messages) {
        const normalized = normalizeMessages(init.messages || []);
        setMessages(normalized);
        setSessionMessagesMap((prev) => ({
          ...prev,
          [serverSessionId]: normalized,
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
  };

  useEffect(() => {
    cleanupTempSessionFromStorage();

    const init = async () => {
      try {
        const profile = await getUserProfile();
        const token = await getAccessToken();
        if (!profile || !token) return;

        setUser(profile);

        const saved = loadSessionState();
        const requestedId = saved?.activeSessionId || null;
        const safeRequestedId =
          requestedId && requestedId.startsWith("temp-") ? null : requestedId;

        const data = await initialiseChat(token, profile.email, safeRequestedId);

        const sid = data.activeSessionId || null;
        const normalized = normalizeMessages(data.messages || []);

        setSessions(data.sessions || {});
        setActiveSessionId(sid);
        setMessages(normalized);

        if (sid) {
          setSessionMessagesMap((prev) => ({ ...prev, [sid]: normalized }));
        }
      } catch (err) {
        console.error("Initialise failed", err);
      }
    };

    init();
  }, []);

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
      const sessionExpired = now - saved.sessionStartedAt > CHAT_CONFIG.MAX_SESSION_MS;

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

    const title = firstMessage.slice(0, 60);

    setSessions((prev) => {
      const exists = (prev.tasks || []).some((s) => s.sessionId === activeSessionId);

      return {
        requests: prev.requests || [],
        tasks: exists
          ? prev.tasks.map((s) => (s.sessionId === activeSessionId ? { ...s, title } : s))
          : [
              ...(prev.tasks || []),
              {
                sessionId: activeSessionId,
                title,
                createdAt: Date.now(),
              },
            ],
      };
    });

    try {
      const token = await getAccessToken();
      await renameChat(token, user.email, activeSessionId, title);
    } catch (err) {
      console.error("Rename persist failed", err);
    }
  };

  // ===============================
  // ✅ UPDATED: session click uses cache if available, else fetch from backend
  // ===============================
  const handleSessionClick = async (sessionId) => {
    try {
      setActiveSessionId(sessionId);

      if (sessionMessagesMap[sessionId]) {
        setMessages(sessionMessagesMap[sessionId]);
        return;
      }

      const token = await getAccessToken();
      if (!token || !user) return;

      const data = await initialiseChat(token, user.email, sessionId);
      const normalized = normalizeMessages(data.messages || []);

      setMessages(normalized);

      setSessionMessagesMap((prev) => ({
        ...prev,
        [sessionId]: normalized,
      }));
    } catch (err) {
      console.error("Failed to load history", err);
      setMessages([]);
    }
  };

  const handleRenameChat = async (sessionId) => {
    const newTitle = prompt("Rename chat");
    if (!newTitle || !user) return;

    try {
      const token = await getAccessToken();
      await renameChat(token, user.email, sessionId, newTitle);

      setSessions((prev) => ({
        requests: (prev.requests || []).map((s) =>
          s.sessionId === sessionId ? { ...s, title: newTitle } : s
        ),
        tasks: (prev.tasks || []).map((s) =>
          s.sessionId === sessionId ? { ...s, title: newTitle } : s
        ),
      }));
    } catch (err) {
      console.error("Rename failed", err);
    }
  };

  const handleDeleteChat = async (sessionId) => {
    if (!window.confirm("Delete this chat?")) return;

    try {
      const token = await getAccessToken();
      await deleteChat(token, user.email, sessionId);

      setSessions((prev) => ({
        requests: (prev.requests || []).filter((s) => s.sessionId !== sessionId),
        tasks: (prev.tasks || []).filter((s) => s.sessionId !== sessionId),
      }));

      setSessionMessagesMap((prev) => {
        const copy = { ...prev };
        delete copy[sessionId];
        return copy;
      });

      if (activeSessionId === sessionId) {
        handleNewChat();
      }
    } catch (err) {
      console.error("Delete failed", err);
    }
  };

  return (
    <div className="chat-layout">
      {showIdleWarning && (
        <div className="idle-warning-banner">
          ⚠️ You’ll be logged out in <strong>{idleSecondsLeft}</strong> seconds due to inactivity
        </div>
      )}

      <Sidebar
        user={user}
        chats={[...(sessions?.requests || []), ...(sessions?.tasks || [])]
          .map((s) => ({
            ...s,
            _sortTime: s.lastActivityAt || s.updatedAt || s.createdAt || 0,
          }))
          .sort((a, b) => (b._sortTime || 0) - (a._sortTime || 0))
          .map((s) => ({
            id: s.sessionId,
            title: s.title || "Chat",
            createdAt: s.createdAt || s._sortTime,
          }))}
        activeId={activeSessionId}
        setActive={handleSessionClick}
        onCreate={handleNewChat}
        onRename={handleRenameChat}
        onDelete={handleDeleteChat}
        theme={theme}
        toggleTheme={toggleTheme}
        onLogout={onLogout}
        sidebarOpen={sidebarOpen}
        setSidebarOpen={setSidebarOpen}
      />

      {/* ✅ REQUIRED FIX: remove key so ChatWindow does NOT remount on sessionId adoption */}
      <ChatWindow
        chat={{ id: activeSessionId, messages }}
        updateMessages={updateMessages}
        user={user}
        onFirstMessage={handleAutoRename}
        adoptServerSessionId={adoptServerSessionId}
        showIdleWarning={showIdleWarning}
        idleSecondsLeft={idleSecondsLeft}
      />
    </div>
  );
};

export default Chat;
