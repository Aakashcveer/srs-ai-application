import React, { useMemo, useState, useEffect } from "react";
import "./RoleSidebar.css";
import { SunIcon, MoonIcon } from "../Sidebar/icons";

const EngineerSidebar = ({
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

  const buildDisplayFromSessionId = (sessionId, sessionType) => {
    const sid = String(sessionId || "").trim();
    const st = String(sessionType || "").toLowerCase().trim();
    if (!sid) return "";

    const parts = sid.split("#").filter(Boolean);

    if (st === "customer request") {
      if (
        parts.length >= 5 &&
        (parts[0].toUpperCase().startsWith("REQC") ||
          parts[0].toUpperCase().startsWith("REQS"))
      ) {
        return parts.slice(0, 3).join("#");
      }
    }

    if (st === "supplier request" || st === "supplier task") {
      if (parts.length >= 6 && parts[0].toUpperCase().startsWith("TSK")) {
        return parts.slice(0, 3).join("#");
      }
    }

    return sid;
  };

  const buildHoverMetaFromSessionId = (sessionId, sessionType) => {
    const sid = String(sessionId || "").trim();
    const st = String(sessionType || "").toLowerCase().trim();
    const parts = sid.split("#").filter(Boolean);

    if (st === "customer request") {
      if (
        parts.length >= 5 &&
        (parts[0].toUpperCase().startsWith("REQC") ||
          parts[0].toUpperCase().startsWith("REQS"))
      ) {
        return {
          partNo: String(parts[3] || "").trim(),
          partName: String(parts.slice(4).join("#") || "").trim(),
        };
      }
    }

    if (st === "supplier request" || st === "supplier task") {
      if (parts.length >= 6 && parts[0].toUpperCase().startsWith("TSK")) {
        return {
          supplierName: String(parts[3] || "").trim(),
          partNo: String(parts[4] || "").trim(),
          partName: String(parts.slice(5).join("#") || "").trim(),
        };
      }
    }

    return {};
  };

  const getDisplayAndHover = (r) => {
    const sessionId = String(r?.sessionId || "").trim();
    const sessionType = String(r?.sessionType || "").trim();
    const title = String(r?.title || "").trim();

    const display =
      String(r?.displaySessionId || "").trim() ||
      buildDisplayFromSessionId(sessionId, sessionType) ||
      sessionId ||
      title;

    const serverHoverMeta = r?.hoverMeta || {};
    const parsedHoverMeta = buildHoverMetaFromSessionId(sessionId, sessionType);

    const supplierName = String(
      serverHoverMeta?.supplierName || parsedHoverMeta?.supplierName || ""
    ).trim();
    const partNo = String(
      serverHoverMeta?.partNo || parsedHoverMeta?.partNo || ""
    ).trim();
    const partName = String(
      serverHoverMeta?.partName || parsedHoverMeta?.partName || ""
    ).trim();

    let hover = "";
    if (supplierName || partNo || partName) {
      hover = [
        supplierName ? `Supplier: ${supplierName}` : "",
        partNo ? `PartNo: ${partNo}` : "",
        partName ? `PartName: ${partName}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    } else {
      hover = title || sessionId || display;
    }

    return { display, hover };
  };

  const myAssistantList = useMemo(() => {
    return (groupedSessions?.myAssistant || []).filter(Boolean);
  }, [groupedSessions]);

  const customerRequestList = useMemo(() => {
    return (groupedSessions?.customerRequest || []).filter(Boolean);
  }, [groupedSessions]);

  const supplierTaskList = useMemo(() => {
    return (groupedSessions?.supplierTask || []).filter(Boolean);
  }, [groupedSessions]);

  const normalizeAssistantKey = (item) => {
    const title = String(item?.title || "").toLowerCase().trim();
    const sessionId = String(item?.sessionId || "").toLowerCase().trim();

    if (
      title.includes("customer request") ||
      sessionId === "new customer request"
    ) {
      return "NEW_CUSTOMER_REQUEST";
    }

    if (
      title.includes("supplier request") ||
      title.includes("supplier task") ||
      sessionId === "new supplier request"
    ) {
      return "NEW_SUPPLIER_REQUEST";
    }

    if (
      title.includes("monitoring") ||
      title.includes("status") ||
      sessionId === "request monitoring & status"
    ) {
      return "REQUEST_MONITORING_STATUS";
    }

    return "";
  };

  const isAssistantActive = (item) => {
    if (!item?.sessionId) return false;
    return activeId === item.sessionId;
  };

  const handleAssistantClick = (item) => {
    const mappedChatType = normalizeAssistantKey(item);

    if (mappedChatType === "NEW_CUSTOMER_REQUEST") {
      if (item?.sessionId) {
        onSelectRequest?.(item.sessionId);
        return;
      }
      onCreate?.("NEW_CUSTOMER_REQUEST");
      return;
    }

    if (mappedChatType === "NEW_SUPPLIER_REQUEST") {
      if (item?.sessionId) {
        onSelectRequest?.(item.sessionId);
        return;
      }
      onCreate?.("NEW_SUPPLIER_REQUEST");
      return;
    }

    if (mappedChatType === "REQUEST_MONITORING_STATUS") {
      if (item?.sessionId) {
        onSelectRequest?.(item.sessionId);
        return;
      }
      onCreate?.("REQUEST_MONITORING_STATUS");
      return;
    }

    if (item?.sessionId) {
      onSelectRequest?.(item.sessionId);
    }
  };

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

      <div className="role-section-title">My Assistant</div>

      <div className="role-menu">
        {myAssistantList.map((item) => (
          <button
            key={item.sessionId}
            className={`role-menu-item ${
              isAssistantActive(item) ? "active" : ""
            }`}
            onClick={() => handleAssistantClick(item)}
            title={item?.title || item?.sessionId}
            type="button"
          >
            {item?.title || item?.sessionId}
          </button>
        ))}

        {!myAssistantList.length && (
          <div className="role-empty">
            <div>No assistant items found</div>
          </div>
        )}
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
            <div className="role-empty-subtext">
              Create a new request from My Assistant
            </div>
          </div>
        )}
      </div>

      <div className="role-section-title">Supplier Task</div>

      <div className="role-list">
        {supplierTaskList.map((r) => {
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

        {!supplierTaskList.length && (
          <div className="role-empty">
            <div>No supplier tasks yet</div>
          </div>
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

export default EngineerSidebar;