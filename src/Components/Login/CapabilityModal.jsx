import React, { useEffect } from "react";
import "./CapabilityModal.css";

const CapabilityIcon = ({ type }) => {
  if (type === "file") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
    );
  }

  if (type === "ai") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2v3M12 19v3M4.93 4.93l2.12 2.12M16.95 16.95l2.12 2.12M2 12h3M19 12h3M4.93 19.07l2.12-2.12M16.95 7.05l2.12-2.12" />
      </svg>
    );
  }

  if (type === "people") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M19 8v6M22 11h-6" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <line x1="6" y1="20" x2="6" y2="14" />
      <line x1="12" y1="20" x2="12" y2="8" />
      <line x1="18" y1="20" x2="18" y2="4" />
    </svg>
  );
};

const CapabilityModal = ({ capability, onClose }) => {
  useEffect(() => {
    if (!capability) return undefined;

    const handleEscape = (event) => {
      if (event.key === "Escape") onClose();
    };

    document.addEventListener("keydown", handleEscape);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "";
    };
  }, [capability, onClose]);

  if (!capability) return null;

  return (
    <div
      className="capability-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="capability-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="capability-modal-title"
      >
        <button
          type="button"
          className="capability-modal-close"
          onClick={onClose}
          aria-label="Close details"
        >
          ×
        </button>

        <div className="capability-modal-icon" aria-hidden="true">
          <CapabilityIcon type={capability.type} />
        </div>

        <p className="capability-modal-kicker">ASSURE-AI CAPABILITY</p>
        <h3 id="capability-modal-title">{capability.title}</h3>
        <p className="capability-modal-summary">{capability.summary}</p>

        <div className="capability-modal-divider" />

        <h4>Key capabilities</h4>
        <ul>
          {capability.details.map((detail) => (
            <li key={detail}>
              <span className="capability-modal-check" aria-hidden="true">✓</span>
              <span>{detail}</span>
            </li>
          ))}
        </ul>

        <button
          type="button"
          className="capability-modal-action"
          onClick={onClose}
        >
          Close
        </button>
      </section>
    </div>
  );
};

export default CapabilityModal;
