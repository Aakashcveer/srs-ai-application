import React, { useMemo, useState, useEffect } from "react";
import "./RoleSidebar.css";
import { SunIcon, MoonIcon } from "../Sidebar/icons";

const CustomerSidebar = ({
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

  onCreate,

  agentMode,
  onAgentModeChange,
}) => {
  const [profileOpen, setProfileOpen] = useState(false);
  const [localAgentMode, setLocalAgentMode] = useState(
    localStorage.getItem("agentMode") === "true"
  );

  useEffect(() => {
    if (typeof agentMode === "boolean") {
      setLocalAgentMode(agentMode);
    }
  }, [agentMode]);

  const handleAgentToggle = (checked) => {
    setLocalAgentMode(checked);
    localStorage.setItem("agentMode", String(checked));
    onAgentModeChange?.(checked);
  };

  const getDisplayAndHover = (r) => {
    const display =
      String(r?.displaySessionId || "").trim() ||
      String(r?.sessionId || "").trim() ||
      String(r?.title || "").trim();

    const hoverMeta = r?.hoverMeta || {};
    const partNo = String(hoverMeta?.partNo || "").trim();
    const partName = String(hoverMeta?.partName || "").trim();

    let hover = "";
    if (partNo || partName) {
      hover = [
        partNo ? `PartNo: ${partNo}` : "",
        partName ? `PartName: ${partName}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    } else {
      hover =
        String(r?.title || "").trim() ||
        String(r?.sessionId || "").trim() ||
        display;
    }

    return { display, hover };
  };

  const customerRequestList = useMemo(() => {
    return (groupedSessions?.customerRequest || []).filter(Boolean);
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

      <div className="role-section-title">Customer Request</div>

      <div className="role-list">
        {customerRequestList.map((r) => {
          const { display, hover } = getDisplayAndHover(r);

          return (
            <button
              key={r.sessionId}
              className={`role-list-item ${
                activeId === r.sessionId ? "active" : ""
              }`}
              onClick={() => onSelectRequest?.(r.sessionId)}
              title={hover}
              type="button"
            >
              <span>{display}</span>
            </button>
          );
        })}

        {!customerRequestList.length && (
          <div className="role-empty">
            <div>No customer requests yet</div>
          </div>
        )}
      </div>

      <div className="role-footer">
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

export default CustomerSidebar;