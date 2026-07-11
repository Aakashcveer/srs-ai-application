import React, { useMemo } from "react";
import "./WorkflowFulfillmentBar.css";

const WORKFLOW_STEPS = [
  {
    key: "REQUEST-CREATE",
    label: "Request Created",
    description: "Customer request has been created.",
  },
  {
    key: "REQUEST-REVIEW",
    label: "Request Review",
    description: "Request is under review / email sent.",
  },
  {
    key: "EMAIL-REVIEW",
    label: "Email Review",
    description: "Customer reply is waiting for engineering review.",
  },
  {
    key: "REQUEST-CONFIRMED",
    label: "Request Confirmed",
    description: "Customer confirmed the request.",
  },
  {
    key: "ASSESSMENT-TRIGGERED",
    label: "Assessment Triggered",
    description: "Assessment workflow has been triggered.",
  },
  {
    key: "ASSESSMENT-INPROGRESS",
    label: "Assessment In Progress",
    description: "AI / assessment process is running.",
  },
  {
    key: "ASSESSMENT-COMPLETED",
    label: "Assessment Completed",
    description: "Assessment output has been generated.",
  },
  {
    key: "RESULTS-REVIEW",
    label: "Results Review",
    description: "Results are waiting for review.",
  },
  {
    key: "RESULTS-APPROVED",
    label: "Results Approved",
    description: "Results have been approved.",
  },
  {
    key: "RESULTS-SUBMITTED",
    label: "Results Submitted",
    description: "Results have been submitted.",
  },
  {
    key: "REPORT-GENERATED",
    label: "Report Generated",
    description: "Assessment report has been generated.",
  },
  {
    key: "REPORT-DELIVERY",
    label: "Report Delivery",
    description: "Secure report link has been sent to the customer.",
  },
  {
    key: "REQUEST-CLOSED",
    label: "Request Closed",
    description: "Request lifecycle is complete.",
  },
];

const normalizeStatus = (status = "") => {
  const value = String(status || "")
    .trim()
    .toUpperCase()
    .replace(/_/g, "-")
    .replace(/\s+/g, "-");

  // Same state, alternate spelling only. No business-state remapping.
  if (value === "ASSESSMENT-IN-PROGRESS") return "ASSESSMENT-INPROGRESS";

  return value;
};

const scrollToElement = (element, block = "center") => {
  if (!element) return false;

  try {
    element.scrollIntoView({
      behavior: "smooth",
      block,
    });
    return true;
  } catch {
    return false;
  }
};

const scrollElementToTop = (element) => {
  if (!element) return false;

  try {
    element.scrollTo({
      top: 0,
      behavior: "smooth",
    });
    return true;
  } catch {
    return false;
  }
};

const getChatScrollContainers = () => [
  document.querySelector(".chatMessages"),
  document.querySelector(".chat-messages"),
  document.querySelector(".messagesContainer"),
  document.querySelector(".chat-window"),
  document.querySelector(".chatWindow"),
  document.querySelector(".chat-main"),
  document.querySelector(".chatMain"),
  document.querySelector(".chat-window-shell"),
  document.querySelector(".chatWindowShell"),
  document.scrollingElement,
  document.documentElement,
  document.body,
];

const getChatSearchRoot = () => {
  return (
    document.querySelector(".chatMessages") ||
    document.querySelector(".chat-messages") ||
    document.querySelector(".messagesContainer") ||
    document.querySelector(".chat-window") ||
    document.querySelector(".chatWindow") ||
    document.querySelector(".chat-main") ||
    document.querySelector(".chatMain") ||
    document.body
  );
};

const scrollToPageTop = () => {
  const scrollCandidates = getChatScrollContainers();

  for (const element of scrollCandidates) {
    if (scrollElementToTop(element)) return true;
  }

  window.scrollTo({
    top: 0,
    behavior: "smooth",
  });

  return true;
};

const findExactWorkflowTarget = (statusKey) => {
  return (
    document.getElementById(`workflow-${statusKey}`) ||
    document.querySelector(`[data-workflow-status="${statusKey}"]`) ||
    document.querySelector(`[data-status="${statusKey}"]`)
  );
};

const STATUS_TEXT_MATCHERS = {
  "REQUEST-CREATE": [
    "select customer name",
    "i have prepared the customer request form",
    "customer request form",
  ],
  "REQUEST-REVIEW": [
    "email sent successfully",
    "status moved to request-review",
    "request-review",
  ],
  "EMAIL-REVIEW": [
    "customer email reply received",
    "status moved to email-review",
    "email-review",
    "customer reply requires review",
  ],
  "REQUEST-CONFIRMED": [
    "customer reply processed successfully",
    "status moved to request-confirmed",
    "request-confirmed",
  ],
  "ASSESSMENT-TRIGGERED": [
    "assessment triggered",
    "assessment triggered ✓",
    "submit for assessment",
    "assessment submitted",
    "status moved to assessment-triggered",
  ],
  "ASSESSMENT-INPROGRESS": [
    "assessment-inprogress",
    "assessment in progress",
    "assessment process is running",
  ],
  "ASSESSMENT-COMPLETED": [
    "assessment-completed",
    "assessment completed",
    "assessment report package ready",
    "assessment output has been generated",
  ],
  "RESULTS-REVIEW": ["results-review", "results review"],
  "RESULTS-APPROVED": ["results-approved", "results approved"],
  "RESULTS-SUBMITTED": ["results-submitted", "results submitted"],
  "REPORT-GENERATED": [
    "report-generated",
    "report generated",
    "assessment report package ready",
    "published pdf",
  ],
  "REPORT-DELIVERY": [
    "report-delivery",
    "report delivery",
    "review secure report delivery email",
    "secure report link sent",
    "secure report link draft",
  ],
  "REQUEST-CLOSED": [
    "request-closed",
    "request closed",
    "customer downloaded the secure assessment report",
    "customer submitted feedback",
    "request lifecycle is complete",
  ],
};

const findWorkflowTargetByText = (statusKey) => {
  const root = getChatSearchRoot();
  if (!root) return null;

  const matchers = STATUS_TEXT_MATCHERS[statusKey] || [];
  if (!matchers.length) return null;

  const candidates = Array.from(
    root.querySelectorAll(
      [
        ".msg-row",
        ".msg-bubble",
        ".emailDraftShell",
        ".emailSentConfirmationCard",
        ".requestSummaryCard",
        ".assessmentReportCard",
        ".formCardPremium",
        ".customer-request-inline-card",
        ".markdown-body",
      ].join(",")
    )
  );

  const visibleCandidates = candidates.filter((element) => {
    if (!element || !element.textContent) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });

  for (const matcher of matchers) {
    const needle = String(matcher || "").toLowerCase();
    const found = visibleCandidates.find((element) =>
      String(element.textContent || "").toLowerCase().includes(needle)
    );

    if (found) return found;
  }

  return null;
};

const WorkflowFulfillmentBar = ({
  requestStatus,
  workflowSections = {},
  onStepClick,
}) => {
  const currentStatus = normalizeStatus(requestStatus);

  const currentIndex = useMemo(() => {
    return WORKFLOW_STEPS.findIndex((step) => step.key === currentStatus);
  }, [currentStatus]);

  if (!currentStatus || currentIndex === -1) return null;

  const progressPercent =
    WORKFLOW_STEPS.length > 1
      ? (currentIndex / (WORKFLOW_STEPS.length - 1)) * 100
      : 0;

  const handleStepClick = (step) => {
    if (!step?.key) return;

    if (typeof onStepClick === "function") {
      onStepClick(step.key);
      return;
    }

    const sectionRef = workflowSections?.[step.key];

    if (sectionRef?.current) {
      scrollToElement(sectionRef.current);
      return;
    }

    const exactTarget = findExactWorkflowTarget(step.key);

    if (exactTarget) {
      scrollToElement(exactTarget);
      return;
    }

    const textTarget = findWorkflowTargetByText(step.key);

    if (textTarget) {
      scrollToElement(textTarget, "center");
      return;
    }

    if (step.key === "REQUEST-CREATE") {
      const createTarget =
        document.querySelector(".formCardPremium") ||
        document.querySelector(".request-form-shell") ||
        document.querySelector(".customer-request-inline-card");

      if (scrollToElement(createTarget, "start")) return;

      scrollToPageTop();
      return;
    }

    // No guessed fallback target. If the exact workflow section is not
    // present in the chat yet, keep the user where they are.
  };

  return (
    <div
      className="workflow-fulfillment-wrapper"
      aria-label="Request Progress Timeline"
    >
      <div className="workflow-fulfillment-header">
        <span className="workflow-fulfillment-title">
          Request Progress Timeline
        </span>
      </div>

      <div className="workflow-fulfillment-card">
        <div className="workflow-track">
          <div
            className="workflow-track-fill"
            style={{ height: `${progressPercent}%` }}
          />

          {WORKFLOW_STEPS.map((step, index) => {
            const isCompleted = index < currentIndex;
            const isCurrent = index === currentIndex;
            const isPending = index > currentIndex;

            return (
              <button
                key={step.key}
                type="button"
                className={[
                  "workflow-step-dot",
                  isCompleted ? "completed" : "",
                  isCurrent ? "current" : "",
                  isPending ? "pending" : "",
                ].join(" ")}
                style={{
                  top: `${(index / (WORKFLOW_STEPS.length - 1)) * 100}%`,
                }}
                onClick={() => handleStepClick(step)}
                aria-label={step.label}
              >
                <span className="workflow-tooltip">
                  <strong>{step.key}</strong>
                  <small>{step.description}</small>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default WorkflowFulfillmentBar;
