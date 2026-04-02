// src/Components/Sidebar/Sidebar.jsx
import React, { useState, useMemo, useEffect } from "react";
import "./Sidebar.css";

import { ChatIcon, EditIcon, PlusIcon, SunIcon, MoonIcon } from "./icons";

const Sidebar = ({
  user,
  chats = [],
  activeId,
  setActive,
  onCreate,
  onRename,
  theme,
  toggleTheme,
  onLogout,
  sidebarOpen,
  setSidebarOpen,

  // parent can listen to toggle change
  onAgentModeChange,
}) => {
  const [search, setSearch] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);

  // Agent mode toggle state
  const [agentMode, setAgentMode] = useState(false);

  // ✅ prevent double click while creating
  const [creating, setCreating] = useState(false);

  // ✅ FIX: Cognito attribute is "profile" (Customer/Supplier)
  const roleRaw = user?.profile || user?.role || user?.Profile || "";
  const role = String(roleRaw).toLowerCase(); // "customer" / "supplier" / ""
  const isCustomer = role === "customer";
  const isSupplier = role === "supplier";
  const isRoleBasedView = isCustomer || isSupplier;

  useEffect(() => {
    const saved = localStorage.getItem("agentMode");
    if (saved !== null) setAgentMode(saved === "true");
  }, []);

  const handleAgentToggle = (checked) => {
    setAgentMode(checked);
    localStorage.setItem("agentMode", String(checked));
    onAgentModeChange?.(checked);
  };

  const sortedChats = useMemo(() => {
    return [...chats].sort((a, b) => {
      const timeA = new Date(a.createdAt || 0).getTime();
      const timeB = new Date(b.createdAt || 0).getTime();
      return timeB - timeA;
    });
  }, [chats]);

  const filteredChats = useMemo(() => {
    // ✅ In role-based view, do NOT use search filter
    if (isRoleBasedView) return sortedChats;

    if (!search.trim()) return sortedChats;
    const q = search.trim().toLowerCase();
    return sortedChats.filter((c) => (c.title || "").toLowerCase().includes(q));
  }, [search, sortedChats, isRoleBasedView]);

  const toggleSidebar = () => {
    setSidebarOpen(!sidebarOpen);
    setProfileOpen(false);
  };

  const handleRename = (chatId, currentTitle) => {
    const newTitle = prompt("Rename chat", currentTitle || "");
    if (!newTitle || !newTitle.trim()) return;
    onRename?.(chatId, newTitle.trim());
  };

  const handleCreate = async (chatType) => {
    if (!onCreate) return;
    if (creating) return;

    try {
      setCreating(true);
      await onCreate(chatType);
    } finally {
      setCreating(false);
    }
  };

  return (
    <aside className={`sidebar ${sidebarOpen ? "open" : "closed"}`}>
      {/* TOP BAR */}
      <div className="sidebar-topbar">
        <button className="menu-btn" onClick={toggleSidebar} aria-label="Menu">
          ☰
        </button>

        {sidebarOpen && (
          <div className="sidebar-logo">{isCustomer ? "My Assistant" : "ChatAI"}</div>
        )}
      </div>

      {/* ✅ ROLE MENU */}
      {sidebarOpen && isRoleBasedView && (
        <div style={{ padding: "0 12px 10px 12px" }}>
          {/* ✅ Customer buttons */}
          {isCustomer && (
            <>
              <button
                className="new-chat-btn"
                style={{ justifyContent: "flex-start" }}
                onClick={() => handleCreate("customer_request")}
                disabled={creating}
                title={creating ? "Creating..." : "Create"}
              >
                <span>{creating ? "Creating..." : "New Customer Request"}</span>
              </button>

              <button
                className="new-chat-btn"
                style={{ justifyContent: "flex-start", marginTop: 8 }}
                onClick={() => handleCreate("request_monitoring")}
                disabled={creating}
                title={creating ? "Creating..." : "Create"}
              >
                <span>{creating ? "Creating..." : "Request Monitoring & Status"}</span>
              </button>
            </>
          )}

          {/* ✅ Supplier: NO create buttons (only see requests list) */}
          {isSupplier && null}
        </div>
      )}

      {/* SEARCH (hide in role-based view) */}
      {sidebarOpen && !isRoleBasedView && (
        <div className="sidebar-search-container">
          <input
            type="text"
            className="sidebar-search"
            placeholder="Search chats..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          {search && (
            <button
              className="icon-btn clear-btn"
              onClick={() => setSearch("")}
              aria-label="Clear search"
              title="Clear"
            >
              ✖
            </button>
          )}
        </div>
      )}

      {/* NEW CHAT (hide in role-based view) */}
      {sidebarOpen && !isRoleBasedView && (
        <button
          className="new-chat-btn"
          onClick={() => handleCreate("general_chat")}
          disabled={creating}
          title={creating ? "Creating..." : "New Chat"}
        >
          <PlusIcon />
          <span>{creating ? "Creating..." : "New Chat"}</span>
        </button>
      )}

      {/* LABEL */}
      {sidebarOpen && (
        <div className="label">{isRoleBasedView ? "Request" : "Your Chats"}</div>
      )}

      {/* LIST */}
      <div className="chat-list">
        {filteredChats.map((chat) => {
          const preview = (chat.preview || "").toString().slice(0, 120);

          return (
            <div
              key={chat.id}
              className={`chat-item ${chat.id === activeId ? "active" : ""}`}
              onClick={() => setActive(chat.id)}
            >
              <div className="chat-left">
                <ChatIcon />
                {sidebarOpen && (
                  <div className="chat-text">
                    <span className="chat-title" title={chat.title || chat.id || "Item"}>
                      {chat.title || chat.id || "Item"}
                    </span>

                    {!isRoleBasedView && !!preview && (
                      <div className="chat-preview" title={preview}>
                        {preview}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {sidebarOpen && !isRoleBasedView && (
                <div className="chat-actions" onClick={(e) => e.stopPropagation()}>
                  {onRename && (
                    <button
                      className="icon-btn chat-action-btn"
                      onClick={() => handleRename(chat.id, chat.title)}
                      aria-label="Rename"
                      title="Rename"
                    >
                      <EditIcon />
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {sidebarOpen && filteredChats.length === 0 && (
          <div className="no-chats">
            {isRoleBasedView ? "No requests found" : "No chats found"}
          </div>
        )}
      </div>

      {/* PROFILE */}
      {sidebarOpen && (
        <div className="profile-container">
          <div className="agent-toggle-wrapper">
            <span className="agent-toggle-label">Agent Mode</span>

            <label className="switch">
              <input
                type="checkbox"
                checked={agentMode}
                onChange={(e) => handleAgentToggle(e.target.checked)}
              />
              <span className="slider" />
            </label>
          </div>

          <div className="profile-row" onClick={() => setProfileOpen(!profileOpen)}>
            <div className="profile-avatar">{user?.initial || "U"}</div>

            <div className="profile-info">
              <div className="profile-name">{user?.name || "Your Name"}</div>
              <div className="profile-email">{user?.email}</div>
            </div>
          </div>

          {profileOpen && (
            <div className="profile-dropdown">
              <button className="dropdown-item">Help & Support</button>

              <button className="dropdown-item" onClick={onLogout}>
                Sign out
              </button>

              <div className="dropdown-divider"></div>

              {/* ✅ FIXED THEME ROW (clean icon + whole row clickable) */}
              <button
                className="dropdown-item theme-item"
                onClick={toggleTheme}
                type="button"
              >
                <span>Theme</span>

                <span className="theme-icon-btn" aria-hidden="true">
                  {theme === "dark" ? <MoonIcon /> : <SunIcon />}
                </span>
              </button>
            </div>
          )}
        </div>
      )}
    </aside>
  );
};

export default Sidebar;