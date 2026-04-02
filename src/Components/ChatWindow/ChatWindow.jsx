import React, { useEffect, useRef, useState, useLayoutEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { FolderOpen, PlusCircle, ChevronDown } from "lucide-react";
import "./ChatWindow.css";
import { UploadIcon, SendIcon } from "./InputIcons";
import MarkdownRenderer from "./MarkdownRenderer";
import {
  sendChatMessage,
  uploadFilePresigned,
  downloadFilePresigned,
  confirmFileUploadAndType,
  saveGeneratedForm,
} from "../../api/api-config";
import { getAccessToken } from "../../AWS/auth";

/* ===============================
   ✅ DocType Popover (anchored)
   =============================== */
const DocTypePopover = ({ anchorRef, fileName, onSelect, onSkip }) => {
  const [pos, setPos] = useState({ top: 0, left: 0, arrowLeft: 0 });

  useLayoutEffect(() => {
    const el = anchorRef?.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const width = 320;
    const height = 250;
    const gap = 50;

    let top = rect.top - height - gap;
    let left = rect.left + rect.width / 2 - width / 2;

    left = Math.max(12, Math.min(left, window.innerWidth - width - 12));
    top = Math.max(12, top);

    let arrowLeft = rect.left + rect.width / 2 - left;
    arrowLeft = Math.max(24, Math.min(arrowLeft, width - 24));

    setPos({ top, left, arrowLeft });
  }, [anchorRef]);

  return createPortal(
    <>
      <div className="docTypeBackdrop" onClick={onSkip} />

      <div
        className="docTypePopover"
        style={{ top: pos.top, left: pos.left }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="docTypeArrow" style={{ left: pos.arrowLeft }} />

        <div className="docTitle">What type of document is this?</div>

        <div className="docFileName" title={fileName}>
          {fileName}
        </div>

        <button onClick={() => onSelect("REGULATORY_COMPLIANCE")}>
          Regulatory / Compliance Document
        </button>

        <button onClick={() => onSelect("CAD_DRAWING")}>CAD Drawing</button>

        <button onClick={() => onSelect("MATERIAL_SPEC")}>
          Material Specification
        </button>

        <button onClick={() => onSelect("OTHER")}>Other</button>

        <div className="docSkip" onClick={onSkip}>
          Skip (Other)
        </div>
      </div>
    </>,
    document.body
  );
};

/* ===============================
   ✅ Form Editor
   =============================== */
const defaultFormTemplate = () => ({
  title: "Generated Form",
  fields: [
    { key: "name", label: "Name", type: "text", value: "", required: true },
    { key: "email", label: "Email", type: "email", value: "", required: true },
    { key: "phone", label: "Phone", type: "text", value: "", required: false },
    { key: "notes", label: "Notes", type: "textarea", value: "", required: false },
  ],
});

const PRIORITY_OPTIONS = ["Low", "Medium", "High", "Critical"];

const buildCustomerRequestFormDraft = (raw = {}) => {
  const safe = raw && typeof raw === "object" ? raw : {};

  const customerName = safe.CustomerName ?? "";
  const customerPartName = safe.CustomerPartName ?? "";
  const customerPartNumber = safe.CustomerPartNumber ?? "";
  const requestDescription = safe.RequestDescription ?? "";
  const requestCompletionDate = safe.RequestCompletionDate ?? "";
  const requestPriority = safe.RequestPriority ?? "Medium";

  const existingFields = Array.isArray(safe.fields) ? safe.fields : [];

  const getExistingField = (key) => existingFields.find((f) => f?.key === key);

  const makeField = (key, label, type, value, required = true) => {
    const existing = getExistingField(key);
    return {
      ...(existing || {}),
      key,
      label: existing?.label || label,
      type: existing?.type || type,
      required: existing?.required ?? required,
      value:
        safe[key] !== undefined && safe[key] !== null
          ? safe[key]
          : existing?.value ?? value,
    };
  };

  return {
    ...safe,
    title: safe.title || "Customer Request",
    CustomerName: customerName,
    CustomerPartName: customerPartName,
    CustomerPartNumber: customerPartNumber,
    RequestDescription: requestDescription,
    RequestCompletionDate: requestCompletionDate,
    RequestPriority: requestPriority,
    fields: [
      makeField("CustomerName", "Customer Name", "text", customerName, true),
      makeField("CustomerPartName", "Customer Part Name", "text", customerPartName, true),
      makeField("CustomerPartNumber", "Customer Part Number", "text", customerPartNumber, true),
      makeField("RequestDescription", "Request Description", "textarea", requestDescription, true),
      makeField("RequestCompletionDate", "Request Completion Date", "date", requestCompletionDate, true),
      makeField("RequestPriority", "Request Priority", "text", requestPriority, true),
    ],
  };
};

const FormEditorCard = ({ formDraft, setFormDraft, onSave, saving, saveMsg }) => {
  const [isSubmitted, setIsSubmitted] = useState(false);

  useEffect(() => {
    setIsSubmitted(false);
  }, [formDraft]);

  useEffect(() => {
    if (typeof saveMsg === "string" && saveMsg.includes("✅")) {
      setIsSubmitted(true);
    }
  }, [saveMsg]);

  if (!formDraft) return null;

  const isCustomerRequestForm =
    (formDraft?.fields || []).some((f) =>
      [
        "CustomerName",
        "CustomerPartName",
        "CustomerPartNumber",
        "RequestDescription",
        "RequestCompletionDate",
        "RequestPriority",
      ].includes(f?.key)
    ) ||
    [
      "CustomerName",
      "CustomerPartName",
      "CustomerPartNumber",
      "RequestDescription",
      "RequestCompletionDate",
      "RequestPriority",
    ].some((key) => formDraft?.[key] !== undefined);

  const updateField = (key, nextVal) => {
    setFormDraft((prev) => {
      if (!prev) return prev;
      const next = { ...prev, [key]: nextVal };
      next.fields = (next.fields || []).map((f) =>
        f.key === key ? { ...f, value: nextVal } : f
      );
      return next;
    });
  };

  const getFieldValue = (field) => {
    if (formDraft?.[field.key] !== undefined && formDraft?.[field.key] !== null) {
      return formDraft[field.key];
    }
    return field?.value ?? "";
  };

  const renderStandardField = (f) => {
    const value = getFieldValue(f);

    if (f.type === "textarea") {
      return (
        <textarea
          className="formInput formTextarea"
          value={value}
          onChange={(e) => updateField(f.key, e.target.value)}
          placeholder={`Enter ${f.label}`}
          rows={3}
        />
      );
    }

    return (
      <input
        className="formInput"
        type={f.type || "text"}
        value={value}
        onChange={(e) => updateField(f.key, e.target.value)}
        placeholder={`Enter ${f.label}`}
      />
    );
  };

  if (!isCustomerRequestForm) {
    return (
      <div className="formCard">
        <div className="formHeader">
          <div className="formTitle">{formDraft.title || "Generated Form"}</div>
          <div className="formHint">Edit only the right side</div>
        </div>

        <div className="formGrid">
          <div className="formLeft">
            {(formDraft.fields || []).map((f) => (
              <div key={f.key} className="formLabelRow">
                <div className="formLabel">
                  {f.label}
                  {f.required ? <span className="formReq">*</span> : null}
                </div>
              </div>
            ))}
          </div>

          <div className="formRight">
            {(formDraft.fields || []).map((f) => (
              <div key={f.key} className="formInputRow">
                {renderStandardField(f)}
              </div>
            ))}
          </div>
        </div>

        <div className="formFooter">
          <button className="formSaveBtn" onClick={onSave} disabled={saving || isSubmitted}>
            {isSubmitted ? "Submitted" : saving ? "Submitting..." : "Submit"}
          </button>
          {saveMsg ? <div className="formSaveMsg">{saveMsg}</div> : null}
        </div>
      </div>
    );
  }

  const allFields = formDraft.fields || [];

  const customerFields = allFields.filter((f) =>
    ["CustomerName", "CustomerPartName", "CustomerPartNumber"].includes(f.key)
  );

  const requestFields = allFields.filter((f) =>
    ["RequestDescription", "RequestCompletionDate"].includes(f.key)
  );

  const priorityField =
    allFields.find((f) => f.key === "RequestPriority") || {
      key: "RequestPriority",
      label: "Request Priority",
      type: "text",
      value: formDraft?.RequestPriority || "Medium",
      required: true,
    };

  const getPriorityClass = (level) => {
    const value = String(level || "").toLowerCase();
    if (value === "low") return "low";
    if (value === "medium") return "medium";
    if (value === "high") return "high";
    if (value === "critical") return "critical";
    return "";
  };

  const getValueByKey = (key) => {
    const field = allFields.find((f) => f.key === key);
    if (field) return getFieldValue(field);
    return formDraft?.[key] ?? "";
  };

  const customerName = String(getValueByKey("CustomerName") || "").trim();
  const customerPartName = String(getValueByKey("CustomerPartName") || "").trim();
  const customerPartNumber = String(getValueByKey("CustomerPartNumber") || "").trim();
  const requestDescription = String(getValueByKey("RequestDescription") || "").trim();
  const requestCompletionDate = String(getValueByKey("RequestCompletionDate") || "").trim();
  const selectedPriority = String(getFieldValue(priorityField) || "Medium");

  const requiredChecks = [
    { key: "CustomerName", label: "Customer Name", value: customerName },
    { key: "CustomerPartName", label: "Customer Part Name", value: customerPartName },
    { key: "CustomerPartNumber", label: "Customer Part Number", value: customerPartNumber },
    { key: "RequestDescription", label: "Request Description", value: requestDescription },
    { key: "RequestCompletionDate", label: "Request Completion Date", value: requestCompletionDate },
    { key: "RequestPriority", label: "Request Priority", value: selectedPriority },
  ];

  const missingRequired = requiredChecks.filter((item) => !String(item.value || "").trim());
  const completedCount = requiredChecks.length - missingRequired.length;
  const progressPercent = Math.round((completedCount / requiredChecks.length) * 100);

  const customerSectionComplete =
    !!customerName && !!customerPartName && !!customerPartNumber;

  const requestSectionComplete =
    !!requestDescription && !!requestCompletionDate && !!selectedPriority;

  const formReady = missingRequired.length === 0;

  const renderCustomerRequestField = (f) => {
    const value = getFieldValue(f);
    const isTextarea = f.type === "textarea";
    const isDateField =
      f.key === "RequestCompletionDate" ||
      String(f.label || "").toLowerCase().includes("date");

    const isInvalid =
      f.required && !String(value || "").trim() && missingRequired.some((m) => m.key === f.key);

    const getHelpText = () => {
      if (f.key === "RequestDescription") {
        return "Describe the business need, expected outcome, and any relevant context.";
      }
      if (f.key === "RequestCompletionDate") {
        return "Select the target date for this request.";
      }
      if (f.key === "CustomerPartNumber") {
        return "Use the official customer part number for tracking.";
      }
      return "";
    };

    return (
      <div
        key={f.key}
        className={`premiumFormGroup ${
          f.key === "RequestDescription" ? "premiumFormGroupFull" : ""
        } ${f.key === "CustomerPartNumber" ? "premiumFormGroupFull" : ""}`}
      >
        <label className="premiumFormLabel">
          {f.label}
          {f.required ? <span className="premiumFormReq">*</span> : null}
        </label>

        {isTextarea ? (
          <textarea
            className={`premiumFormInput premiumFormTextarea ${isInvalid ? "is-invalid" : ""}`}
            value={value}
            onChange={(e) => updateField(f.key, e.target.value)}
            placeholder={`Enter ${f.label}`}
            rows={4}
          />
        ) : (
          <input
            className={`premiumFormInput ${isInvalid ? "is-invalid" : ""}`}
            type={isDateField ? "date" : f.type || "text"}
            value={value}
            onChange={(e) => updateField(f.key, e.target.value)}
            placeholder={isDateField ? "" : `Enter ${f.label}`}
          />
        )}

        {!isInvalid && getHelpText() ? (
          <div className="premiumFieldHelp">{getHelpText()}</div>
        ) : null}

        {isInvalid ? (
          <div className="premiumFieldError">{f.label} is required.</div>
        ) : null}
      </div>
    );
  };

  return (
    <div className="request-form-shell">
      <div className="request-form-main">
        <div className="formCard formCardPremium">
          <div className="premiumFormHeader">
            <div>
              <div className="premiumFormEyebrow">Customer Request</div>
              <div className="premiumFormTitle">
                {formDraft.title || "Customer Request"}
              </div>

              <div className="premiumFormMetaRow">
                <div className="premiumMetaBadge draft">
                  <span className="premiumMetaDot" />
                  Draft
                </div>
                <div className={`premiumMetaBadge ${formReady ? "ready" : "pending"}`}>
                  <span className="premiumMetaDot" />
                  {formReady ? "Ready to save" : "Needs attention"}
                </div>
                <div className="premiumMetaBadge">
                  <span className="premiumMetaDot" />
                  {completedCount} / {requiredChecks.length} completed
                </div>
              </div>
            </div>

            <div className="premiumFormHint">Edit and review before save</div>
          </div>

          <div className="requestProgressCard">
            <div className="requestProgressTop">
              <div className="requestProgressTitle">Form completion</div>
              <div className="requestProgressValue">{progressPercent}% complete</div>
            </div>
            <div className="requestProgressTrack">
              <div
                className="requestProgressFill"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>

          <div className={`premiumFormSection ${customerSectionComplete ? "is-complete" : ""}`}>
            <div className="premiumSectionHeader">
              <div className="premiumSectionTitle">Customer Details</div>
              {customerSectionComplete ? (
                <div className="premiumSectionStatus">
                  <span className="premiumSectionStatusDot" />
                  Complete
                </div>
              ) : null}
            </div>
            <div className="premiumSectionSubtitle">
              Basic information used to identify the customer request.
            </div>

            <div className="premiumFormGrid">
              {customerFields.map((f) => renderCustomerRequestField(f))}
            </div>
          </div>

          <div className={`premiumFormSection ${requestSectionComplete ? "is-complete" : ""}`}>
            <div className="premiumSectionHeader">
              <div className="premiumSectionTitle">Request Details</div>
              {requestSectionComplete ? (
                <div className="premiumSectionStatus">
                  <span className="premiumSectionStatusDot" />
                  Complete
                </div>
              ) : null}
            </div>
            <div className="premiumSectionSubtitle">
              Provide the business need, timeline, and urgency for this request.
            </div>

            <div className="premiumFormGrid">
              {requestFields.map((f) => renderCustomerRequestField(f))}
            </div>

            <div className="premiumFormGroup premiumPriorityGroup">
              <label className="premiumFormLabel">
                {priorityField.label}
                {priorityField.required ? <span className="premiumFormReq">*</span> : null}
              </label>

              <div className="premiumFieldHelp">
                Choose the urgency level for this request.
              </div>

              <div className="premiumPriorityGrid">
                {PRIORITY_OPTIONS.map((level) => (
                  <button
                    key={level}
                    type="button"
                    className={`premiumPriorityCard ${getPriorityClass(level)} ${
                      String(selectedPriority).toLowerCase() ===
                      String(level).toLowerCase()
                        ? "active"
                        : ""
                    }`}
                    onClick={() => updateField(priorityField.key, level)}
                  >
                    <span className="premiumPriorityDot" />
                    <span className="premiumPriorityText">{level}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="formFooter premiumFormFooter">
            <div className="premiumFormFooterLeft">
              <div className="premiumFormFooterTitle">
                {formReady ? "Form is ready to save" : "Complete the required fields"}
              </div>
              <div className="premiumFormFooterSub">
                {formReady
                  ? "Review the summary and save this request to the session."
                  : `${missingRequired.length} required field${
                      missingRequired.length > 1 ? "s are" : " is"
                    } still missing.`}
              </div>
            </div>

            <div className="premiumFormFooterActions">
              <button
                type="button"
                className="premiumGhostBtn"
                onClick={() => {
                  console.log("Run an Assistant clicked");
                }}
              >
                Run an Assistant
              </button>

              <button
                className={`formSaveBtn premiumFormSaveBtn ${
                  isSubmitted ? "submitted" : ""
                }`}
                onClick={onSave}
                disabled={saving || isSubmitted}
              >
                {isSubmitted ? "Submitted" : saving ? "Submitting..." : "Submit"}
              </button>
            </div>

            {saveMsg ? <div className="formSaveMsg">{saveMsg}</div> : null}
          </div>
        </div>
      </div>

      <aside className="request-form-side">
        <div className="requestSideCard">
          <div className="requestSideCardTitle">Request Summary</div>

          <div className="requestSummaryList">
            <div className="requestSummaryItem">
              <div className="requestSummaryLabel">Customer</div>
              <div className="requestSummaryValue">
                {customerName || <span className="requestSummaryMuted">Not provided</span>}
              </div>
            </div>

            <div className="requestSummaryItem">
              <div className="requestSummaryLabel">Part Name</div>
              <div className="requestSummaryValue">
                {customerPartName || <span className="requestSummaryMuted">Not provided</span>}
              </div>
            </div>

            <div className="requestSummaryItem">
              <div className="requestSummaryLabel">Part Number</div>
              <div className="requestSummaryValue">
                {customerPartNumber || <span className="requestSummaryMuted">Not provided</span>}
              </div>
            </div>

            <div className="requestSummaryItem">
              <div className="requestSummaryLabel">Priority</div>
              <div className="requestSummaryValue">
                {selectedPriority || <span className="requestSummaryMuted">Not selected</span>}
              </div>
            </div>

            <div className="requestSummaryItem">
              <div className="requestSummaryLabel">Completion Date</div>
              <div className="requestSummaryValue">
                {requestCompletionDate || (
                  <span className="requestSummaryMuted">Not selected</span>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="requestSideCard">
          <div className="requestSideCardTitle">Validation</div>

          {missingRequired.length > 0 ? (
            <div className="requestMissingList">
              {missingRequired.map((item) => (
                <div key={item.key} className="requestMissingItem">
                  <div className="requestMissingIcon">!</div>
                  <div className="requestMissingText">{item.label} is still required.</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="requestReadyBox">
              All required fields are completed. The request is ready to be reviewed and saved.
            </div>
          )}
        </div>
      </aside>
    </div>
  );
};

/* ===============================
   ✅ Inline Customer Request Starter
   =============================== */
const parseRequestSuggestion = (item) => {
  const rawSessionId = String(item?.sessionId || "");
  const rawTitle = String(item?.title || "");

  const parts = rawSessionId.split("#");
  const requestId = parts[0] || rawSessionId || "Request";
  const partNumber = parts[1] || "";
  const partName = parts.slice(2).join(" ") || rawTitle || "";

  return {
    requestId,
    partNumber,
    partName,
  };
};

const InlineCustomerRequestStarterCard = ({
  suggestions = [],
  onOpenExistingCustomerRequest,
  onStartNewCustomerRequest,
  disableStartNew = false,
}) => {
  const [mode, setMode] = useState("choice");
  const [query, setQuery] = useState("");

  const filteredSuggestions = useMemo(() => {
    const q = String(query || "").toLowerCase().trim();
    const list = Array.isArray(suggestions) ? suggestions : [];

    const clean = list.filter((s) => {
      const title = String(s?.title || "").toLowerCase();
      const sid = String(s?.sessionId || "").toLowerCase();
      return !!sid && !title.includes("monitoring");
    });

    if (!q) return clean.slice(0, 5);

    return clean
      .filter((s) => {
        const title = String(s?.title || "").toLowerCase();
        const sid = String(s?.sessionId || "").toLowerCase();
        return title.includes(q) || sid.includes(q);
      })
      .slice(0, 6);
  }, [query, suggestions]);

  const isExistingOpen = mode === "existing";

  return (
    <div className="customer-request-inline-card">
      <div className="customer-request-inline-eyebrow">
        Customer Request Assistant
      </div>

      <h2 className="customer-request-inline-title">
        I will assist you to create a new customer request.
      </h2>

      <p className="customer-request-inline-subtitle">
        Let me ask a few questions to point you in the right direction. Your
        answers will help me populate the customer request form exactly to your
        needs.
      </p>

      <div className="customer-request-topbar">
        <div className="customer-request-pill info">
          <span className="customer-request-pill-dot" />
          Guided Workflow
        </div>
        <div className="customer-request-pill success">
          <span className="customer-request-pill-dot" />
          Structured Form
        </div>
        <div className="customer-request-pill warning">
          <span className="customer-request-pill-dot" />
          Review Before Save
        </div>
      </div>

      <div className="customer-request-mini-flow">
        <div className="customer-request-mini-step">
          <span className="customer-request-mini-step-number">1</span>
          Provide details
        </div>
        <div className="customer-request-mini-arrow">→</div>
        <div className="customer-request-mini-step">
          <span className="customer-request-mini-step-number">2</span>
          Review form
        </div>
        <div className="customer-request-mini-arrow">→</div>
        <div className="customer-request-mini-step">
          <span className="customer-request-mini-step-number">3</span>
          Save request
        </div>
      </div>

      <div className="customer-request-inline-grid">
        <button
          type="button"
          className="customer-request-option-card customer-request-option-card-primary"
          onClick={onStartNewCustomerRequest}
          disabled={disableStartNew}
        >
          <div className="customer-request-option-top">
            <div className="customer-request-option-icon customer-request-option-icon-primary">
              <PlusCircle size={20} strokeWidth={2.2} />
            </div>

            <div className="customer-request-option-header">
              <div className="customer-request-option-title">
                Create a new customer request
              </div>
            </div>
          </div>

          <div className="customer-request-option-text">
            Start a fresh request and continue step by step inside this chat.
          </div>
        </button>

        <button
          type="button"
          className={`customer-request-option-card ${
            isExistingOpen ? "customer-request-option-card-open" : ""
          }`}
          onClick={() => setMode((prev) => (prev === "existing" ? "choice" : "existing"))}
          aria-expanded={isExistingOpen}
        >
          <div className="customer-request-option-top">
            <div className="customer-request-option-icon">
              <FolderOpen size={20} strokeWidth={2.2} />
            </div>

            <div className="customer-request-option-header customer-request-option-header-space">
              <div className="customer-request-option-title">
                Work on existing request
              </div>
              <div className={`customer-request-chevron ${isExistingOpen ? "open" : ""}`}>
                <ChevronDown size={18} strokeWidth={2.2} />
              </div>
            </div>
          </div>

          <div className="customer-request-option-text">
            Search by request ID, customer part number, or customer part name.
          </div>
        </button>
      </div>

      <div
        className={`customer-request-search-block premium-dropdown ${
          isExistingOpen ? "open" : ""
        }`}
      >
        {isExistingOpen && (
          <>
            <div className="customer-request-search-header">
              <div className="customer-request-search-label">
                Search existing requests
              </div>
              <div className="customer-request-search-subtext">
                Open an existing request and continue in the same request session.
              </div>
            </div>

            <input
              className="customer-request-search-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type request ID, part name, or part number..."
            />

            {!!filteredSuggestions.length && (
              <div className="customer-request-suggestions">
                {filteredSuggestions.map((item) => {
                  const parsed = parseRequestSuggestion(item);

                  return (
                    <button
                      key={item.sessionId}
                      type="button"
                      className="customer-request-suggestion-btn"
                      onClick={() => onOpenExistingCustomerRequest?.(item.sessionId)}
                    >
                      <div className="customer-request-suggestion-top">
                        <div className="customer-request-suggestion-title">
                          {parsed.requestId}
                        </div>
                        <div className="customer-request-suggestion-badge">
                          Existing
                        </div>
                      </div>

                      <div className="customer-request-suggestion-sub single-line">
                        <span className="part-name">
                          {parsed.partName || "Open this request"}
                        </span>

                        {!!parsed.partNumber && (
                          <span className="part-number">• {parsed.partNumber}</span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {!filteredSuggestions.length && (
              <div className="customer-request-empty">
                No matching requests found yet.
              </div>
            )}
          </>
        )}
      </div>

      <div className="customer-request-helper-note">
        Continue an existing request or start a new guided workflow from this assistant.
      </div>
    </div>
  );
};

/* ===============================
   ✅ Customer request flow card
   =============================== */
const CustomerRequestStepCard = ({
  message,
  onSelectOption,
  onSubmitManualInput,
}) => {
  const [manualValue, setManualValue] = useState("");

  useEffect(() => {
    setManualValue("");
  }, [message?.step]);

  if (!message?.flowType || message.flowType !== "customer_request") return null;

  const isManual = !!message?.inputType;

  return (
    <div className="customer-request-step-card">
      <div className="customer-request-step-eyebrow">Customer Request Flow</div>
      <div className="customer-request-step-title">{message.question}</div>

      {isManual ? (
        <div className="customer-request-manual-block">
          <input
            className="customer-request-manual-input"
            value={manualValue}
            onChange={(e) => setManualValue(e.target.value)}
            placeholder="Type here..."
            onKeyDown={(e) => {
              if (e.key === "Enter" && manualValue.trim()) {
                e.preventDefault();
                onSubmitManualInput?.(manualValue.trim());
              }
            }}
          />
          <button
            type="button"
            className="customer-request-manual-submit"
            onClick={() =>
              manualValue.trim() && onSubmitManualInput?.(manualValue.trim())
            }
            disabled={!manualValue.trim()}
          >
            Continue
          </button>
        </div>
      ) : (
        !!message.options?.length && (
          <div className="customer-request-step-options">
            {message.options.map((opt) => (
              <button
                key={opt}
                type="button"
                className="customer-request-step-option-btn"
                onClick={() => onSelectOption?.(opt)}
              >
                {opt}
              </button>
            ))}
          </div>
        )
      )}
    </div>
  );
};

const ChatWindow = ({
  chat,
  updateMessages,
  user,
  onFirstMessage,
  adoptServerSessionId,
  showIdleWarning,
  idleSecondsLeft,
  agentMode,
  formState,
  onFormStateChange,
  onOpenRequestFromStatusTable,
  isCustomerRequestStarterSession,
  customerRequestSuggestions,
  onOpenExistingCustomerRequest,
}) => {
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState([]);
  const [uploading, setUploading] = useState(false);

  const [showDocTypeModal, setShowDocTypeModal] = useState(false);
  const [pendingDocTypeAtt, setPendingDocTypeAtt] = useState(null);

  const [showForm, setShowForm] = useState(false);
  const [formDraft, setFormDraft] = useState(null);
  const [savingForm, setSavingForm] = useState(false);
  const [formSaveMsg, setFormSaveMsg] = useState("");

  const [isStartingCustomerRequest, setIsStartingCustomerRequest] = useState(false);

  const scrollRef = useRef(null);
  const textareaRef = useRef(null);
  const uploadBtnRef = useRef(null);

  const chatIdRef = useRef(chat?.id);

  useLayoutEffect(() => {
    chatIdRef.current = chat?.id;
  }, [chat?.id]);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [chat?.messages, isTyping, showForm]);

  useEffect(() => {
    setFormSaveMsg("");
    setIsStartingCustomerRequest(false);
  }, [chat?.id]);

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

  useEffect(() => {
    if (hasValidFormState(formState)) {
      const hydrated = buildCustomerRequestFormDraft(formState);
      setShowForm(true);
      setFormDraft(hydrated);
      setFormSaveMsg("");
      return;
    }

    setShowForm(false);
    setFormDraft(null);
    setFormSaveMsg("");
  }, [formState, chat?.id]);

  const addMessage = (msg) => {
    const sender = msg.sender || (msg.role === "assistant" ? "bot" : "user");

    const text =
      msg.text ??
      (typeof msg.content === "string"
        ? msg.content
        : Array.isArray(msg.content) && msg.content[0]?.text
        ? msg.content[0].text
        : "");

    const attachmentsRaw = msg.attachments ?? msg.Attachments ?? [];
    const attachments = Array.isArray(attachmentsRaw) ? attachmentsRaw : [];

    updateMessages((prev) => [
      ...prev,
      {
        ...msg,
        sender,
        text,
        role: msg.role || (sender === "bot" ? "assistant" : "user"),
        content: msg.content ?? text,
        attachments,
        artifact: msg.artifact || null,
        flowType: msg.flowType || null,
        step: msg.step || null,
        question: msg.question || null,
        options: Array.isArray(msg.options) ? msg.options : [],
        inputType: msg.inputType || null,
      },
    ]);
  };

  const normalize = (raw = []) =>
    (raw || []).map((m, i) => {
      const sender = m.sender || (m.role === "assistant" ? "bot" : "user");

      const text =
        m.text ??
        (typeof m.content === "string"
          ? m.content
          : Array.isArray(m.content) && m.content[0]?.text
          ? m.content[0].text
          : "");

      const attachmentsRaw = m.attachments ?? m.Attachments ?? [];
      const attachments = Array.isArray(attachmentsRaw) ? attachmentsRaw : [];

      return {
        id: m.id || `msg-${i}`,
        sender,
        text,
        role: m.role || (sender === "bot" ? "assistant" : "user"),
        content: m.content ?? text,
        attachments,
        artifact: m.artifact || null,
        flowType: m.flowType || null,
        step: m.step || null,
        question: m.question || null,
        options: Array.isArray(m.options) ? m.options : [],
        inputType: m.inputType || null,
      };
    });

  const AttachmentRow = ({ att }) => {
    const name = att.fileName || att.name || "file";
    const s3Key = att.s3Key;
    const fileType = att.fileType || att.mimeType || "application/octet-stream";
    const fileSize = att.fileSize ?? att.size ?? 0;

    const onDownload = async () => {
      try {
        const token = await getAccessToken();
        const sessionId = chat?.id || chatIdRef.current || null;

        const data = await downloadFilePresigned(
          {
            userId: user?.email,
            s3Key,
            sessionId,
            fileName: name,
            fileType,
          },
          token
        );

        if (!data?.downloadUrl) throw new Error("No download URL returned");

        const a = document.createElement("a");
        a.href = data.downloadUrl;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
      } catch (e) {
        console.error("Download failed:", e);
        alert(e?.message || "Download failed");
      }
    };

    return (
      <div className="attachment-row">
        <div className="attachment-name" title={name}>
          {name}
        </div>
        <div className="attachment-meta">
          {fileType} • {fileSize} bytes
        </div>
        <button className="attachment-btn" onClick={onDownload} disabled={!s3Key}>
          Download
        </button>
      </div>
    );
  };

  const renderAttachments = (attachments = []) => {
    if (!attachments.length) return null;

    return (
      <div className="attachments-list">
        {attachments.map((att, idx) => (
          <AttachmentRow key={`${att.s3Key || att.fileName}-${idx}`} att={att} />
        ))}
      </div>
    );
  };

  const handleRequestRowClick = (requestKey) => {
    if (!requestKey) return;

    if (typeof onOpenRequestFromStatusTable === "function") {
      onOpenRequestFromStatusTable(requestKey);
    }
  };

  const renderArtifact = (msg) => {
    if (!msg?.artifact) return null;

    return (
      <div className="artifact-card">
        <div className="artifact-title">
          {msg.artifact.artifact_id || "Generated Artifact"}
        </div>
        <div className="artifact-meta">
          {(msg.artifact.content_type || "text") +
            " • " +
            (msg.artifact.visibility || "permanent")}
        </div>

        {typeof msg.artifact.content === "string" && (
          <MarkdownRenderer
            text={msg.artifact.content}
            onRequestRowClick={handleRequestRowClick}
          />
        )}
      </div>
    );
  };

  const tryParseArtifact = (replyTextRaw) => {
    const raw = (replyTextRaw || "").trim();
    if (!raw) return { replyText: "", artifact: null };

    const cleaned = raw
      .replace(/^```(?:json)?/i, "")
      .replace(/```$/i, "")
      .trim();

    try {
      const parsed = JSON.parse(cleaned);
      if (parsed?.type === "artifact_creation" && parsed?.payload) {
        return { replyText: "", artifact: parsed.payload };
      }
    } catch (e) {}

    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      const jsonSlice = cleaned.slice(firstBrace, lastBrace + 1);
      try {
        const parsed2 = JSON.parse(jsonSlice);
        if (parsed2?.type === "artifact_creation" && parsed2?.payload) {
          return { replyText: "", artifact: parsed2.payload };
        }
      } catch (e) {}
    }

    return { replyText: raw, artifact: null };
  };

  const adoptSessionFromResponse = async (res, fallbackSessionId) => {
    const returnedSessionId =
      res?.newSessionId || res?.sessionId || res?.SessionId || "";

    if (returnedSessionId && returnedSessionId !== fallbackSessionId) {
      chatIdRef.current = returnedSessionId;
      await adoptServerSessionId?.(returnedSessionId);
      return returnedSessionId;
    }

    if (returnedSessionId) {
      chatIdRef.current = returnedSessionId;
      return returnedSessionId;
    }

    return fallbackSessionId;
  };

  const handleFileSelect = async (file) => {
    const currentChatId = chat?.id || chatIdRef.current;
    if (!file || !currentChatId || !user) return;

    chatIdRef.current = currentChatId;

    const tempKey = `uploading-${Date.now()}-${file.name}`;

    setPendingAttachments((prev) => [
      ...prev,
      {
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        size: file.size || 0,
        s3Key: tempKey,
        uploading: true,
      },
    ]);

    setUploading(true);

    try {
      const token = await getAccessToken();

      const res = await uploadFilePresigned(
        { sessionId: currentChatId, userId: user.email, file },
        token
      );

      if (res?.sessionId && res.sessionId !== currentChatId) {
        await adoptServerSessionId?.(res.sessionId);
        chatIdRef.current = res.sessionId;
      }

      setPendingAttachments((prev) =>
        prev.map((a) =>
          a.s3Key === tempKey
            ? {
                fileName: file.name,
                mimeType: file.type || "application/octet-stream",
                size: file.size || 0,
                s3Key: res.s3Key,
                uploading: false,
              }
            : a
        )
      );

      setPendingDocTypeAtt({
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        size: file.size || 0,
        s3Key: res.s3Key,
        sessionId: chatIdRef.current,
      });

      setShowDocTypeModal(true);
    } catch (e) {
      console.error("Upload failed:", e);
      setPendingAttachments((prev) => prev.filter((a) => a.s3Key !== tempKey));

      addMessage({
        sender: "bot",
        role: "assistant",
        text: "❌ File upload failed. Please try again.",
      });
    } finally {
      setUploading(false);
    }
  };

  const removeAttachment = (index) => {
    setPendingAttachments((prev) => {
      const item = prev[index];
      if (item?.uploading) return prev;
      return prev.filter((_, i) => i !== index);
    });
  };

  const setAttachmentDocType = (s3Key, docType) => {
    setPendingAttachments((prev) =>
      prev.map((a) => (a.s3Key === s3Key ? { ...a, docType } : a))
    );
  };

  const persistDocTypeToBackend = async (att, docType) => {
    try {
      const token = await getAccessToken();

      await confirmFileUploadAndType(
        {
          sessionId: att.sessionId || chatIdRef.current || chat?.id,
          userId: user?.email,
          s3Key: att.s3Key,
          fileName: att.fileName,
          fileType: att.mimeType || "application/octet-stream",
          fileSize: att.size ?? 0,
          docType: docType || "OTHER",
        },
        token
      );
    } catch (e) {
      console.error("FR1 confirm failed:", e);
      addMessage({
        sender: "bot",
        role: "assistant",
        text:
          "⚠️ File uploaded, but document type could not be saved. Please try again.",
      });
    }
  };

  const handleDocTypeSelect = async (docType) => {
    if (!pendingDocTypeAtt) return;

    setAttachmentDocType(pendingDocTypeAtt.s3Key, docType);
    await persistDocTypeToBackend(pendingDocTypeAtt, docType);

    setShowDocTypeModal(false);
    setPendingDocTypeAtt(null);
  };

  const handleDocTypeSkip = async () => {
    if (!pendingDocTypeAtt) return;

    setAttachmentDocType(pendingDocTypeAtt.s3Key, "OTHER");
    await persistDocTypeToBackend(pendingDocTypeAtt, "OTHER");

    setShowDocTypeModal(false);
    setPendingDocTypeAtt(null);
  };

  const handleSaveForm = async () => {
    if (!formDraft || !user?.email) return;

    setSavingForm(true);
    setFormSaveMsg("");

    try {
      const token = await getAccessToken();

      const workingSessionId = chatIdRef.current || chat?.id || "default-chat";

      const normalizedPayload = {
        CustomerName: formDraft.CustomerName || "",
        CustomerPartName: formDraft.CustomerPartName || "",
        CustomerPartNumber: formDraft.CustomerPartNumber || "",
        RequestDescription: formDraft.RequestDescription || "",
        RequestCompletionDate: formDraft.RequestCompletionDate || "",
        RequestPriority: formDraft.RequestPriority || "Medium",
      };

      if (Array.isArray(formDraft.fields)) {
        for (const f of formDraft.fields) {
          if (f?.key) {
            normalizedPayload[f.key] = f.value ?? "";
          }
        }
      }

      const requestBody = {
        session: {
          SessionId: workingSessionId,
        },
        payload: normalizedPayload,
      };

      const res = await saveGeneratedForm(requestBody, token);
      setFormSaveMsg("✅ Saved to DynamoDB");

      const nextSavedDraft = buildCustomerRequestFormDraft({
        ...formDraft,
        ...normalizedPayload,
      });

      setFormDraft(nextSavedDraft);
      onFormStateChange?.(workingSessionId, nextSavedDraft);

      await adoptSessionFromResponse(res, workingSessionId);
    } catch (e) {
      console.error("Form save failed:", e);
      const msg = e?.message || "Save failed";
      setFormSaveMsg(`❌ ${msg}`);
    } finally {
      setSavingForm(false);
    }
  };

  const pushFlowMessageFromResponse = (res) => {
    addMessage({
      sender: "bot",
      role: "assistant",
      text: res?.reply || "",
      flowType: res?.flowType || null,
      step: res?.step || null,
      question: res?.question || null,
      options: res?.options || [],
      inputType: res?.inputType || null,
    });
  };

  const handleStartNewCustomerRequest = async () => {
    if (isStartingCustomerRequest || isTyping) return;

    try {
      const currentChatId = chat?.id || chatIdRef.current;
      if (!currentChatId || !user?.email) return;

      setIsStartingCustomerRequest(true);
      setIsTyping(true);

      const token = await getAccessToken();

      addMessage({
        sender: "user",
        role: "user",
        text: "Create a new customer request",
      });

      const res = await sendChatMessage(
        currentChatId,
        "__START_NEW_CUSTOMER_REQUEST__",
        user.email,
        token,
        [],
        false
      );

      const workingSessionId = await adoptSessionFromResponse(res, currentChatId);

      if (res?.flowType === "customer_request") {
        pushFlowMessageFromResponse({
          ...res,
          sessionId: workingSessionId,
        });
      } else {
        addMessage({
          sender: "bot",
          role: "assistant",
          text:
            res?.reply ||
            "I will assist you to create a new customer request.",
        });
      }

      setInput("");
      textareaRef.current?.focus();
    } catch (e) {
      console.error("Failed to start customer request flow:", e);
      addMessage({
        sender: "bot",
        role: "assistant",
        text: "❌ Unable to start customer request flow. Please try again.",
      });
    } finally {
      setIsTyping(false);
      setIsStartingCustomerRequest(false);
    }
  };

  const continueFlowWithValue = async (value) => {
    try {
      const currentChatId = chat?.id || chatIdRef.current;
      if (!currentChatId || !user?.email) return;

      setIsTyping(true);

      addMessage({
        sender: "user",
        role: "user",
        text: value,
      });

      const token = await getAccessToken();

      const res = await sendChatMessage(
        currentChatId,
        value,
        user.email,
        token,
        [],
        false
      );

      const workingSessionId = await adoptSessionFromResponse(res, currentChatId);

      if (res?.flowType === "customer_request") {
        pushFlowMessageFromResponse({
          ...res,
          sessionId: workingSessionId,
        });
        return;
      }

      if (res?.formState) {
        const hydrated = buildCustomerRequestFormDraft(res.formState);

        addMessage({
          sender: "bot",
          role: "assistant",
          text: res?.reply || "I have prepared the customer request form.",
        });
        setShowForm(true);
        setFormDraft(hydrated);
        setFormSaveMsg("");
        onFormStateChange?.(workingSessionId, hydrated);
        return;
      }

      let artifact = res?.artifact || null;
      let replyText = res?.reply || "";

      if (!artifact) {
        const parsed = tryParseArtifact(replyText);
        artifact = parsed.artifact || null;
        replyText = parsed.replyText || "";
      }

      addMessage({
        sender: "bot",
        role: "assistant",
        text: replyText || "Done.",
        artifact,
      });
    } catch (e) {
      console.error("Flow continuation failed:", e);
      addMessage({
        sender: "bot",
        role: "assistant",
        text: "❌ Unable to continue the customer request flow. Please try again.",
      });
    } finally {
      setIsTyping(false);
    }
  };

  const handleFlowOptionSelect = async (option) => {
    await continueFlowWithValue(option);
  };

  const handleManualFlowSubmit = async (value) => {
    await continueFlowWithValue(value);
  };

  const handleSend = async () => {
    const typedText = input.trim();

    if (pendingAttachments.some((a) => a.uploading)) return;

    if (!typedText) {
      if (pendingAttachments.length > 0) {
        addMessage({
          sender: "bot",
          role: "assistant",
          text:
            "✅ File uploaded. Please type your question and press Send (I won’t auto-analyze).",
        });
      }
      return;
    }

    const wantsForm = typedText.toLowerCase().includes("generate a form");

    if (chat?.id?.startsWith("temp-") && onFirstMessage && typedText) {
      onFirstMessage(typedText);
    }

    setInput("");
    setIsTyping(true);

    try {
      const token = await getAccessToken();

      addMessage({
        sender: "user",
        role: "user",
        text: typedText,
        attachments: pendingAttachments,
      });

      const currentChatId = chat?.id || chatIdRef.current;
      if (!currentChatId) throw new Error("No active sessionId");
      chatIdRef.current = currentChatId;

      const res = await sendChatMessage(
        currentChatId,
        typedText,
        user.email,
        token,
        pendingAttachments,
        agentMode
      );

      const workingSessionId = await adoptSessionFromResponse(res, currentChatId);

      if (res?.flowType === "customer_request") {
        pushFlowMessageFromResponse(res);
        setPendingAttachments([]);
        return;
      }

      let artifact = res?.artifact || null;
      let replyText = res?.reply || "";

      if (!artifact) {
        const parsed = tryParseArtifact(replyText);
        artifact = parsed.artifact || null;
        replyText = parsed.replyText || "";
      }

      addMessage({
        sender: "bot",
        role: "assistant",
        text: replyText,
        artifact,
      });

      if (res?.formState) {
        const hydrated = buildCustomerRequestFormDraft(res.formState);
        setShowForm(true);
        setFormDraft(hydrated);
        setFormSaveMsg("");
        onFormStateChange?.(workingSessionId, hydrated);
      } else if (wantsForm) {
        const nextDraft = formDraft || defaultFormTemplate();
        setShowForm(true);
        setFormDraft(nextDraft);
        setFormSaveMsg("");
        onFormStateChange?.(workingSessionId, nextDraft);
      }

      setPendingAttachments([]);
    } catch (err) {
      console.error("Chat error:", err);

      const msg = String(err?.message || err || "");
      let friendly = "❌ Something went wrong. Please try again.";

      if (msg.includes("AGENT_TIMEOUT")) {
        friendly =
          "⏳ Agent is taking longer than expected (90s). Please try again or switch Agent Mode OFF for faster chat.";
      } else if (msg.includes("REQUEST_TIMEOUT")) {
        friendly = "⏳ Backend didn’t respond within 30 seconds. Please try again.";
      } else if (msg.includes("AgentCore disabled in this environment")) {
        friendly =
          "⚠️ Agent Mode is not enabled in this environment. Please switch Agent Mode OFF or enable AgentCore in Lambda env (ENABLE_AGENTCORE=true).";
      } else if (msg.includes("Unauthorized") || msg.includes("401")) {
        friendly = "🔒 Your session expired. Please logout and login again.";
      } else if (msg.includes("403")) {
        friendly =
          "🚫 Access denied (403). Please check session adoption / API authorization / Lambda ownership check.";
      }

      addMessage({
        sender: "bot",
        role: "assistant",
        text: friendly,
      });
    } finally {
      setIsTyping(false);
    }
  };

  const hasUploading = pendingAttachments.some((a) => a.uploading);

  const starterCleanMessages = useMemo(() => {
    const raw = chat?.messages || [];

    if (!isCustomerRequestStarterSession) {
      return raw;
    }

    return raw.filter((m) => {
      const text =
        m?.text ??
        (typeof m?.content === "string"
          ? m.content
          : Array.isArray(m?.content) && m.content[0]?.text
          ? m.content[0].text
          : "");

      const cleanText = String(text || "").trim().toLowerCase();

      if (m?.flowType === "customer_request") return false;
      if (cleanText === "create a new customer request") return false;
      if (cleanText === "select customer name") return false;
      if (cleanText === "select customer part name") return false;
      if (cleanText === "select customer part number") return false;
      if (cleanText === "enter customer name") return false;
      if (cleanText === "enter customer part name") return false;
      if (cleanText === "enter customer part number") return false;

      return true;
    });
  }, [chat?.messages, isCustomerRequestStarterSession]);

  const normalizedMessages = normalize(starterCleanMessages);

  const shouldShowWelcome =
    !isCustomerRequestStarterSession &&
    (!starterCleanMessages || starterCleanMessages.length === 0);

  const showInlineCustomerStarter =
    isCustomerRequestStarterSession && !showForm;

  return (
    <main className="chat-main chat-layout">
      {showDocTypeModal && pendingDocTypeAtt && (
        <DocTypePopover
          anchorRef={uploadBtnRef}
          fileName={pendingDocTypeAtt.fileName}
          onSelect={handleDocTypeSelect}
          onSkip={handleDocTypeSkip}
        />
      )}

      {showIdleWarning && (
        <div className="idle-warning-banner">
          ⚠️ You’ll be logged out in <strong>{idleSecondsLeft}</strong> seconds
        </div>
      )}

      <div
        className={`messages ${
          !starterCleanMessages || starterCleanMessages.length === 0
            ? "messages-empty"
            : ""
        }`}
        ref={scrollRef}
      >
        {shouldShowWelcome ? (
          <div className="welcome-screen">
            <h1 className="welcome-title">What are you working on?</h1>
          </div>
        ) : (
          <>
            {showInlineCustomerStarter && (
              <div className="msg-row bot">
                <div className="msg-bubble msg-bubble-inline-card">
                  <InlineCustomerRequestStarterCard
                    suggestions={customerRequestSuggestions}
                    onOpenExistingCustomerRequest={onOpenExistingCustomerRequest}
                    onStartNewCustomerRequest={handleStartNewCustomerRequest}
                    disableStartNew={isStartingCustomerRequest || isTyping}
                  />
                </div>
              </div>
            )}

            {normalizedMessages.map((m, index) => (
              <div key={m.id || index} className={`msg-row ${m.sender}`}>
                <div className="msg-bubble">
                  {m.flowType === "customer_request" ? (
                    <CustomerRequestStepCard
                      message={m}
                      onSelectOption={handleFlowOptionSelect}
                      onSubmitManualInput={handleManualFlowSubmit}
                    />
                  ) : (
                    <MarkdownRenderer
                      text={m.text || ""}
                      onRequestRowClick={handleRequestRowClick}
                    />
                  )}
                  {renderArtifact(m)}
                  {renderAttachments(m.attachments)}
                </div>
              </div>
            ))}
          </>
        )}

        {isTyping && (
          <div className="msg-row bot">
            <div className="msg-bubble typing">
              <span className="dot" />
              <span className="dot" />
              <span className="dot" />
            </div>
          </div>
        )}

        {showForm && formDraft && (
          <div className="msg-row bot">
            <div className="msg-bubble">
              <FormEditorCard
                formDraft={formDraft}
                setFormDraft={(updater) => {
                  setFormDraft((prev) => {
                    const next =
                      typeof updater === "function" ? updater(prev) : updater;
                    const sessionId = chatIdRef.current || chat?.id;
                    if (sessionId) {
                      onFormStateChange?.(sessionId, next);
                    }
                    return next;
                  });
                }}
                onSave={handleSaveForm}
                saving={savingForm}
                saveMsg={formSaveMsg}
              />
            </div>
          </div>
        )}
      </div>

      <div className="chat-input-bar">
        <div className="chat-input-wrapper">
          {pendingAttachments.length > 0 && (
            <div className="cw-attach-tray">
              {pendingAttachments.map((a, i) => (
                <div
                  key={a.s3Key || `${a.fileName}-${i}`}
                  className="cw-attach-pill"
                >
                  <span className="cw-attach-icon">
                    {a.uploading ? <span className="cw-spinner" /> : "📄"}
                  </span>

                  <div className="cw-attach-info">
                    <div className="cw-attach-name" title={a.fileName}>
                      {a.fileName}
                    </div>
                    <div className="cw-attach-meta">
                      {a.uploading
                        ? "Uploading…"
                        : `${Math.round((a.size || 0) / 1024)} KB`}
                    </div>
                  </div>

                  <button
                    type="button"
                    className="cw-attach-remove"
                    onClick={() => removeAttachment(i)}
                    aria-label="Remove attachment"
                    disabled={a.uploading}
                    title={a.uploading ? "Uploading..." : "Remove"}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="cw-input-row">
            <div ref={uploadBtnRef} style={{ display: "inline-flex" }}>
              <label className="cw-icon cw-upload" title="Upload a file">
                <UploadIcon />
                <input
                  type="file"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileSelect(file);
                    e.target.value = "";
                  }}
                />
              </label>
            </div>

            <textarea
              ref={textareaRef}
              className="chat-textarea"
              placeholder={hasUploading ? "Uploading file…" : "Ask anything..."}
              value={input}
              rows={1}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
            />

            <button
              className="cw-send"
              onClick={handleSend}
              disabled={uploading || hasUploading}
              title={hasUploading ? "Wait for upload to finish" : "Send"}
            >
              <SendIcon />
            </button>
          </div>
        </div>
      </div>
    </main>
  );
};

export default ChatWindow;