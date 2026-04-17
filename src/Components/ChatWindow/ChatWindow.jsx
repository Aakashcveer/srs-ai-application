import React, {
  useEffect,
  useRef,
  useState,
  useLayoutEffect,
  useMemo,
  useCallback,
} from "react";
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
  searchCustomerRequests,
  sendCustomerEmail,
} from "../../api/api-config";
import { getAccessToken } from "../../AWS/auth";

/* ===============================
   ✅ Common message helpers
   =============================== */
const extractMessageText = (m = {}) => {
  return (
    m?.text ??
    (typeof m?.content === "string"
      ? m.content
      : Array.isArray(m?.content) && m.content[0]?.text
      ? m.content[0].text
      : "")
  );
};

const extractMessageSender = (m = {}) => {
  return m?.sender || (m?.role === "assistant" ? "bot" : "user");
};

const isPreparedFormMessage = (text = "") => {
  const value = String(text || "").trim().toLowerCase();
  return (
    value.includes("i have prepared the customer request form") ||
    value.includes("please review and save")
  );
};

const isReviewPromptMessage = (text = "") => {
  const value = String(text || "").trim().toLowerCase();
  return (
    value.includes("customer request submitted for review successfully") ||
    value.includes("would you like me to generate a professional customer email draft")
  );
};

const isSystemFlowMarkerText = (text = "") => {
  const value = String(text || "").trim().toUpperCase().replace(/\s+/g, " ");
  return (
    value === "FORM_SUBMITTED" ||
    value === "SUBMITTED_FOR_REVIEW" ||
    value === "FORM_SUBMITTED SUBMITTED_FOR_REVIEW" ||
    (value.includes("FORM_SUBMITTED") && value.includes("SUBMITTED_FOR_REVIEW"))
  );
};

const getPersistedFormInsertIndex = (messages = []) => {
  if (!Array.isArray(messages) || messages.length === 0) return 0;

  let lastPreparedFormIndex = -1;

  for (let i = 0; i < messages.length; i += 1) {
    const text = extractMessageText(messages[i]);
    if (isPreparedFormMessage(text)) {
      lastPreparedFormIndex = i;
    }
  }

  if (lastPreparedFormIndex >= 0) {
    return lastPreparedFormIndex + 1;
  }

  const firstReviewPromptIndex = messages.findIndex((m) =>
    isReviewPromptMessage(extractMessageText(m))
  );
  if (firstReviewPromptIndex >= 0) {
    return firstReviewPromptIndex;
  }

  const firstEmailIndex = messages.findIndex((m) => {
    const sender = extractMessageSender(m);
    const text = extractMessageText(m);
    return !!m?.emailDraft || (sender === "bot" && looksLikeEmailDraft(text));
  });
  if (firstEmailIndex >= 0) {
    return firstEmailIndex;
  }

  return messages.length;
};

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
   ✅ Email Draft Helpers + Card
   =============================== */
const looksLikeEmailDraft = (text = "") => {
  const value = String(text || "").trim();
  if (!value) return false;
  if (!/^subject\s*:/i.test(value) && !/\nsubject\s*:/i.test(value)) return false;
  return (
    /dear\s+/i.test(value) || /best regards/i.test(value) || /regards,/i.test(value)
  );
};

const parseEmailDraftFromText = (text = "", fallbackTo = "") => {
  const raw = String(text || "").replace(/\r\n/g, "\n").trim();
  const lines = raw.split("\n");

  let subject = "";
  let bodyLines = [];
  let foundSubject = false;

  for (const line of lines) {
    if (!foundSubject && /^subject\s*:/i.test(line)) {
      subject = line.replace(/^subject\s*:/i, "").trim();
      foundSubject = true;
      continue;
    }
    bodyLines.push(line);
  }

  const body = bodyLines.join("\n").trim();

  return {
    to: fallbackTo || "",
    subject: subject || "Customer Request Update",
    body: body || raw,
  };
};

const EmailDraftCard = ({ draft, onSaveDraft, onSendEmail }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [localDraft, setLocalDraft] = useState(
    draft || { to: "", subject: "", body: "" }
  );
  const [statusMsg, setStatusMsg] = useState("");

  useEffect(() => {
    setLocalDraft(draft || { to: "", subject: "", body: "" });
    setStatusMsg("");
    setIsEditing(false);
  }, [draft]);

  if (!draft) return null;

  const updateField = (key, value) => {
    setLocalDraft((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = () => {
    onSaveDraft?.(localDraft);
    setStatusMsg("Draft saved locally.");
    setIsEditing(false);
  };

  const handleSend = () => {
    onSendEmail?.(localDraft);
    setStatusMsg("Send action triggered.");
  };

  return (
    <div className="emailDraftShell">
      <div className="emailDraftHeader">
        <div>
          <div className="emailDraftEyebrow">Customer Email Draft</div>
          <div className="emailDraftTitle">Review before sending</div>
        </div>

        <div className="emailDraftActionsTop">
          <button
            type="button"
            className="premiumGhostBtn"
            onClick={() => setIsEditing((prev) => !prev)}
          >
            {isEditing ? "Preview" : "Edit"}
          </button>
        </div>
      </div>

      <div className="emailDraftMeta">
        <div className="emailDraftMetaRow">
          <div className="emailDraftMetaLabel">To</div>
          {isEditing ? (
            <input
              className="emailDraftInput"
              value={localDraft.to}
              onChange={(e) => updateField("to", e.target.value)}
              placeholder="customer@example.com"
            />
          ) : (
            <div className="emailDraftMetaValue">
              {localDraft.to || (
                <span className="requestSummaryMuted">Not provided</span>
              )}
            </div>
          )}
        </div>

        <div className="emailDraftMetaRow">
          <div className="emailDraftMetaLabel">Subject</div>
          {isEditing ? (
            <input
              className="emailDraftInput"
              value={localDraft.subject}
              onChange={(e) => updateField("subject", e.target.value)}
              placeholder="Enter subject"
            />
          ) : (
            <div className="emailDraftMetaValue strong">
              {localDraft.subject || (
                <span className="requestSummaryMuted">No subject</span>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="emailDraftBodyCard">
        {isEditing ? (
          <textarea
            className="emailDraftTextarea"
            value={localDraft.body}
            onChange={(e) => updateField("body", e.target.value)}
            rows={14}
            placeholder="Write email body..."
          />
        ) : (
          <div className="emailDraftPreview markdown-body">
            <MarkdownRenderer text={localDraft.body || ""} />
          </div>
        )}
      </div>

      <div className="emailDraftFooter">
        <div className="emailDraftFooterHint">
          {isEditing
            ? "Edit the draft and save your changes before sending."
            : "Preview the customer-facing email draft."}
        </div>

        <div className="emailDraftFooterActions">
          <button
            type="button"
            className="premiumGhostBtn"
            onClick={handleSave}
          >
            Save Draft
          </button>

          <button
            type="button"
            className="formSaveBtn premiumFormSaveBtn"
            onClick={handleSend}
          >
            Send Email
          </button>
        </div>
      </div>

      {statusMsg ? <div className="formSaveMsg">{statusMsg}</div> : null}
    </div>
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
      makeField(
        "CustomerPartName",
        "Customer Part Name",
        "text",
        customerPartName,
        true
      ),
      makeField(
        "CustomerPartNumber",
        "Customer Part Number",
        "text",
        customerPartNumber,
        true
      ),
      makeField(
        "RequestDescription",
        "Request Description",
        "textarea",
        requestDescription,
        true
      ),
      makeField(
        "RequestCompletionDate",
        "Request Completion Date",
        "date",
        requestCompletionDate,
        true
      ),
      makeField(
        "RequestPriority",
        "Request Priority",
        "text",
        requestPriority,
        true
      ),
    ],
  };
};

const FormEditorCard = ({
  formDraft,
  setFormDraft,
  onSave,
  onSubmitForReview,
  saving,
  submittingForReview,
  saveMsg,
}) => {
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
          <button
            className="formSaveBtn"
            onClick={onSave}
            disabled={saving || isSubmitted}
          >
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
  const requestCompletionDate = String(
    getValueByKey("RequestCompletionDate") || ""
  ).trim();
  const selectedPriority = String(getFieldValue(priorityField) || "Medium");

  const requiredChecks = [
    { key: "CustomerName", label: "Customer Name", value: customerName },
    { key: "CustomerPartName", label: "Customer Part Name", value: customerPartName },
    {
      key: "CustomerPartNumber",
      label: "Customer Part Number",
      value: customerPartNumber,
    },
    {
      key: "RequestDescription",
      label: "Request Description",
      value: requestDescription,
    },
    {
      key: "RequestCompletionDate",
      label: "Request Completion Date",
      value: requestCompletionDate,
    },
    { key: "RequestPriority", label: "Request Priority", value: selectedPriority },
  ];

  const missingRequired = requiredChecks.filter(
    (item) => !String(item.value || "").trim()
  );
  const completedCount = requiredChecks.length - missingRequired.length;
  const progressPercent = Math.round(
    (completedCount / requiredChecks.length) * 100
  );

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
      f.required &&
      !String(value || "").trim() &&
      missingRequired.some((m) => m.key === f.key);

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
            className={`premiumFormInput premiumFormTextarea ${
              isInvalid ? "is-invalid" : ""
            }`}
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
                <div
                  className={`premiumMetaBadge ${formReady ? "ready" : "pending"}`}
                >
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

          <div
            className={`premiumFormSection ${
              customerSectionComplete ? "is-complete" : ""
            }`}
          >
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

          <div
            className={`premiumFormSection ${
              requestSectionComplete ? "is-complete" : ""
            }`}
          >
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
                {priorityField.required ? (
                  <span className="premiumFormReq">*</span>
                ) : null}
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
                type="button"
                className="premiumGhostBtn"
                onClick={onSave}
                disabled={saving || submittingForReview || isSubmitted}
              >
                {saving ? "Saving..." : "Save Draft"}
              </button>

              <button
                className={`formSaveBtn premiumFormSaveBtn ${
                  isSubmitted ? "submitted" : ""
                }`}
                onClick={onSubmitForReview}
                disabled={saving || submittingForReview || isSubmitted || !formReady}
              >
                {isSubmitted
                  ? "Submitted"
                  : submittingForReview
                  ? "Submitting..."
                  : "Submit for Review"}
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
                {customerName || (
                  <span className="requestSummaryMuted">Not provided</span>
                )}
              </div>
            </div>

            <div className="requestSummaryItem">
              <div className="requestSummaryLabel">Part Name</div>
              <div className="requestSummaryValue">
                {customerPartName || (
                  <span className="requestSummaryMuted">Not provided</span>
                )}
              </div>
            </div>

            <div className="requestSummaryItem">
              <div className="requestSummaryLabel">Part Number</div>
              <div className="requestSummaryValue">
                {customerPartNumber || (
                  <span className="requestSummaryMuted">Not provided</span>
                )}
              </div>
            </div>

            <div className="requestSummaryItem">
              <div className="requestSummaryLabel">Priority</div>
              <div className="requestSummaryValue">
                {selectedPriority || (
                  <span className="requestSummaryMuted">Not selected</span>
                )}
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
                  <div className="requestMissingText">
                    {item.label} is still required.
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="requestReadyBox">
              All required fields are completed. The request is ready to be
              reviewed and saved.
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
  const rawSessionId = String(
    item?.requestId || item?.sessionId || item?.SessionId || ""
  );
  const rawTitle = String(
    item?.title || item?.customerPartName || item?.partName || ""
  );

  const explicitPartNumber = String(
    item?.customerPartNumber || item?.partNumber || item?.CustomerPartNumber || ""
  ).trim();

  const explicitPartName = String(
    item?.customerPartName ||
      item?.partName ||
      item?.CustomerPartName ||
      (rawTitle.toLowerCase().includes("my assistant") ? "" : rawTitle) ||
      ""
  ).trim();

  const parts = rawSessionId.split("#");
  const requestId = parts[0] || rawSessionId || "Request";
  const partNumber = explicitPartNumber || parts[1] || "";
  const partName = explicitPartName || parts.slice(2).join(" ") || rawTitle || "";

  return {
    requestId,
    partNumber,
    partName,
  };
};

const normalizeSuggestionStatus = (rawStatus = "") => {
  const raw = String(rawStatus || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_")
    .replace(/-/g, "_");

  if (!raw) return "UNKNOWN";

  if (
    raw === "SUBMITTED_FOR_REVIEW" ||
    raw === "REQUEST_REVIEW" ||
    raw === "REQUEST_REVIEWED" ||
    raw === "REQUEST_REVIEW_PENDING"
  ) {
    return "SUBMITTED_FOR_REVIEW";
  }

  if (
    raw === "IN_PROGRESS" ||
    raw === "REQUEST_IN_PROGRESS" ||
    raw === "REQUEST_PROGRESS"
  ) {
    return "IN_PROGRESS";
  }

  if (raw === "ON_HOLD" || raw === "REQUEST_ON_HOLD" || raw === "HOLD") {
    return "ON_HOLD";
  }

  if (raw === "COMPLETED" || raw === "REQUEST_COMPLETED" || raw === "DONE") {
    return "COMPLETED";
  }

  if (
    raw === "PENDING" ||
    raw === "REQUEST_PENDING" ||
    raw === "REQUEST_CREATE" ||
    raw === "REQUEST_CREATED"
  ) {
    return "PENDING";
  }

  return raw;
};

const getSuggestionStatusValue = (item) => {
  const raw = String(
    item?.requestStatus ||
      item?.status ||
      item?.RequestStatus ||
      item?.Status ||
      ""
  );
  return normalizeSuggestionStatus(raw);
};

const getSuggestionStatusLabel = (item) => {
  const value = getSuggestionStatusValue(item);
  return value.replace(/_/g, "-");
};

const getSuggestionDateValue = (item) => {
  return (
    item?.stateEnteredAt ||
    item?.statusUpdatedAt ||
    item?.updatedAt ||
    item?.lastUpdatedAt ||
    item?.requestUpdatedAt ||
    item?.RequestUpdatedDateTime ||
    item?.RequestLoggedDateTime ||
    item?.createdAt ||
    item?.requestCreatedAt ||
    item?.RequestCreatedAt ||
    item?.createdDate ||
    item?.CreatedAt ||
    ""
  );
};

const getSuggestionAgeLabel = (item) => {
  const directAge =
    item?.ageDays ??
    item?.daysInState ??
    item?.AgeDays ??
    item?.DaysInState;

  if (directAge !== undefined && directAge !== null && directAge !== "") {
    const num = Number(directAge);
    if (!Number.isNaN(num) && num >= 0) {
      return `Age: ${num} day${num === 1 ? "" : "s"}`;
    }
  }

  const rawDate = getSuggestionDateValue(item);
  if (!rawDate) return "Age: --";

  const parsed = new Date(rawDate);
  if (Number.isNaN(parsed.getTime())) return "Age: --";

  const now = new Date();
  const diffMs = now.getTime() - parsed.getTime();
  const diffDays = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));

  return `Age: ${diffDays} day${diffDays === 1 ? "" : "s"}`;
};

const InlineCustomerRequestStarterCard = ({
  suggestions = [],
  onOpenExistingCustomerRequest,
  onStartNewCustomerRequest,
  disableStartNew = false,
  onSearchExistingCustomerRequests,
  existingRequestsLoading = false,
}) => {
  const [mode, setMode] = useState("choice");
  const [query, setQuery] = useState("");
  const [existingStatusFilter, setExistingStatusFilter] = useState("ALL");

  useEffect(() => {
    if (mode !== "existing") return;

    const t = setTimeout(() => {
      onSearchExistingCustomerRequests?.(query, existingStatusFilter);
    }, 350);

    return () => clearTimeout(t);
  }, [mode, query, existingStatusFilter, onSearchExistingCustomerRequests]);

  const filteredSuggestions = useMemo(() => {
    const q = String(query || "").toLowerCase().trim();
    const list = Array.isArray(suggestions) ? suggestions : [];

    const clean = list.filter((s) => {
      const title = String(
        s?.title || s?.customerPartName || s?.partName || ""
      ).toLowerCase();
      const sid = String(s?.sessionId || s?.requestId || "").toLowerCase();
      if (!sid || title.includes("monitoring")) return false;

      const statusValue = getSuggestionStatusValue(s);
      if (existingStatusFilter !== "ALL" && statusValue !== existingStatusFilter) {
        return false;
      }

      return true;
    });

    if (!q) return clean.slice(0, 8);

    return clean
      .filter((s) => {
        const parsed = parseRequestSuggestion(s);
        const statusLabel = getSuggestionStatusLabel(s).toLowerCase();

        return (
          String(parsed.requestId || "").toLowerCase().includes(q) ||
          String(parsed.partName || "").toLowerCase().includes(q) ||
          String(parsed.partNumber || "").toLowerCase().includes(q) ||
          statusLabel.includes(q)
        );
      })
      .slice(0, 10);
  }, [query, suggestions, existingStatusFilter]);

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
          onClick={() =>
            setMode((prev) => (prev === "existing" ? "choice" : "existing"))
          }
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
              <div
                className={`customer-request-chevron ${
                  isExistingOpen ? "open" : ""
                }`}
              >
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
            <div
              className="customer-request-search-header"
              style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: "12px",
                flexWrap: "wrap",
              }}
            >
              <div>
                <div className="customer-request-search-label">
                  Search existing requests
                </div>
              </div>

              <div
                className="customer-request-status-filter"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  marginLeft: "auto",
                }}
              >
                <label
                  htmlFor="existing-request-status-filter"
                  style={{
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "#6b7a90",
                    whiteSpace: "nowrap",
                  }}
                >
                  Status
                </label>
                <select
                  id="existing-request-status-filter"
                  value={existingStatusFilter}
                  onChange={(e) => setExistingStatusFilter(e.target.value)}
                  style={{
                    minWidth: "170px",
                    height: "36px",
                    borderRadius: "10px",
                    border: "1px solid #dbe3f0",
                    padding: "0 12px",
                    background: "#fff",
                    color: "#24324a",
                    fontSize: "13px",
                    fontWeight: 500,
                    outline: "none",
                  }}
                >
                  <option value="ALL">All</option>
                  <option value="IN_PROGRESS">IN-PROGRESS</option>
                  <option value="PENDING">PENDING</option>
                  <option value="ON_HOLD">ON-HOLD</option>
                  <option value="COMPLETED">COMPLETED</option>
                  <option value="SUBMITTED_FOR_REVIEW">SUBMITTED-FOR-REVIEW</option>
                </select>
              </div>
            </div>

            <input
              className="customer-request-search-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type request ID, part name, or part number..."
            />

            {!!filteredSuggestions.length ? (
              <>
                <div className="customer-request-suggestions">
                  {filteredSuggestions.map((item) => {
                    const parsed = parseRequestSuggestion(item);
                    const statusLabel = getSuggestionStatusLabel(item);
                    const ageLabel = getSuggestionAgeLabel(item);
                    const openId =
                      item.sessionId ||
                      item.requestId ||
                      item.SessionId ||
                      parsed.requestId;

                    return (
                      <button
                        key={openId}
                        type="button"
                        className="customer-request-suggestion-btn"
                        onClick={() => onOpenExistingCustomerRequest?.(openId)}
                      >
                        <div
                          className="customer-request-suggestion-top"
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "flex-start",
                            gap: "12px",
                          }}
                        >
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div className="customer-request-suggestion-title">
                              {parsed.requestId}
                            </div>

                            <div className="customer-request-suggestion-sub single-line">
                              <span className="part-name">
                                {parsed.partName || "Open this request"}
                              </span>

                              {!!parsed.partNumber && (
                                <span className="part-number"> • {parsed.partNumber}</span>
                              )}
                            </div>
                          </div>

                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              alignItems: "flex-end",
                              gap: "4px",
                              flexShrink: 0,
                              textAlign: "right",
                            }}
                          >
                            <div className="customer-request-suggestion-status">
                              {statusLabel}
                            </div>
                            <div className="customer-request-suggestion-age">
                              {ageLabel}
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {existingRequestsLoading ? (
                  <div className="customer-request-search-subtext">Refreshing...</div>
                ) : null}
              </>
            ) : existingRequestsLoading ? (
              <div className="customer-request-empty">Loading requests...</div>
            ) : (
              <div className="customer-request-empty">
                No matching requests found yet.
              </div>
            )}
          </>
        )}
      </div>

      <div className="customer-request-helper-note">
        Continue an existing request or start a new guided workflow from this
        assistant.
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
  const [submittingForReview, setSubmittingForReview] = useState(false);
  const [formSaveMsg, setFormSaveMsg] = useState("");
  const [formInsertIndex, setFormInsertIndex] = useState(null);

  const [isStartingCustomerRequest, setIsStartingCustomerRequest] = useState(false);

  const [liveCustomerRequestSuggestions, setLiveCustomerRequestSuggestions] = useState(
    Array.isArray(customerRequestSuggestions) ? customerRequestSuggestions : []
  );
  const [existingRequestsLoading, setExistingRequestsLoading] = useState(false);

  const scrollRef = useRef(null);
  const textareaRef = useRef(null);
  const uploadBtnRef = useRef(null);

  const chatIdRef = useRef(chat?.id);
  const visibleMessageCountRef = useRef(0);
  const customerRequestSearchSeqRef = useRef(0);

  useLayoutEffect(() => {
    chatIdRef.current = chat?.id;
  }, [chat?.id]);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [chat?.messages, isTyping, showForm, formInsertIndex]);

  useEffect(() => {
    setFormSaveMsg("");
    setIsStartingCustomerRequest(false);
    setFormInsertIndex(null);
  }, [chat?.id]);

  useEffect(() => {
    setLiveCustomerRequestSuggestions(
      Array.isArray(customerRequestSuggestions) ? customerRequestSuggestions : []
    );
  }, [customerRequestSuggestions]);

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

    const emailDraft =
      msg.emailDraft ||
      (sender === "bot" && looksLikeEmailDraft(text)
        ? parseEmailDraftFromText(text, user?.email || "")
        : null);

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
        emailDraft,
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

      const emailDraft =
        m.emailDraft ||
        (sender === "bot" && looksLikeEmailDraft(text)
          ? parseEmailDraftFromText(text, user?.email || "")
          : null);

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
        emailDraft,
      };
    });

  const cleanedMessages = useMemo(() => {
    const raw = chat?.messages || [];

    const flowQuestions = new Set(
      raw
        .filter((m) => m?.flowType === "customer_request")
        .map((m) => String(m?.question || "").trim().toLowerCase())
        .filter(Boolean)
    );

    return raw.filter((m, idx) => {
      const sender = extractMessageSender(m);
      const text = String(extractMessageText(m) || "").trim().toLowerCase();

      if (isSystemFlowMarkerText(text)) return false;

      if (isCustomerRequestStarterSession) {
        if (m?.flowType === "customer_request") return false;
        if (text === "create a new customer request") return false;
        if (text === "select customer name") return false;
        if (text === "select customer part name") return false;
        if (text === "select customer part number") return false;
        if (text === "select customer part name and number") return false;
        if (text === "enter customer name") return false;
        if (text === "enter customer part name") return false;
        if (text === "enter customer part number") return false;
      }

      const hasAttachments =
        Array.isArray(m?.attachments) && m.attachments.length > 0;
      const hasArtifact = !!m?.artifact;
      const isFlowCard = m?.flowType === "customer_request";
      const isEmail =
        !!m?.emailDraft || (sender === "bot" && looksLikeEmailDraft(text));

      const next = raw[idx + 1];
      const prev = raw[idx - 1];
      const nextQuestion = String(next?.question || "").trim().toLowerCase();
      const prevQuestion = String(prev?.question || "").trim().toLowerCase();

      const isPlainAssistantFlowPrompt =
        sender === "bot" &&
        !hasAttachments &&
        !hasArtifact &&
        !isFlowCard &&
        !isEmail &&
        !!text &&
        (flowQuestions.has(text) ||
          text === nextQuestion ||
          text === prevQuestion);

      if (isPlainAssistantFlowPrompt) return false;

      return true;
    });
  }, [chat?.messages, isCustomerRequestStarterSession]);

  const normalizedMessages = useMemo(
    () => normalize(cleanedMessages),
    [cleanedMessages, user?.email]
  );

  useEffect(() => {
    visibleMessageCountRef.current = normalizedMessages.length;
  }, [normalizedMessages.length]);

  const openFormInline = (nextDraft, options = {}) => {
    const { afterNextMessage = false } = options;

    setShowForm(true);
    setFormDraft(nextDraft);
    setFormSaveMsg("");

    setFormInsertIndex((prev) => {
      if (prev !== null) return prev;
      return visibleMessageCountRef.current + (afterNextMessage ? 1 : 0);
    });
  };

  useEffect(() => {
    if (hasValidFormState(formState)) {
      const hydrated = buildCustomerRequestFormDraft(formState);
      setShowForm(true);
      setFormDraft(hydrated);
      setFormSaveMsg("");

      setFormInsertIndex((prev) => {
        if (prev !== null) return prev;
        return getPersistedFormInsertIndex(normalizedMessages);
      });

      return;
    }

    setShowForm(false);
    setFormDraft(null);
    setFormSaveMsg("");
    setFormInsertIndex(null);
  }, [formState, chat?.id, normalizedMessages]);

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

  const handleSearchExistingCustomerRequests = useCallback(
    async (query = "", statusFilter = "ALL") => {
      if (!user?.email) return;

      const seq = Date.now() + Math.random();
      customerRequestSearchSeqRef.current = seq;
      setExistingRequestsLoading(true);

      try {
        const token = await getAccessToken();

        const res = await searchCustomerRequests(token, query, "ALL");

        if (customerRequestSearchSeqRef.current !== seq) return;

        const items = Array.isArray(res?.items) ? res.items : [];
        setLiveCustomerRequestSuggestions(items);
      } catch (e) {
        console.error("Customer request search failed:", e);
        if (customerRequestSearchSeqRef.current !== seq) return;
        setLiveCustomerRequestSuggestions([]);
      } finally {
        if (customerRequestSearchSeqRef.current === seq) {
          setExistingRequestsLoading(false);
        }
      }
    },
    [user?.email]
  );

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

  const buildNormalizedFormPayload = () => {
    const baseDraft = formDraft || {};

    const normalizedPayload = {
      CustomerName: baseDraft.CustomerName || "",
      CustomerPartName: baseDraft.CustomerPartName || "",
      CustomerPartNumber: baseDraft.CustomerPartNumber || "",
      RequestDescription: baseDraft.RequestDescription || "",
      RequestCompletionDate: baseDraft.RequestCompletionDate || "",
      RequestPriority: baseDraft.RequestPriority || "Medium",
    };

    if (Array.isArray(baseDraft.fields)) {
      for (const f of baseDraft.fields) {
        if (f?.key) {
          normalizedPayload[f.key] = f.value ?? "";
        }
      }
    }

    return normalizedPayload;
  };

  const handleSaveForm = async () => {
    if (!formDraft || !user?.email) return;

    setSavingForm(true);
    setFormSaveMsg("");

    try {
      const token = await getAccessToken();

      const workingSessionId = chatIdRef.current || chat?.id || "default-chat";
      const normalizedPayload = buildNormalizedFormPayload();

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

  const handleSubmitForReview = async () => {
    if (!formDraft || !user?.email) return;

    setSubmittingForReview(true);
    setFormSaveMsg("");

    try {
      const token = await getAccessToken();
      const workingSessionId = chatIdRef.current || chat?.id || "default-chat";
      const normalizedPayload = buildNormalizedFormPayload();

      const requestBody = {
        session: {
          SessionId: workingSessionId,
        },
        payload: {
          ...normalizedPayload,
          submitForReview: true,
        },
      };

      const res = await saveGeneratedForm(requestBody, token);

      setFormSaveMsg("✅ Submitted for review");

      const nextSavedDraft = buildCustomerRequestFormDraft({
        ...formDraft,
        ...normalizedPayload,
      });

      setFormDraft(nextSavedDraft);
      onFormStateChange?.(workingSessionId, nextSavedDraft);

      const adoptedSessionId = await adoptSessionFromResponse(
        res,
        workingSessionId
      );

      if (res?.reviewChatReply) {
        addMessage({
          sender: "bot",
          role: "assistant",
          text: res.reviewChatReply,
        });
      }

      if (adoptedSessionId) {
        chatIdRef.current = adoptedSessionId;
      }
    } catch (e) {
      console.error("Submit for review failed:", e);
      const msg = e?.message || "Submit for review failed";
      setFormSaveMsg(`❌ ${msg}`);
    } finally {
      setSubmittingForReview(false);
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

        openFormInline(hydrated, { afterNextMessage: true });
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

  const handleSaveEmailDraft = (draft) => {
    updateMessages((prev) =>
      prev.map((m, idx) => {
        const sender = m.sender || (m.role === "assistant" ? "bot" : "user");
        const text =
          m.text ??
          (typeof m.content === "string"
            ? m.content
            : Array.isArray(m.content) && m.content[0]?.text
            ? m.content[0].text
            : "");

        const existingDraft =
          m.emailDraft ||
          (sender === "bot" && looksLikeEmailDraft(text)
            ? parseEmailDraftFromText(text, user?.email || "")
            : null);

        if (existingDraft && idx === prev.length - 1) {
          return {
            ...m,
            emailDraft: draft,
          };
        }
        return m;
      })
    );
  };

  const handleSendEmailDraft = async (draft) => {
    try {
      const to = String(draft?.to || "").trim();
      const subject = String(draft?.subject || "").trim();
      const body = String(draft?.body || "").trim();

      if (!to) {
        addMessage({
          sender: "bot",
          role: "assistant",
          text: "❌ Please enter recipient email before sending.",
        });
        return;
      }

      if (!subject) {
        addMessage({
          sender: "bot",
          role: "assistant",
          text: "❌ Please enter email subject before sending.",
        });
        return;
      }

      if (!body) {
        addMessage({
          sender: "bot",
          role: "assistant",
          text: "❌ Please enter email body before sending.",
        });
        return;
      }

      const token = await getAccessToken();
      const workingSessionId = chatIdRef.current || chat?.id || "default-chat";

      const res = await sendCustomerEmail(
        {
          sessionId: workingSessionId,
          userId: user?.email,
          to,
          subject,
          body,
        },
        token
      );

      addMessage({
        sender: "bot",
        role: "assistant",
        text: res?.reply || `✅ Email sent successfully to ${to}`,
      });
    } catch (e) {
      console.error("Send email failed:", e);
      addMessage({
        sender: "bot",
        role: "assistant",
        text: `❌ ${e?.message || "Failed to send email"}`,
      });
    }
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
        openFormInline(hydrated, { afterNextMessage: true });
        onFormStateChange?.(workingSessionId, hydrated);
      } else if (wantsForm) {
        const nextDraft = formDraft || defaultFormTemplate();
        openFormInline(nextDraft, { afterNextMessage: true });
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

  const shouldShowWelcome =
    !isCustomerRequestStarterSession &&
    (!cleanedMessages || cleanedMessages.length === 0);

  const showInlineCustomerStarter =
    isCustomerRequestStarterSession && !showForm;

  const renderFormMessageRow = (key) => (
    <div key={key} className="msg-row bot">
      <div className="msg-bubble">
        <FormEditorCard
          formDraft={formDraft}
          setFormDraft={(updater) => {
            setFormDraft((prev) =>
              typeof updater === "function" ? updater(prev) : updater
            );
          }}
          onSave={handleSaveForm}
          onSubmitForReview={handleSubmitForReview}
          saving={savingForm}
          submittingForReview={submittingForReview}
          saveMsg={formSaveMsg}
        />
      </div>
    </div>
  );

  const shouldRenderFormAtTop = showForm && formDraft && formInsertIndex === 0;

  const shouldRenderFormAtEnd =
    showForm &&
    formDraft &&
    (formInsertIndex === null || formInsertIndex >= normalizedMessages.length);

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
          !cleanedMessages || cleanedMessages.length === 0
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
                    suggestions={liveCustomerRequestSuggestions}
                    onOpenExistingCustomerRequest={onOpenExistingCustomerRequest}
                    onStartNewCustomerRequest={handleStartNewCustomerRequest}
                    disableStartNew={isStartingCustomerRequest || isTyping}
                    onSearchExistingCustomerRequests={
                      handleSearchExistingCustomerRequests
                    }
                    existingRequestsLoading={existingRequestsLoading}
                  />
                </div>
              </div>
            )}

            {shouldRenderFormAtTop && renderFormMessageRow("inline-form-top")}

            {normalizedMessages.map((m, index) => (
              <React.Fragment key={m.id || index}>
                {showForm &&
                  formDraft &&
                  formInsertIndex === index &&
                  renderFormMessageRow(`inline-form-before-${index}`)}

                <div className={`msg-row ${m.sender}`}>
                  <div className="msg-bubble">
                    {m.flowType === "customer_request" ? (
                      <CustomerRequestStepCard
                        message={m}
                        onSelectOption={handleFlowOptionSelect}
                        onSubmitManualInput={handleManualFlowSubmit}
                      />
                    ) : m.emailDraft ? (
                      <EmailDraftCard
                        draft={m.emailDraft}
                        onSaveDraft={handleSaveEmailDraft}
                        onSendEmail={handleSendEmailDraft}
                      />
                    ) : (
                      <MarkdownRenderer
                        text={m.text || ""}
                        onRequestRowClick={handleRequestRowClick}
                      />
                    )}
                    {!m.emailDraft && renderArtifact(m)}
                    {renderAttachments(m.attachments)}
                  </div>
                </div>
              </React.Fragment>
            ))}

            {normalizedMessages.length === 0 && shouldRenderFormAtEnd
              ? renderFormMessageRow("inline-form-empty-end")
              : null}

            {normalizedMessages.length > 0 && shouldRenderFormAtEnd
              ? renderFormMessageRow("inline-form-end")
              : null}
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