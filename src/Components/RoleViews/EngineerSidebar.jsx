import React, { useMemo, useState } from "react";
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
}) => {
  const [profileOpen, setProfileOpen] = useState(false);

  // Local optimistic "seen" tracking:
  // As soon as the engineer opens a highlighted supplier task, remove the
  // yellow highlighter from the sidebar immediately. Backend can persist the
  // seen flag when the task details are loaded.
  const [locallySeenSupplierTaskIds, setLocallySeenSupplierTaskIds] = useState(() => {
    try {
      const saved = JSON.parse(
        localStorage.getItem("engineerSeenSupplierTasks") || "[]"
      );
      return new Set(Array.isArray(saved) ? saved : []);
    } catch (e) {
      return new Set();
    }
  });



  const normalizeText = (value) => String(value || "").trim().toLowerCase();

  const isCustomerLauncher = (item) => {
    const title = normalizeText(item?.title);
    const sessionId = normalizeText(item?.sessionId);
    const sessionType = normalizeText(item?.sessionType || item?.SessionType);

    return (
      sessionId === "new customer request" ||
      (sessionType === "my assistant" && title === "customer request")
    );
  };

  const isSupplierLauncher = (item) => {
    const title = normalizeText(item?.title);
    const sessionId = normalizeText(item?.sessionId);
    const sessionType = normalizeText(item?.sessionType || item?.SessionType);

    return (
      sessionId === "new supplier request" ||
      (sessionType === "my assistant" && title === "supplier request")
    );
  };

  const isMonitoringLauncher = (item) => {
    const title = normalizeText(item?.title);
    const sessionId = normalizeText(item?.sessionId);

    return (
      sessionId === "request monitoring & status" ||
      title === "request monitoring & status"
    );
  };

  const isAssistantLauncher = (item) => {
    return (
      isCustomerLauncher(item) ||
      isSupplierLauncher(item) ||
      isMonitoringLauncher(item)
    );
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


  const getSupplierUploadedDocumentsCount = (item = {}) => {
    const possibleArrays = [
      item?.uploadedDocuments,
      item?.UploadedDocuments,
      item?.supplierUploadedDocuments,
      item?.SupplierUploadedDocuments,
      item?.supplierUploads,
      item?.SupplierUploads,
      item?.uploadedFiles,
      item?.UploadedFiles,
      item?.documents,
      item?.Documents,
      item?.taskItem?.UploadedDocuments,
      item?.taskItem?.SupplierUploadedDocuments,
      item?.TaskItem?.UploadedDocuments,
      item?.TaskItem?.SupplierUploadedDocuments,
      item?.TaskDetail?.UploadedDocuments,
      item?.TaskDetail?.SupplierUploadedDocuments,
      item?.taskDetail?.uploadedDocuments,
      item?.taskDetail?.supplierUploadedDocuments,
    ];

    for (const value of possibleArrays) {
      if (Array.isArray(value)) return value.length;
    }

    const directCount =
      item?.uploadedDocumentsCount ??
      item?.UploadedDocumentsCount ??
      item?.supplierUploadedDocumentsCount ??
      item?.SupplierUploadedDocumentsCount ??
      item?.uploadCount ??
      item?.UploadCount;

    const numericCount = Number(directCount || 0);
    return Number.isFinite(numericCount) ? numericCount : 0;
  };

  const hasEngineerSeenSupplierTask = (item = {}) => {
    const seenValue =
      item?.EngineerReviewSeen ??
      item?.engineerReviewSeen ??
      item?.EngineerSeen ??
      item?.engineerSeen ??
      item?.isSeenByEngineer ??
      item?.seenByEngineer ??
      item?.reviewSeen;

    if (typeof seenValue === "boolean") return seenValue;

    const normalizedSeen = normalizeText(seenValue);
    if (["true", "yes", "y", "1", "seen"].includes(normalizedSeen)) {
      return true;
    }

    return Boolean(item?.EngineerViewedAt || item?.engineerViewedAt);
  };

  const getSupplierTaskIdentity = (item = {}) => {
    return String(
      item?.sessionId ||
        item?.SessionId ||
        item?.taskId ||
        item?.TaskId ||
        item?.id ||
        ""
    ).trim();
  };

  const shouldHighlightSupplierTask = (item = {}) => {
    const sessionId = getSupplierTaskIdentity(item);
    if (!sessionId) return false;

    if (activeId === sessionId) return false;
    if (locallySeenSupplierTaskIds.has(sessionId)) return false;
    if (hasEngineerSeenSupplierTask(item)) return false;

    const explicitNewFlag =
      item?.hasNewSupplierUpload ??
      item?.HasNewSupplierUpload ??
      item?.newSupplierUpload ??
      item?.NewSupplierUpload ??
      item?.supplierUploadPendingReview ??
      item?.SupplierUploadPendingReview ??
      item?.needsEngineerReview ??
      item?.NeedsEngineerReview;

    if (explicitNewFlag === true) return true;
    if (["true", "yes", "y", "1"].includes(normalizeText(explicitNewFlag))) {
      return true;
    }

    const status = normalizeText(
      item?.taskStatus ||
        item?.TaskStatus ||
        item?.status ||
        item?.Status ||
        item?.requestStatus ||
        item?.RequestStatus
    );

    const uploadedCount = getSupplierUploadedDocumentsCount(item);

    return uploadedCount > 0 && ["review", "pending-review", "pending_review"].includes(status);
  };

  const markSupplierTaskSeenLocally = (sessionId) => {
    const sid = String(sessionId || "").trim();
    if (!sid) return;

    setLocallySeenSupplierTaskIds((prev) => {
      const next = new Set(prev);
      next.add(sid);

      try {
        localStorage.setItem(
          "engineerSeenSupplierTasks",
          JSON.stringify(Array.from(next))
        );
      } catch (e) {
        // localStorage can fail in private mode; sidebar should still work.
      }

      return next;
    });
  };

  const handleSupplierTaskClick = (item) => {
    const sessionId = getSupplierTaskIdentity(item);
    markSupplierTaskSeenLocally(sessionId);
    onSelectRequest?.(sessionId);
  };

  const myAssistantList = useMemo(() => {
    return (groupedSessions?.myAssistant || []).filter((item) =>
      isAssistantLauncher(item)
    );
  }, [groupedSessions]);

  const customerRequestList = useMemo(() => {
    return (groupedSessions?.customerRequest || [])
      .filter((item) => {
        if (!item) return false;
        if (isAssistantLauncher(item)) return false;
        return true;
      })
      .sort((a, b) => {
        const aa = String(a?.lastActivityAt || a?.createdAt || "").trim();
        const bb = String(b?.lastActivityAt || b?.createdAt || "").trim();
        return bb.localeCompare(aa);
      });
  }, [groupedSessions]);

  const supplierTaskList = useMemo(() => {
    return (groupedSessions?.supplierTask || [])
      .filter((item) => {
        if (!item) return false;
        if (isAssistantLauncher(item)) return false;
        return true;
      })
      .sort((a, b) => {
        const aa = String(a?.lastActivityAt || a?.createdAt || "").trim();
        const bb = String(b?.lastActivityAt || b?.createdAt || "").trim();
        return bb.localeCompare(aa);
      });
  }, [groupedSessions]);

  const normalizeAssistantKey = (item) => {
    if (isCustomerLauncher(item)) {
      return "NEW_CUSTOMER_REQUEST";
    }

    if (isSupplierLauncher(item)) {
      return "NEW_SUPPLIER_REQUEST";
    }

    if (isMonitoringLauncher(item)) {
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
      // Engineering landing page / launcher: open the Customer Request Assistant
      // itself. Do not auto-select the newest request from the list below.
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

        <div className="role-title">ASSURE-AI</div>
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
          const isHighlighted = shouldHighlightSupplierTask(r);

          return (
            <button
              key={r.sessionId}
              className={`role-list-item ${
                activeId === r.sessionId ? "active" : ""
              } ${isHighlighted ? "supplier-task-highlighter" : ""}`}
              onClick={() => handleSupplierTaskClick(r)}
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