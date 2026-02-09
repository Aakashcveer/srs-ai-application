// src/Components/Sidebar/Sidebar.jsx
import React, { useState, useMemo } from "react";
import "./Sidebar.css";

import {
  ChatIcon,
  EditIcon,
  DeleteIcon,
  PlusIcon,
  SunIcon,
  MoonIcon,
} from "./icons";

const Sidebar = ({
  user,
  chats = [],
  activeId,
  setActive,
  onCreate,
  onDelete,
  onRename,
  theme,
  toggleTheme,
  onLogout,
  sidebarOpen,
  setSidebarOpen,
}) => {
  const [search, setSearch] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);

  /* ===============================
     SORT CHATS (MEMOIZED)
  =============================== */
  const sortedChats = useMemo(() => {
    return [...chats].sort((a, b) => {
      const timeA = new Date(a.createdAt || 0).getTime();
      const timeB = new Date(b.createdAt || 0).getTime();
      return timeB - timeA;
    });
  }, [chats]);

  const filteredChats = search
    ? sortedChats.filter((c) =>
        (c.title || "").toLowerCase().includes(search.trim().toLowerCase())
      )
    : sortedChats;

  const toggleSidebar = () => {
    setSidebarOpen(!sidebarOpen);
    setProfileOpen(false);
  };

  /* ===============================
     RENAME HANDLER (UI ONLY)
  =============================== */
  const handleRename = (chatId, currentTitle) => {
    const newTitle = prompt("Rename chat", currentTitle || "");
    if (!newTitle || !newTitle.trim()) return;
    onRename?.(chatId, newTitle.trim());
  };

  /* ===============================
     DELETE HANDLER (CONFIRM)
  =============================== */
  const handleDelete = (chatId) => {
    if (!confirm("Delete this chat permanently?")) return;
    onDelete?.(chatId);
  };

  return (
    <aside className={`sidebar ${sidebarOpen ? "open" : "closed"}`}>
      {/* ===============================
          TOP BAR
      =============================== */}
      <div className="sidebar-topbar">
        <button className="menu-btn" onClick={toggleSidebar}>
          ☰
        </button>
        {sidebarOpen && <div className="sidebar-logo">ChatAI</div>}
      </div>

      {/* ===============================
          SEARCH
      =============================== */}
      {sidebarOpen && (
        <div className="sidebar-search-container">
          <input
            type="text"
            className="sidebar-search"
            placeholder="Search chats..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          {search && (
            <button className="icon-btn clear-btn" onClick={() => setSearch("")}>
              ✖
            </button>
          )}
        </div>
      )}

      {/* ===============================
          NEW CHAT
      =============================== */}
      {sidebarOpen && (
        <button className="new-chat-btn" onClick={onCreate}>
          <PlusIcon />
          <span>New Chat</span>
        </button>
      )}

      {sidebarOpen && <div className="label">Your Chats</div>}

      {/* ===============================
          CHAT LIST
      =============================== */}
      <div className="chat-list">
        {filteredChats.map((chat) => (
          <div
            key={chat.id}
            className={`chat-item ${chat.id === activeId ? "active" : ""}`}
            onClick={() => setActive(chat.id)}
          >
            <div className="chat-left">
              <ChatIcon />

              {sidebarOpen && (
                // ✅ Added title attribute so full text visible on hover
                <span className="chat-title" title={chat.title || "New Chat"}>
                  {chat.title || "New Chat"}
                </span>
              )}
            </div>

            {sidebarOpen && (
              // ✅ Stop propagation here so icons never trigger chat open
              <div
                className="chat-actions"
                onClick={(e) => e.stopPropagation()}
              >
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

                {onDelete && (
                  <button
                    className="icon-btn chat-action-btn"
                    onClick={() => handleDelete(chat.id)}
                    aria-label="Delete"
                    title="Delete"
                  >
                    <DeleteIcon />
                  </button>
                )}
              </div>
            )}
          </div>
        ))}

        {sidebarOpen && filteredChats.length === 0 && (
          <div className="no-chats">No chats found</div>
        )}
      </div>

      {/* ===============================
          PROFILE
      =============================== */}
      {sidebarOpen && (
        <div className="profile-container">
          <div
            className="profile-row"
            onClick={() => setProfileOpen(!profileOpen)}
          >
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

              <div className="theme-row">
                <span>Theme</span>
                <button className="icon-btn" onClick={toggleTheme}>
                  {theme === "dark" ? <SunIcon /> : <MoonIcon />}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </aside>
  );
};

export default Sidebar;
