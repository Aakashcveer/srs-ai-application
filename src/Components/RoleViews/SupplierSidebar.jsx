import React, { useState, useEffect, useMemo } from "react";
import "./RoleSidebar.css";
import { SunIcon, MoonIcon } from "../Sidebar/icons";

const SupplierSidebar = ({
  requests = [],
  groupedSessions = {},
  activeId,
  onSelectRequest,
  user,
  sidebarOpen,
  setSidebarOpen,

  theme,
  toggleTheme,
  onLogout,

  agentMode,
  onAgentModeChange,
}) => {
  const [profileOpen, setProfileOpen] = useState(false);
  const [localAgentMode, setLocalAgentMode] = useState(
    localStorage.getItem("agentMode") === "true"
  );

  useEffect(() => {
    if (typeof agentMode === "boolean") setLocalAgentMode(agentMode);
  }, [agentMode]);

  const handleAgentToggle = (checked) => {
    setLocalAgentMode(checked);
    localStorage.setItem("agentMode", String(checked));
    onAgentModeChange?.(checked);
  };

  const getDisplayAndHover = (r) => {
    const sid = String(r?.sessionId || "").trim();
    const title = String(
      r?.displaySessionId ||
        r?.title ||
        r?.taskName ||
        r?.customerPartName ||
        r?.customerPart ||
        sid
    ).trim();

    const taskId = String(r?.taskId || sid).trim();
    const partNumber = String(r?.customerPartNumber || "").trim();
    const partName = String(r?.customerPartName || "").trim();
    const status = String(r?.taskStatus || r?.status || "").trim();

    let display = title || taskId || sid;

    // Keep sidebar readable.
    if (display.length > 34) {
      display = `${display.slice(0, 31)}...`;
    }

    const hoverParts = [
      title,
      taskId ? `Task ID: ${taskId}` : "",
      status ? `Status: ${status}` : "",
      partNumber ? `Part No: ${partNumber}` : "",
      partName ? `Part Name: ${partName}` : "",
    ].filter(Boolean);

    return {
      display,
      hover: hoverParts.join("\n") || sid,
    };
  };

  const supplierTaskList = useMemo(() => {
    return (groupedSessions?.supplierTask || []).filter(Boolean);
  }, [groupedSessions]);

  return (
    <div className={`role-sidebar ${sidebarOpen ? "" : "collapsed"}`}>
      <div className="role-sidebar-header">
        <button
          className="role-burger"
          onClick={() => {
            setSidebarOpen(!sidebarOpen);
            setProfileOpen(false);
          }}
          aria-label="Menu"
          type="button"
        >
          ☰
        </button>

        <div className="role-title">CHAT UI</div>
      </div>

      <div className="role-section-title">Supplier Task</div>

      <div className="role-list">
        {supplierTaskList.map((r) => {
          const { display, hover } = getDisplayAndHover(r);
          const sessionId = String(r?.sessionId || r?.taskId || "").trim();

          return (
            <button
              key={sessionId}
              className={`role-list-item ${
                activeId === sessionId ? "active" : ""
              }`}
              onClick={() => {
                if (!sessionId) return;
                onSelectRequest?.(sessionId);
              }}
              title={hover}
              type="button"
            >
              <span>{display}</span>
            </button>
          );
        })}

        {!supplierTaskList.length && (
          <div className="role-empty">No supplier tasks found</div>
        )}
      </div>

      <div className="role-footer">
        <div className="agent-toggle-wrapper">
          <span className="agent-toggle-label">Agent Mode</span>

          <label className="switch">
            <input
              type="checkbox"
              checked={localAgentMode}
              onChange={(e) => handleAgentToggle(e.target.checked)}
            />
            <span className="slider" />
          </label>
        </div>

        <div
          className="role-user"
          onClick={() => setProfileOpen((p) => !p)}
          style={{ cursor: "pointer" }}
          title={user?.email}
        >
          <div className="role-avatar">{user?.initial || "U"}</div>

          <div className="role-user-meta">
            <div className="role-user-name">{user?.name || "User"}</div>
            <div className="role-user-email">{user?.email}</div>
          </div>
        </div>

        {profileOpen && (
          <div className="role-profile-dropdown">
            <button
              className="role-dropdown-item"
              onClick={() => setProfileOpen(false)}
              type="button"
            >
              Help &amp; Support
            </button>

            <button
              className="role-dropdown-item"
              onClick={() => {
                setProfileOpen(false);
                onLogout?.();
              }}
              type="button"
            >
              Sign out
            </button>

            <div className="role-dropdown-divider" />

            <button
              className="role-dropdown-item role-theme-item"
              onClick={() => {
                setProfileOpen(false);
                toggleTheme?.();
              }}
              type="button"
            >
              <span>Theme</span>
              <span className="role-theme-icon" aria-hidden="true">
                {theme === "dark" ? <MoonIcon /> : <SunIcon />}
              </span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default SupplierSidebar;