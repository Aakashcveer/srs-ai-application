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
import WorkflowFulfillmentBar from "./WorkflowFulfillmentBar";
import {
  sendChatMessage,
  uploadFilePresigned,
  downloadFilePresigned,
  confirmFileUploadAndType,
  saveGeneratedForm,
  searchCustomerRequests,
  sendCustomerEmail,
  processCustomerReply,
  triggerFmdAssessment,
  buildRequestConfirmationEmailMarkdown,
  presignAssessmentReportPdf,
  generateAssessmentCustomerEmail,
  uploadSupplierTaskFile,
  submitSupplierTaskForReview,
  downloadSupplierTaskFile,
} from "../../api/api-config";
import { getAccessToken } from "../../AWS/auth";

/* ===============================
   ✅ Constants
   =============================== */
const CUSTOMER_REQUEST_FROM_EMAIL =
  "sustainability@assureai.onmicrosoft.com";

const makeKcWorkflowRunId = () => {
  const now = new Date();
  const pad = (value, size = 2) => String(value).padStart(size, "0");

  const datePart = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const timePart = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const microPart = `${pad(now.getMilliseconds(), 3)}000`;

  const randomPart =
    typeof crypto !== "undefined" && crypto?.getRandomValues
      ? Array.from(crypto.getRandomValues(new Uint8Array(4)))
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join("")
      : Math.random().toString(16).slice(2, 10).padEnd(8, "0");

  return `${datePart}#${timePart}#${microPart}#${randomPart.slice(0, 8)}`;
};


// Keep all customer-request email subjects locked to the active sidebar session.
// Example sessionId:
// REQC#20260506#193347-37928ad1#BMW-CAL-R1#Brake Caliper-Rear
// requestId becomes:
// REQC#20260506#193347-37928ad1
const extractRequestIdFromSessionId = (sessionId = "") => {
  const value = String(sessionId || "").trim();
  if (!value) return "";

  const parts = value.split("#");
  if (parts.length >= 3 && /^REQ[A-Z]?$/i.test(parts[0])) {
    return `${parts[0]}#${parts[1]}#${parts[2]}`;
  }

  return value;
};

const extractPartNumberFromSessionId = (sessionId = "") => {
  const parts = String(sessionId || "").split("#");
  return parts.length >= 4 ? parts[3] || "" : "";
};

const extractPartNameFromSessionId = (sessionId = "") => {
  const parts = String(sessionId || "").split("#");
  return parts.length >= 5 ? parts.slice(4).join("#") || "" : "";
};

const buildLockedCustomerEmailSubject = (sessionId = "", draft = {}) => {
  const requestId = extractRequestIdFromSessionId(sessionId);
  const partName =
    draft?.CustomerPartName ||
    draft?.customerPartName ||
    extractPartNameFromSessionId(sessionId) ||
    "Customer Request";
  const partNumber =
    draft?.CustomerPartNumber ||
    draft?.customerPartNumber ||
    extractPartNumberFromSessionId(sessionId) ||
    "";

  if (!requestId) return String(draft?.subject || draft?.Subject || "Customer Request Update");

  return `Customer Request - ${requestId} - ${partName}${partNumber ? ` | ${partNumber}` : ""}`;
};

const lockEmailDraftToSession = (draft = null, sessionId = "", formDraft = {}) => {
  if (!draft) return draft;
  const lockedSubject = buildLockedCustomerEmailSubject(sessionId, formDraft);
  return {
    ...draft,
    subject: lockedSubject,
    Subject: lockedSubject,
  };
};

const lockArtifactToSession = (artifact = null, sessionId = "", formDraft = {}) => {
  if (!artifact) return artifact;
  const lockedSubject = buildLockedCustomerEmailSubject(sessionId, formDraft);

  if (artifact?.type === "email_draft" || artifact?.subject || artifact?.Subject) {
    return {
      ...artifact,
      subject: lockedSubject,
      Subject: lockedSubject,
    };
  }

  return artifact;
};

const lockReplyTextSubjectToSession = (text = "", sessionId = "", formDraft = {}) => {
  const value = String(text || "");
  if (!value) return value;

  const lockedSubject = buildLockedCustomerEmailSubject(sessionId, formDraft);

  if (/^Subject\s*:/i.test(value.trim())) {
    return value.replace(/^Subject\s*:.*/i, `Subject: ${lockedSubject}`);
  }

  return value;
};

// Compact customer email body for Gmail/Outlook.
// This avoids the large markdown spacing that Gmail was showing in received mails.
const buildCompactCustomerEmailBody = ({
  requestId = "",
  customerName = "",
  customerPart = "",
  requestName = "Customer Request",
  requestType = "",
  requestDescription = "",
  requestPriority = "Medium",
  requestCompletionDateTime = "",
  engineeringContactEmailId = "",
} = {}) => {
  const clean = (value) => String(value ?? "").trim();
  const safeCustomer = clean(customerName) || "Customer";
  const safeRequestType = clean(requestType) || "Customer Request";
  const safeRequestName = clean(requestName) || "Customer Request";
  const safeDescription = clean(requestDescription);

  return [
    `Dear ${safeCustomer} Team,`,
    "",
    `This email confirms that we have received and logged your request for ${safeRequestType}.`,
    "",
    "Request Information:",
    `- Request ID: ${clean(requestId)}`,
    `- Request Name: ${safeRequestName}`,
    `- Current Status: REQUEST-REVIEW`,
    `- Priority: ${clean(requestPriority) || "Medium"}`,
    "",
    "Part & Project Details:",
    `- Customer: ${safeCustomer}`,
    `- Part Description: ${clean(customerPart)}`,
    safeDescription ? `- Objective: ${safeDescription}` : "- Objective: Not provided",
    "",
    "Timeline & Contact:",
    `- Estimated Completion: ${clean(requestCompletionDateTime) || "Not provided"}`,
    `- Engineering Lead: ${clean(engineeringContactEmailId)}`,
    "",
    "Next Steps:",
    "Our team is currently in the REQUEST-REVIEW phase. We will reach out if any further clarification or documentation is required.",
    "",
    "Best regards,",
    "Engineering Operations Team",
  ]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};


/* ===============================
   ✅ Common message helpers
   =============================== */

const WORKFLOW_STATUS_ORDER = [
  "REQUEST-CREATE",
  "REQUEST-REVIEW",
  "REQUEST-CONFIRMED",
  "ASSESSMENT-TRIGGERED",
  "ASSESSMENT-INPROGRESS",
  "ASSESSMENT-COMPLETED",
  "RESULTS-REVIEW",
  "RESULTS-APPROVED",
  "RESULTS-SUBMITTED",
  "REQUEST-CLOSED",
];


const safeJsonStringify = (value) => {
  try {
    const seen = new WeakSet();
    return JSON.stringify(value, (key, val) => {
      if (typeof val === "object" && val !== null) {
        if (seen.has(val)) return "";
        seen.add(val);
      }
      if (key === "_owner" || key === "__reactFiber$" || key === "__reactProps$") return "";
      return val;
    });
  } catch {
    return "";
  }
};

const escapeRegex = (value = "") =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeWorkflowStatus = (status = "") => {
  const value = String(status || "")
    .trim()
    .toUpperCase()
    .replace(/_/g, "-")
    .replace(/\s+/g, "-");

  if (value === "ASSESSMENT-IN-PROGRESS") return "ASSESSMENT-INPROGRESS";
  if (value === "REQUEST-CREATED") return "REQUEST-CREATE";
  if (value === "REQUEST-REVIEWED") return "REQUEST-REVIEW";
  if (value === "REQUEST-SUBMITTED") return "RESULTS-SUBMITTED";

  return WORKFLOW_STATUS_ORDER.includes(value) ? value : "";
};

const extractWorkflowStatusFromText = (text = "") => {
  const value = String(text || "").toUpperCase();
  if (!value) return "";

  const explicitPatterns = [
    /REQUEST\s*STATUS\s*[:=-]\s*([A-Z][A-Z\s_-]+)/i,
    /CURRENT\s+STATUS\s*[:=-]\s*([A-Z][A-Z\s_-]+)/i,
    /WORKFLOW\s*STATE\s*[:=-]\s*([A-Z][A-Z\s_-]+)/i,
    /STATUS\s*[:=-]\s*([A-Z][A-Z\s_-]+)/i,
  ];

  for (const pattern of explicitPatterns) {
    const match = value.match(pattern);
    if (match?.[1]) {
      const cleaned = match[1]
        .split(/[\n,|]/)[0]
        .replace(/[^A-Z0-9_-]+$/g, "")
        .trim();
      const normalized = normalizeWorkflowStatus(cleaned);
      if (normalized) return normalized;
    }
  }

  for (let i = WORKFLOW_STATUS_ORDER.length - 1; i >= 0; i -= 1) {
    const status = WORKFLOW_STATUS_ORDER[i];
    const re = new RegExp(`\\b${escapeRegex(status)}\\b`, "i");
    if (re.test(value)) return status;
  }

  return "";
};

const extractWorkflowStatusFromMessage = (message = {}) => {
  const directStatus = normalizeWorkflowStatus(
    message?.RequestStatus ||
      message?.requestStatus ||
      message?.workflowState ||
      message?.WorkflowState ||
      message?.artifact?.RequestStatus ||
      message?.artifact?.requestStatus ||
      message?.artifact?.workflowState ||
      message?.artifact?.WorkflowState ||
      ""
  );

  if (directStatus) return directStatus;

  const text = [
    extractMessageText(message),
    message?.text,
    typeof message?.content === "string" ? message.content : "",
    message?.artifact ? safeJsonStringify(message.artifact) : "",
  ]
    .filter(Boolean)
    .join("\n");

  return extractWorkflowStatusFromText(text);
};

const extractCurrentRequestStatusFromMessages = (messages = []) => {
  const list = Array.isArray(messages) ? messages : [];

  for (let i = list.length - 1; i >= 0; i -= 1) {
    const status = extractWorkflowStatusFromMessage(list[i]);
    if (status) return status;
  }

  return "";
};

const hasSupplierPendingAssessmentSignal = (messages = []) => {
  const list = Array.isArray(messages) ? messages : [];

  return list.some((m) => {
    const text = [
      extractMessageText(m),
      m?.text,
      typeof m?.content === "string" ? m.content : "",
      m?.artifact ? safeJsonStringify(m.artifact) : "",
      m?.emailDraft ? safeJsonStringify(m.emailDraft) : "",
    ]
      .filter(Boolean)
      .join("\n")
      .toLowerCase();

    return (
      text.includes("supplier task created") ||
      text.includes("supplier email draft") ||
      text.includes("supplier_fmd_request") ||
      text.includes("request fmd documents from supplier") ||
      text.includes("url to upload documents") ||
      text.includes("full material disclosure")
    );
  });
};

const isSupplierTaskSessionId = (sessionId = "") => {
  const value = String(sessionId || "").trim().toUpperCase();
  return value.startsWith("TSKS") || value.startsWith("TSKE");
};

// Supplier task screen guard.
// When switching/opening a TSKS/TSKE task, React can briefly keep old customer-request
// flow messages in state. Do NOT hide all messages because that can blank the screen;
// only hide customer request flow prompts/cards while preserving supplier task content.
const isCustomerRequestFlowOnlyMessage = (message = {}) => {
  const text = String(extractMessageText(message) || message?.text || "")
    .trim()
    .toLowerCase();

  return (
    message?.flowType === "customer_request" ||
    isCustomerFlowQuestionText(text) ||
    text === "create a new customer request" ||
    text === "bmw group"
  );
};


// Engineer supplier task safety:
// The supplier review screen must be rendered from task/session data.
// It should not send/read the old natural-language test prompt as a normal chat message.
const isSupplierTaskAutoSummaryPromptText = (text = "") => {
  const value = String(text || "").trim().toLowerCase();
  return (
    value === "__load_supplier_task_review__" ||
    (
      value.includes("show my pending task for supplier task") &&
      value.includes("uploaded documents")
    )
  );
};

const isSupplierTaskGenericNoAccessReplyText = (text = "") => {
  const value = String(text || "").trim().toLowerCase();
  if (!value) return false;

  const mentionsSupplierTask =
    value.includes("supplier task") ||
    value.includes("tsks#") ||
    value.includes("tske#") ||
    value.includes("tsk#");

  if (!mentionsSupplierTask) return false;

  return (
    value.includes("i'm afraid i do not have the capability") ||
    value.includes("i am afraid i do not have the capability") ||
    value.includes("i apologize, but without access") ||
    value.includes("unfortunately, without more specific information") ||
    value.includes("unable to directly retrieve") ||
    value.includes("unable to directly access") ||
    value.includes("without access to your company's internal task management system") ||
    value.includes("without being connected to your company's internal systems") ||
    value.includes("task management systems and processes can vary") ||
    value.includes("i do not have the capability to directly pull up") ||
    value.includes("i cannot directly retrieve and display")
  );
};

const isSupplierTaskAutoChatNoiseMessage = (message = {}) => {
  const text = String(extractMessageText(message) || message?.text || "")
    .trim()
    .toLowerCase();

  return (
    isSupplierTaskAutoSummaryPromptText(text) ||
    isSupplierTaskGenericNoAccessReplyText(text)
  );
};

const buildSupplierTaskFallbackMessage = (sessionId = "", taskLike = {}) => {
  const seededTask = normalizeSupplierTask({
    supplierTask: {
      ...(taskLike || {}),
      taskId:
        taskLike?.taskId ||
        taskLike?.TaskId ||
        taskLike?.sessionId ||
        taskLike?.SessionId ||
        sessionId,
      TaskId:
        taskLike?.TaskId ||
        taskLike?.taskId ||
        taskLike?.sessionId ||
        taskLike?.SessionId ||
        sessionId,
      taskType: taskLike?.taskType || taskLike?.TaskType || "Supplier Request",
      TaskType: taskLike?.TaskType || taskLike?.taskType || "Supplier Request",
    },
  });

  return {
    id: `supplier-task-fallback-${String(sessionId || "")}`,
    sender: "bot",
    role: "assistant",
    text: "Supplier task loaded.",
    content: "Supplier task loaded.",
    supplierTask: seededTask || {
      taskId: String(sessionId || ""),
      taskName: "Request for Material Disclosure",
      taskStatus: "LOADING",
      taskPriority: "-",
      taskType: "Supplier Request",
      requestId: "",
      assignedFor: "-",
      uploadUrl: "http://localhost:5173",
      description: "Loading supplier task details...",
      uploadedDocuments: [],
      additionalInformation: "",
      missingInformation: ["Full Material Disclosure document"],
      taskItem: {},
    },
  };
};

const hasLoadedSupplierTaskMessage = (messages = []) => {
  const list = Array.isArray(messages) ? messages : [];

  return list.some((m) => {
    const artifactType = String(
      m?.artifact?.type ||
        m?.supplierTask?.type ||
        ""
    )
      .toLowerCase()
      .trim();

    const text = [
      extractMessageText(m),
      m?.text,
      typeof m?.content === "string" ? m.content : "",
    ]
      .filter(Boolean)
      .join("\n")
      .toLowerCase();

    return (
      artifactType === "supplier_task" ||
      text.includes("supplier task loaded") ||
      text.includes("upload requested fmd information") ||
      text.includes("please upload the requested document/information")
    );
  });
};

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


const isEmailSentConfirmationText = (text = "") => {
  const value = String(text || "").trim().toLowerCase();
  return (
    value.includes("email sent successfully") ||
    value.includes("status moved to results-submitted") ||
    value.includes("status moved to request-review") ||
    value.includes("with attached assessment pdf")
  );
};


const getAssessmentReportArtifact = (message = {}) => {
  const artifact = message?.artifact || {};
  const artifactType = String(artifact?.type || artifact?.artifactType || "")
    .trim()
    .toLowerCase();

  const reportPath = String(
    artifact?.assessmentReportS3Path ||
      artifact?.AssessmentReportS3Path ||
      artifact?.reportS3Path ||
      artifact?.ReportPublishedFilePath ||
      artifact?.assessment?.assessmentReportS3Path ||
      ""
  ).trim();

  const reportStatus = String(
    artifact?.assessmentReportPublishedStatus ||
      artifact?.ReportPublishedStatus ||
      artifact?.assessment?.assessmentReportPublishedStatus ||
      ""
  ).trim();

  const reportMarkdown = String(
    artifact?.assessmentReportMarkdown ||
      artifact?.AssessmentReportMarkdown ||
      artifact?.assessment?.assessmentReportMarkdown ||
      ""
  ).trim();

  const text = String(extractMessageText(message) || "");
  const looksLikeAssessmentReport =
    artifactType === "assessment_report" ||
    Boolean(reportPath) ||
    text.toLowerCase().includes("assessment report generated") ||
    (text.toLowerCase().includes("full material disclosure") &&
      text.toLowerCase().includes("compliance report"));

  if (!looksLikeAssessmentReport) return null;

  return {
    ...(artifact || {}),
    type: "assessment_report",
    requestId: String(
      artifact?.requestId || artifact?.RequestId || ""
    ).trim(),
    assessmentReportS3Path: reportPath,
    assessmentReportPublishedStatus: reportStatus,
    assessmentReportMarkdown: reportMarkdown,
  };
};





const getAssessmentMarkdownForViewer = (message = {}, fallbackText = "") => {
  const artifact = message?.artifact || {};
  const assessment = artifact?.assessment || message?.assessment || {};

  const candidates = [
    artifact?.assessmentReportMarkdown,
    artifact?.AssessmentReportMarkdown,
    artifact?.assessment?.assessmentReportMarkdown,
    artifact?.assessment?.AssessmentReportMarkdown,
    assessment?.assessmentReportMarkdown,
    assessment?.AssessmentReportMarkdown,
    message?.assessmentReportMarkdown,
    message?.AssessmentReportMarkdown,
    fallbackText,
    extractMessageText(message),
  ];

  for (const value of candidates) {
    const clean = String(value || "").trim();
    const lower = clean.toLowerCase();

    if (!clean) continue;
    if (lower === "customer email draft generated with assessment pdf attachment.") continue;
    if (lower === "email draft generated with assessment pdf attachment.") continue;
    if (lower.includes("email sent successfully")) continue;

    if (
      lower.includes("full material disclosure") ||
      lower.includes("imds compliance report") ||
      lower.includes("regulatory compliance matrix") ||
      lower.includes("bill of material") ||
      lower.includes("compliance report")
    ) {
      return clean;
    }
  }

  return "";
};


const getAssessmentMarkdownFromSessionData = (session = {}) => {
  const assessmentResult = session?.assessmentResult || session?.AssessmentResult || {};
  const assessmentDetail = session?.assessmentDetail || session?.AssessmentDetail || {};

  const candidates = [
    session?.assessmentReportMarkdown,
    session?.AssessmentReportMarkdown,
    assessmentResult?.assessmentReportMarkdown,
    assessmentResult?.AssessmentReportMarkdown,
    assessmentResult?.report,
    assessmentResult?.Report,
    assessmentDetail?.assessmentReportMarkdown,
    assessmentDetail?.AssessmentReportMarkdown,
    assessmentDetail?.report,
    assessmentDetail?.Report,
  ];

  for (const value of candidates) {
    const clean = String(value || "").trim();
    const lower = clean.toLowerCase();

    if (!clean) continue;
    if (lower.includes("email sent successfully")) continue;
    if (lower.includes("email draft generated with assessment pdf attachment")) continue;

    const looksLikeReport =
      lower.includes("full material disclosure") ||
      lower.includes("imds compliance report") ||
      lower.includes("regulatory compliance matrix") ||
      lower.includes("bill of material") ||
      lower.includes("compliance report");

    if (looksLikeReport) return clean;
  }

  return "";
};


const isAssessmentReportMessage = (message = {}) =>
  Boolean(getAssessmentReportArtifact(message));

const getMessageEmailDraft = (message = {}) => {
  const artifact = message?.artifact || {};
  const directDraft = message?.emailDraft || message?.EmailDraft || null;

  if (directDraft && typeof directDraft === "object") {
    return directDraft;
  }

  const artifactType = String(artifact?.type || artifact?.artifactType || "")
    .trim()
    .toLowerCase();
  const emailKind = String(artifact?.emailKind || artifact?.kind || "")
    .trim()
    .toLowerCase();

  if (
    artifactType === "email_draft" ||
    emailKind === "assessment_report_customer_email" ||
    emailKind === "customer_request_email"
  ) {
    return {
      ...artifact,
      type: "email_draft",
      emailKind: artifact?.emailKind || artifact?.kind || "customer_request_email",
      kind: artifact?.kind || artifact?.emailKind || "customer_request_email",
      to: artifact?.to || artifact?.To || "",
      from: artifact?.from || artifact?.From || CUSTOMER_REQUEST_FROM_EMAIL,
      subject: artifact?.subject || artifact?.Subject || "",
      body: artifact?.body || artifact?.Body || "",
      attachments: Array.isArray(artifact?.attachments) ? artifact.attachments : [],
      attachmentFileName: artifact?.attachmentFileName || "",
      reportS3Path: artifact?.assessmentReportS3Path || artifact?.reportS3Path || "",
      assessmentReportS3Path: artifact?.assessmentReportS3Path || artifact?.reportS3Path || "",
      attachAssessmentPdf: Boolean(artifact?.attachAssessmentPdf),
      requestId: artifact?.requestId || artifact?.RequestId || "",
    };
  }

  return null;
};

const fileNameFromS3Path = (s3Path = "", fallback = "assessment-report.pdf") => {
  const clean = String(s3Path || "").trim();
  if (!clean) return fallback;
  return clean.split("/").pop() || fallback;
};


const isFullAssessmentS3Path = (value = "") => {
  const clean = String(value || "").trim();
  return (
    clean.startsWith("s3://") ||
    clean.startsWith("assessment-docs/") ||
    clean.includes("/assessment-docs/")
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
    value.includes(
      "would you like me to generate a professional customer email draft"
    )
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

const isCustomerFlowQuestionText = (text = "") => {
  const value = String(text || "").trim().toLowerCase();
  return [
    "select customer name",
    "enter customer name",
    "select customer part name",
    "enter customer part name",
    "select customer part number",
    "enter customer part number",
    "select customer part name and number",
  ].includes(value);
};

const guessCustomerFlowStepFromQuestion = (question = "") => {
  const value = String(question || "").trim().toLowerCase();

  if (value === "select customer name") return "customer_name";
  if (value === "enter customer name") return "customer_name_manual";
  if (value === "select customer part name") return "customer_part_name";
  if (value === "enter customer part name") return "customer_part_name_manual";
  if (value === "select customer part number") return "customer_part_number";
  if (value === "enter customer part number")
    return "customer_part_number_manual";
  if (value === "select customer part name and number")
    return "customer_part_name";

  return "";
};

const buildCustomerFlowMessageFromResponse = (res = {}) => {
  const reply = String(res?.reply || "").trim();
  const question = String(res?.question || reply || "").trim();
  const options = Array.isArray(res?.options) ? res.options : [];
  const inputType = res?.inputType || null;
  const step = String(res?.step || guessCustomerFlowStepFromQuestion(question));

  const looksLikeFlow =
    res?.flowType === "customer_request" ||
    !!res?.question ||
    !!res?.step ||
    !!res?.inputType ||
    options.length > 0 ||
    isCustomerFlowQuestionText(reply);

  if (!looksLikeFlow) return null;

  return {
    sender: "bot",
    role: "assistant",
    text: reply || question,
    flowType: "customer_request",
    step,
    question: question || reply,
    options,
    inputType,
  };
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

const normalizeFlowOptions = (options = []) =>
  (Array.isArray(options) ? options : []).map((x) => String(x || "").trim());

const areFlowOptionsEqual = (a = [], b = []) => {
  const aa = normalizeFlowOptions(a);
  const bb = normalizeFlowOptions(b);
  if (aa.length !== bb.length) return false;
  return aa.every((item, idx) => item === bb[idx]);
};

const isSameCustomerFlowCard = (a = {}, b = {}) => {
  if (a?.flowType !== "customer_request" || b?.flowType !== "customer_request") {
    return false;
  }

  return (
    String(a?.step || "").trim() === String(b?.step || "").trim() &&
    String(a?.question || "").trim() === String(b?.question || "").trim() &&
    String(a?.inputType || "").trim() === String(b?.inputType || "").trim() &&
    areFlowOptionsEqual(a?.options || [], b?.options || [])
  );
};

const mergeUniqueRequestSuggestions = (...lists) => {
  const merged = [];
  const seenSessionIds = new Set();
  const seenRequestIds = new Set();

  for (const list of lists) {
    for (const item of Array.isArray(list) ? list : []) {
      if (!item || typeof item !== "object") continue;

      const sessionId = String(
        item?.sessionId || item?.SessionId || ""
      ).trim();
      const requestId = String(
        item?.requestId || item?.RequestId || ""
      ).trim();

      const sessionKey = sessionId.toLowerCase();
      const requestKey = requestId.toLowerCase();

      if (sessionKey && seenSessionIds.has(sessionKey)) continue;
      if (requestKey && seenRequestIds.has(requestKey)) continue;

      if (sessionKey) seenSessionIds.add(sessionKey);
      if (requestKey) seenRequestIds.add(requestKey);

      merged.push(item);
    }
  }

  return merged;
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
   ✅ Process Customer Reply Modal
   =============================== */
const CustomerReplyModal = ({
  open,
  subject,
  body,
  setSubject,
  setBody,
  onClose,
  onSubmit,
  loading,
}) => {
  if (!open) return null;

  return createPortal(
    <>
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(15, 23, 42, 0.38)",
          zIndex: 9998,
        }}
        onClick={onClose}
      />

      <div
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "min(680px, calc(100vw - 24px))",
          background: "#fff",
          borderRadius: "18px",
          boxShadow: "0 30px 80px rgba(15, 23, 42, 0.22)",
          padding: "22px",
          zIndex: 9999,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            fontSize: "12px",
            fontWeight: 700,
            color: "#6b7a90",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            marginBottom: "8px",
          }}
        >
          Customer Reply
        </div>

        <div
          style={{
            fontSize: "22px",
            fontWeight: 700,
            color: "#1f2b3d",
            marginBottom: "8px",
          }}
        >
          Process customer response
        </div>

        <div
          style={{
            fontSize: "14px",
            color: "#6b7280",
            marginBottom: "18px",
            lineHeight: 1.5,
          }}
        >
          Paste the customer email reply here. Backend will classify it and move
          status to <strong>REQUEST-CONFIRMED</strong> if confirmed.
        </div>

        <div style={{ marginBottom: "14px" }}>
          <label
            style={{
              display: "block",
              fontSize: "13px",
              fontWeight: 600,
              color: "#24324a",
              marginBottom: "8px",
            }}
          >
            Email Subject
          </label>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Ex: Re: Customer Request Submitted for Review"
            style={{
              width: "100%",
              height: "44px",
              borderRadius: "12px",
              border: "1px solid #dbe3f0",
              padding: "0 14px",
              fontSize: "14px",
              outline: "none",
            }}
          />
        </div>

        <div style={{ marginBottom: "18px" }}>
          <label
            style={{
              display: "block",
              fontSize: "13px",
              fontWeight: 600,
              color: "#24324a",
              marginBottom: "8px",
            }}
          >
            Email Body
          </label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Ex: Okay looks good, proceed."
            rows={8}
            style={{
              width: "100%",
              borderRadius: "12px",
              border: "1px solid #dbe3f0",
              padding: "12px 14px",
              fontSize: "14px",
              outline: "none",
              resize: "vertical",
            }}
          />
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: "10px",
          }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="premiumGhostBtn"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={onSubmit}
            disabled={loading || (!subject.trim() && !body.trim())}
            className="formSaveBtn premiumFormSaveBtn"
          >
            {loading ? "Processing..." : "Process Reply"}
          </button>
        </div>
      </div>
    </>,
    document.body
  );
};

/* ===============================
   ✅ Process Customer Reply Card
   =============================== */
const CustomerReplyActionCard = ({ onOpen }) => {
  return (
    <div className="emailDraftShell">
      <div className="emailDraftHeader">
        <div>
          <div className="emailDraftEyebrow">Customer Reply</div>
          <div className="emailDraftTitle">Update request from customer email</div>
        </div>
      </div>

      <div
        className="emailDraftFooter"
        style={{ paddingTop: "8px", borderTop: "none" }}
      >
        <div className="emailDraftFooterHint">
          Paste the customer response and classify it to move the request to
          REQUEST-CONFIRMED when applicable.
        </div>

        <div className="emailDraftFooterActions">
          <button
            type="button"
            className="formSaveBtn premiumFormSaveBtn"
            onClick={onOpen}
          >
            Process Customer Reply
          </button>
        </div>
      </div>
    </div>
  );
};



const EmailSentConfirmationCard = ({ text = "" }) => {
  const cleanText = String(text || "").replace(/^✅\s*/, "").trim();

  return (
    <div className="emailSentConfirmationCard">
      <span className="emailSentConfirmationIcon">✅</span>
      <span>{cleanText}</span>
    </div>
  );
};


/* ===============================
   ✅ Automatic EMAIL REVIEW Action Card
   =============================== */
const extractCustomerEmailReplyFromMessages = (messages = []) => {
  const list = Array.isArray(messages) ? messages : [];

  for (let i = list.length - 1; i >= 0; i -= 1) {
    const msg = list[i] || {};
    const text = String(extractMessageText(msg) || msg?.text || "").trim();
    const lower = text.toLowerCase();
    const artifact = msg?.artifact || {};

    if (
      artifact?.type === "email_review_task" ||
      artifact?.AskType === "EMAIL REVIEW" ||
      msg?.AskType === "EMAIL REVIEW" ||
      lower.includes("customer_email_reply") ||
      lower.includes("customer email reply received") ||
      lower.includes("status moved to email-review")
    ) {
      const subjectFromText =
        text.match(/Subject:\s*([^\n]+)/i)?.[1]?.trim() ||
        artifact?.replySubject ||
        artifact?.CustomerReplySubject ||
        msg?.CustomerReplySubject ||
        "Customer email reply";

      const fromFromText =
        text.match(/From:\s*([^\n]+)/i)?.[1]?.trim() ||
        artifact?.replyFrom ||
        artifact?.CustomerReplyFrom ||
        msg?.CustomerReplyFrom ||
        "";

      const requestIdFromText =
        text.match(/REQ[A-Z]?#\d{8}#\d{6}-[A-Za-z0-9]+/i)?.[0] ||
        artifact?.requestId ||
        artifact?.RequestId ||
        msg?.requestId ||
        msg?.RequestId ||
        "";

      let body =
        artifact?.replyBody ||
        artifact?.CustomerReplyBody ||
        msg?.CustomerReplyBody ||
        "";

      if (!body && lower.includes("customer_email_reply")) {
        body = text
          .replace(/CUSTOMER_EMAIL_REPLY/i, "")
          .replace(/From:\s*[^\n]+/i, "")
          .replace(/Subject:\s*[^\n]+/i, "")
          .trim();
      }

      return {
        askType: artifact?.AskType || msg?.AskType || "EMAIL REVIEW",
        status: artifact?.RequestStatus || msg?.RequestStatus || "EMAIL-REVIEW",
        assignedTo:
          artifact?.AssignedTo ||
          artifact?.assignedTo ||
          artifact?.EngineeringContactEmailId ||
          msg?.AssignedTo ||
          msg?.assignedTo ||
          msg?.EngineeringContactEmailId ||
          "",
        requestId: requestIdFromText,
        subject: subjectFromText,
        from: fromFromText,
        body: String(body || "").trim(),
      };
    }
  }

  return {
    askType: "EMAIL REVIEW",
    status: "EMAIL-REVIEW",
    assignedTo: "",
    requestId: "",
    subject: "",
    from: "",
    body: "",
  };
};

const hasEmailReviewSignal = (messages = []) => {
  return (Array.isArray(messages) ? messages : []).some((m) => {
    const text = String(extractMessageText(m) || m?.text || "").toLowerCase();
    const artifact = m?.artifact || {};
    return (
      artifact?.type === "email_review_task" ||
      artifact?.AskType === "EMAIL REVIEW" ||
      m?.AskType === "EMAIL REVIEW" ||
      text.includes("email-review") ||
      text.includes("email review") ||
      text.includes("customer_email_reply") ||
      text.includes("customer email reply received")
    );
  });
};


const getEmailReviewRequestIdFromMessage = (m = {}) => {
  const artifact = m?.artifact || {};
  const text = String(extractMessageText(m) || m?.text || "");

  return String(
    artifact?.requestId ||
      artifact?.RequestId ||
      m?.requestId ||
      m?.RequestId ||
      text.match(/REQ[A-Z]?#\d{8}#\d{6}-[A-Za-z0-9]+/i)?.[0] ||
      ""
  ).trim();
};

const getEmailReviewDedupeKey = (m = {}) => {
  const artifact = m?.artifact || {};
  const text = String(extractMessageText(m) || m?.text || "").trim();
  const lower = text.toLowerCase();

  const looksLikeEmailReview =
    artifact?.type === "email_review_task" ||
    artifact?.AskType === "EMAIL REVIEW" ||
    m?.AskType === "EMAIL REVIEW" ||
    lower.includes("customer_email_reply") ||
    lower.includes("customer email reply received") ||
    lower.includes("status moved to email-review");

  if (!looksLikeEmailReview) return "";

  const requestId = getEmailReviewRequestIdFromMessage(m);
  const graphPostId = String(
    artifact?.graphPostId ||
      artifact?.CustomerReplyGraphPostId ||
      m?.graphPostId ||
      m?.CustomerReplyGraphPostId ||
      ""
  ).trim();

  if (graphPostId) return `graph:${graphPostId}`;

  const subject = String(
    artifact?.replySubject ||
      artifact?.CustomerReplySubject ||
      m?.CustomerReplySubject ||
      text.match(/Subject:\s*([^\n]+)/i)?.[1] ||
      ""
  )
    .trim()
    .toLowerCase();

  const body = String(
    artifact?.replyBody ||
      artifact?.CustomerReplyBody ||
      m?.CustomerReplyBody ||
      text
        .replace(/CUSTOMER_EMAIL_REPLY/i, "")
        .replace(/From:\s*[^\n]+/i, "")
        .replace(/Subject:\s*[^\n]+/i, "") ||
      ""
  )
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .slice(0, 220);

  return `fallback:${requestId}|${subject}|${body}`;
};

const isRawCustomerEmailReplyMessage = (m = {}) => {
  const text = String(extractMessageText(m) || m?.text || "").trim();
  return /^CUSTOMER_EMAIL_REPLY\b/i.test(text);
};

const EmailReviewActionCard = ({
  replyInfo,
  requestId,
  assignedTo,
  onSubmitForAssessment,
  onRequestChanges,
  loading,
}) => {
  const bodyPreview = String(replyInfo?.body || "").trim();
  const displayRequestId =
    replyInfo?.requestId || requestId || "Current customer request";
  const displayAssignedTo =
    replyInfo?.assignedTo || assignedTo || "Assigned engineer";
  const displayAskType = replyInfo?.askType || "EMAIL REVIEW";
  const displayStatus = replyInfo?.status || "EMAIL-REVIEW";

  const styles = {
    shell: {
      position: "relative",
      overflow: "hidden",
      borderRadius: "22px",
      border: "1px solid rgba(99, 102, 241, 0.22)",
      background:
        "linear-gradient(135deg, rgba(255,255,255,0.98), rgba(248,250,255,0.98))",
      boxShadow:
        "0 24px 70px rgba(15, 23, 42, 0.12), 0 1px 0 rgba(255,255,255,0.9) inset",
      padding: "22px",
    },
    accent: {
      position: "absolute",
      inset: "0 auto 0 0",
      width: "6px",
      background: "linear-gradient(180deg, #6366f1, #22c55e)",
    },
    top: {
      display: "flex",
      alignItems: "flex-start",
      justifyContent: "space-between",
      gap: "16px",
      marginBottom: "18px",
      paddingLeft: "4px",
    },
    eyebrow: {
      fontSize: "12px",
      fontWeight: 800,
      letterSpacing: "0.12em",
      textTransform: "uppercase",
      color: "#64748b",
      marginBottom: "6px",
    },
    title: {
      fontSize: "24px",
      lineHeight: 1.15,
      fontWeight: 900,
      color: "#0f172a",
      margin: 0,
    },
    badgeWrap: {
      display: "flex",
      flexWrap: "wrap",
      gap: "8px",
      justifyContent: "flex-end",
    },
    badge: {
      borderRadius: "999px",
      padding: "8px 11px",
      fontSize: "11px",
      fontWeight: 800,
      letterSpacing: "0.06em",
      textTransform: "uppercase",
      border: "1px solid rgba(99, 102, 241, 0.18)",
      background: "rgba(238, 242, 255, 0.9)",
      color: "#3730a3",
      whiteSpace: "nowrap",
    },
    dangerBadge: {
      borderRadius: "999px",
      padding: "8px 11px",
      fontSize: "11px",
      fontWeight: 800,
      letterSpacing: "0.06em",
      textTransform: "uppercase",
      border: "1px solid rgba(245, 158, 11, 0.25)",
      background: "rgba(255, 251, 235, 0.95)",
      color: "#92400e",
      whiteSpace: "nowrap",
    },
    infoGrid: {
      display: "grid",
      gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
      gap: "12px",
      marginBottom: "14px",
    },
    infoCard: {
      borderRadius: "16px",
      border: "1px solid #e2e8f0",
      background: "rgba(255,255,255,0.82)",
      padding: "13px 14px",
      minWidth: 0,
    },
    label: {
      fontSize: "11px",
      fontWeight: 800,
      color: "#64748b",
      letterSpacing: "0.09em",
      textTransform: "uppercase",
      marginBottom: "6px",
    },
    value: {
      fontSize: "14px",
      fontWeight: 750,
      color: "#0f172a",
      wordBreak: "break-word",
    },
    replyBox: {
      borderRadius: "18px",
      border: "1px solid rgba(148, 163, 184, 0.28)",
      background: "linear-gradient(180deg, #ffffff, #f8fafc)",
      padding: "16px",
      marginTop: "10px",
      marginBottom: "16px",
    },
    footer: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "16px",
      borderTop: "1px solid rgba(226, 232, 240, 0.9)",
      paddingTop: "16px",
    },
    hintTitle: {
      fontSize: "14px",
      fontWeight: 850,
      color: "#0f172a",
      marginBottom: "4px",
    },
    hintText: {
      fontSize: "13px",
      color: "#64748b",
      lineHeight: 1.45,
    },
    actionWrap: {
      display: "flex",
      alignItems: "center",
      justifyContent: "flex-end",
      gap: "10px",
      flexWrap: "wrap",
      flexShrink: 0,
    },
    secondaryBtn: {
      minWidth: "170px",
      minHeight: "48px",
      borderRadius: "14px",
      border: "1px solid rgba(99, 102, 241, 0.24)",
      background: "rgba(255, 255, 255, 0.92)",
      color: "#3730a3",
      fontWeight: 850,
      boxShadow: "0 10px 26px rgba(15, 23, 42, 0.06)",
    },
  };

  return (
    <div style={styles.shell}>
      <div style={styles.accent} />

      <div style={styles.top}>
        <div>
          <div style={styles.eyebrow}>Engineer Action Required</div>
          <h3 style={styles.title}>Customer reply requires review</h3>
        </div>

        <div style={styles.badgeWrap}>
          <span style={styles.dangerBadge}>Pending engineer action</span>
          <span style={styles.badge}>Ask Type: {displayAskType}</span>
          <span style={styles.badge}>Status: {displayStatus}</span>
        </div>
      </div>

      <div style={styles.infoGrid}>
        <div style={styles.infoCard}>
          <div style={styles.label}>Request ID</div>
          <div style={styles.value}>{displayRequestId}</div>
        </div>

        <div style={styles.infoCard}>
          <div style={styles.label}>Assigned To</div>
          <div style={styles.value}>{displayAssignedTo}</div>
        </div>

        <div style={styles.infoCard}>
          <div style={styles.label}>Customer Reply From</div>
          <div style={styles.value}>
            {replyInfo?.from || <span className="requestSummaryMuted">Customer</span>}
          </div>
        </div>

        <div style={styles.infoCard}>
          <div style={styles.label}>Email Subject</div>
          <div style={styles.value}>{replyInfo?.subject || "Customer email reply"}</div>
        </div>
      </div>

      {bodyPreview ? (
        <div style={styles.replyBox}>
          <div style={styles.label}>Customer Reply Preview</div>
          <div className="emailDraftPreview markdown-body">
            <MarkdownRenderer text={bodyPreview} />
          </div>
        </div>
      ) : null}

      <div style={styles.footer}>
        <div>
          <div style={styles.hintTitle}>Next step</div>
          <div style={styles.hintText}>
            Review the customer response. If accepted, submit for assessment. If the customer asks for a date, quantity, priority, or detail change, open the request for update and send a revised email.
          </div>
        </div>

        <div style={styles.actionWrap}>
          <button
            type="button"
            style={styles.secondaryBtn}
            onClick={onRequestChanges}
            disabled={loading}
            title="Open the request form to update date, quantity, priority, or details before resending to the customer."
          >
            Request Changes
          </button>

          <button
            type="button"
            className="formSaveBtn premiumFormSaveBtn"
            onClick={onSubmitForAssessment}
            disabled={loading}
            style={{ minWidth: "190px", minHeight: "48px" }}
          >
            {loading ? "Submitting..." : "Submit for Assessment"}
          </button>
        </div>
      </div>
    </div>
  );
};

/* ===============================
   ✅ Email Draft Helpers + Card
   =============================== */
const looksLikeEmailDraft = (text = "") => {
  if (isEmailSentConfirmationText(text)) return false;
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
    from: CUSTOMER_REQUEST_FROM_EMAIL,
    subject: subject || "Customer Request Update",
    body: body || raw,
  };
};


const isSupplierTaskMessage = (msg = {}) => {
  const artifactType = String(
    msg?.artifact?.type ||
      msg?.supplierTask?.type ||
      msg?.type ||
      ""
  )
    .toLowerCase()
    .trim();

  const text = [
    extractMessageText(msg),
    msg?.text,
    typeof msg?.content === "string" ? msg.content : "",
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();

  return (
    artifactType === "supplier_task" ||
    text.includes("supplier task loaded") ||
    text.includes("please upload the requested document/information")
  );
};

const isSupplierEmailDraft = (draft = {}, text = "") => {
  const joined = [
    draft?.kind,
    draft?.emailKind,
    draft?.type,
    draft?.subject,
    draft?.Subject,
    draft?.body,
    draft?.Body,
    text,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return (
    joined.includes("supplier_fmd_request") ||
    joined.includes("supplier email draft") ||
    joined.includes("📧 supplier email draft")
  );
};

const stripMarkdownLabel = (value = "") =>
  String(value || "")
    .replace(/^\s*[-*•]+\s*/, "")
    .replace(/^\s*\*\*/g, "")
    .replace(/\*\*\s*$/g, "")
    .trim();

const extractMarkdownLabelValue = (text = "", label = "") => {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`^\\s*\\*\\*${escaped}\\s*:\\*\\*\\s*(.+)$`, "im"),
    new RegExp(`^\\s*${escaped}\\s*:\\s*(.+)$`, "im"),
  ];

  for (const pattern of patterns) {
    const match = String(text || "").match(pattern);
    if (match?.[1]) {
      return stripMarkdownLabel(match[1]);
    }
  }

  return "";
};

const parseSupplierEmailDraftFromText = (text = "") => {
  const raw = String(text || "").replace(/\r\n/g, "\n").trim();
  if (!raw || !isSupplierEmailDraft({}, raw)) return null;

  const lower = raw.toLowerCase();
  if (
    lower.includes("supplier task loaded") ||
    lower.includes("please upload the requested document/information")
  ) {
    return null;
  }

  const to = extractMarkdownLabelValue(raw, "To");
  const from = extractMarkdownLabelValue(raw, "From") || CUSTOMER_REQUEST_FROM_EMAIL;
  const subject =
    extractMarkdownLabelValue(raw, "Subject") ||
    "Request for Full Material Disclosure";

  const bodyStartMarkers = [
    "Dear Supplier Team,",
    "For material compliance assessment,",
  ];

  let body = "";
  for (const markerText of bodyStartMarkers) {
    const idx = raw.indexOf(markerText);
    if (idx >= 0) {
      body = raw.slice(idx).trim();
      break;
    }
  }

  if (!body) {
    body = raw
      .replace(/✅\s*\*\*Supplier Task Created\*\*/gi, "")
      .replace(/📧\s*\*\*Supplier Email Draft\*\*/gi, "")
      .replace(/^\s*\*\*To:\*\*.*$/gim, "")
      .replace(/^\s*\*\*From:\*\*.*$/gim, "")
      .replace(/^\s*\*\*Subject:\*\*.*$/gim, "")
      .trim();
  }

  return {
    to,
    from,
    subject,
    body,
    kind: "supplier_fmd_request",
    emailKind: "supplier_fmd_request",
    isSupplierEmail: true,
  };
};

const normalizeEmailDraft = (msg = {}, text = "", fallbackTo = "") => {
  if (isSupplierTaskMessage(msg)) {
    return null;
  }

  const directDraft =
    msg?.emailDraft ||
    msg?.EmailDraft ||
    msg?.artifact?.emailDraft ||
    msg?.artifact?.EmailDraft ||
    null;

  const artifact = msg?.artifact || null;

  // Supplier email sent confirmation is not an email draft.
  // Render it as a simple chat message, not inside the Supplier Email Draft card.
  const artifactType = String(
    artifact?.type ||
      artifact?.artifactType ||
      msg?.type ||
      msg?.artifactType ||
      ""
  )
    .toLowerCase()
    .trim();

  if (artifactType === "supplier_email_sent") {
    return null;
  }

  const supplierDraftFromText = parseSupplierEmailDraftFromText(text);

  const draftKind =
    directDraft?.kind ||
    directDraft?.emailKind ||
    artifact?.kind ||
    artifact?.emailKind ||
    artifact?.type ||
    supplierDraftFromText?.kind ||
    "";

  const subject =
    directDraft?.subject ||
    directDraft?.Subject ||
    artifact?.subject ||
    artifact?.Subject ||
    supplierDraftFromText?.subject ||
    "";

  const body =
    directDraft?.body ||
    directDraft?.Body ||
    artifact?.body ||
    artifact?.Body ||
    supplierDraftFromText?.body ||
    "";

  const to = String(
    directDraft?.to ||
      directDraft?.To ||
      directDraft?.toEmail ||
      directDraft?.ToEmail ||
      artifact?.to ||
      artifact?.To ||
      artifact?.toEmail ||
      artifact?.ToEmail ||
      supplierDraftFromText?.to ||
      msg?.toEmail ||
      msg?.ToEmail ||
      msg?.to ||
      msg?.To ||
      ""
  ).trim();

  const from = String(
    directDraft?.from ||
      directDraft?.From ||
      artifact?.from ||
      artifact?.From ||
      supplierDraftFromText?.from ||
      CUSTOMER_REQUEST_FROM_EMAIL
  ).trim();

  const isSupplier =
    Boolean(directDraft?.isSupplierEmail) ||
    Boolean(artifact?.isSupplierEmail) ||
    isSupplierEmailDraft(directDraft || artifact || {}, text) ||
    Boolean(supplierDraftFromText);

  if (subject || body || to || supplierDraftFromText) {
    return {
      to,
      from,
      subject: subject || (isSupplier ? "Request for Full Material Disclosure" : "Customer Request Update"),
      body:
        body ||
        String(text || "")
          .replace(/^subject\s*:.*?(\n\n|$)/is, "")
          .trim(),
      kind: isSupplier ? "supplier_fmd_request" : draftKind || "customer_request_email",
      emailKind: isSupplier ? "supplier_fmd_request" : draftKind || "customer_request_email",
      isSupplierEmail: isSupplier,
    };
  }

  if (isEmailSentConfirmationText(text || '')) {


    return <EmailSentConfirmationCard text={text || ''} />;


  }


  if (looksLikeEmailDraft(text)) {
    return parseEmailDraftFromText(text, to);
  }

  return null;
};

const normalizeSupplierTask = (msg = {}) => {
  const text = String(extractMessageText(msg) || msg?.text || "");
  const directDraft =
    msg?.emailDraft ||
    msg?.EmailDraft ||
    msg?.artifact?.emailDraft ||
    msg?.artifact?.EmailDraft ||
    null;
  const artifact = msg?.artifact || null;

  // Important: supplier email drafts can contain TaskId / supplier metadata.
  // They must render as EmailDraftCard, not as Engineer Supplier Review cards.
  if (
    isSupplierEmailDraft(directDraft || artifact || {}, text) ||
    String(
      directDraft?.emailKind ||
        directDraft?.kind ||
        artifact?.emailKind ||
        artifact?.kind ||
        ""
    )
      .toLowerCase()
      .includes("supplier_fmd_request")
  ) {
    return null;
  }

  const rootArtifact = msg?.supplierTask || msg?.artifact?.supplierTask || msg?.artifact?.task || msg?.artifact || msg || {};
  const taskItem =
    rootArtifact?.taskItem ||
    rootArtifact?.TaskItem ||
    rootArtifact?.item ||
    rootArtifact?.Item ||
    rootArtifact?.task ||
    rootArtifact?.Task ||
    msg?.taskItem ||
    msg?.TaskItem ||
    {};

  const detail =
    taskItem?.TaskDetail ||
    taskItem?.taskDetail ||
    taskItem?.TaskDetails ||
    taskItem?.taskDetails ||
    rootArtifact?.TaskDetail ||
    rootArtifact?.taskDetail ||
    {};

  const artifactType = String(
    rootArtifact?.type ||
      rootArtifact?.artifactType ||
      taskItem?.type ||
      taskItem?.Type ||
      ""
  )
    .toLowerCase()
    .trim();

  const hasTaskId = Boolean(
    rootArtifact?.taskId ||
      rootArtifact?.TaskId ||
      taskItem?.TaskId ||
      taskItem?.taskId ||
      msg?.taskId ||
      msg?.TaskId
  );

  if (!isSupplierTaskMessage(msg) && artifactType !== "supplier_task" && !hasTaskId) {
    return null;
  }

  const pickFromText = (label) => {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [
      new RegExp(`\\*\\*${escaped}:\\*\\*\\s*([^\\n]+)`, "i"),
      new RegExp(`${escaped}\\s*:\\s*([^\\n]+)`, "i"),
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match?.[1]) return match[1].trim();
    }
    return "";
  };

  const missing =
    rootArtifact?.missingInformation ||
    rootArtifact?.MissingInformation ||
    detail?.MissingInformation ||
    detail?.missingInformation ||
    detail?.RequestedInformation ||
    detail?.requestedInformation ||
    [];

  const missingInformation = Array.isArray(missing)
    ? missing.filter(Boolean)
    : missing
    ? [missing]
    : [];

  const assignedFor =
    rootArtifact?.assignedFor ||
    rootArtifact?.TaskAssignedFor ||
    taskItem?.TaskAssignedFor ||
    taskItem?.assignedFor ||
    pickFromText("Customer / Part") ||
    pickFromText("Part") ||
    "";

  const uploadedDocuments = normalizeSupplierUploadedDocuments({
    ...rootArtifact,
    taskItem,
    TaskDetail: detail,
  });

  return {
    taskId:
      rootArtifact?.taskId ||
      rootArtifact?.TaskId ||
      taskItem?.TaskId ||
      taskItem?.taskId ||
      pickFromText("Task ID") ||
      msg?.taskId ||
      msg?.TaskId ||
      "",
    taskName:
      rootArtifact?.taskName ||
      rootArtifact?.TaskName ||
      detail?.TaskName ||
      detail?.taskName ||
      pickFromText("Task") ||
      "Request for Material Disclosure",
    taskStatus:
      rootArtifact?.taskStatus ||
      rootArtifact?.TaskStatus ||
      taskItem?.TaskStatus ||
      taskItem?.taskStatus ||
      pickFromText("Status") ||
      "CREATE",
    taskPriority:
      rootArtifact?.taskPriority ||
      rootArtifact?.TaskPriority ||
      taskItem?.TaskPriority ||
      taskItem?.taskPriority ||
      pickFromText("Priority") ||
      "MEDIUM",
    taskType:
      rootArtifact?.taskType ||
      rootArtifact?.TaskType ||
      taskItem?.TaskType ||
      taskItem?.taskType ||
      pickFromText("Task Type") ||
      "Supplier Request",
    requestId:
      rootArtifact?.requestId ||
      rootArtifact?.RequestId ||
      rootArtifact?.assignedBy ||
      rootArtifact?.TaskAssignedBy ||
      detail?.RequestId ||
      detail?.requestId ||
      taskItem?.TaskAssignedBy ||
      taskItem?.assignedBy ||
      pickFromText("Assigned By Request") ||
      pickFromText("Related Request ID") ||
      "",
    assignedTo:
      rootArtifact?.assignedTo ||
      rootArtifact?.TaskAssignedTo ||
      taskItem?.TaskAssignedTo ||
      taskItem?.assignedTo ||
      pickFromText("Assigned To") ||
      "",
    assignedFor,
    componentPart:
      rootArtifact?.componentPart ||
      rootArtifact?.componentPartKey ||
      detail?.CustomerPartKey ||
      detail?.CustomerPart ||
      assignedFor,
    uploadUrl:
      rootArtifact?.supplierPortalUrl ||
      rootArtifact?.SupplierPortalUrl ||
      detail?.SupplierPortalUrl ||
      detail?.supplierPortalUrl ||
      pickFromText("Upload URL") ||
      "http://localhost:5173",
    description:
      rootArtifact?.taskDescription ||
      rootArtifact?.TaskDescription ||
      detail?.TaskDescription ||
      detail?.taskDescription ||
      pickFromText("Description") ||
      "",
    uploadedDocuments,
    additionalInformation:
      rootArtifact?.additionalInformation ||
      rootArtifact?.supplierAdditionalInformation ||
      detail?.AdditionalInformation ||
      detail?.SupplierAdditionalInformation ||
      taskItem?.AdditionalInformation ||
      taskItem?.SupplierAdditionalInformation ||
      "",
    taskItem,
    missingInformation,
  };
};

const getUserProfileValue = (user = {}) => {
  const raw = String(
    user?.profile ||
      user?.Profile ||
      user?.role ||
      user?.Role ||
      user?.userProfile ||
      user?.UserProfile ||
      user?.profileType ||
      user?.ProfileType ||
      user?.attributes?.profile ||
      user?.attributes?.["custom:profile"] ||
      user?.signInDetails?.loginProfile ||
      ""
  )
    .trim()
    .toLowerCase();

  if (
    raw.includes("engineer") ||
    raw.includes("engineering") ||
    raw.includes("internal")
  ) {
    return "engineering";
  }

  if (raw.includes("supplier")) return "supplier";
  if (raw.includes("customer")) return "customer";

  return raw;
};

const isEngineeringProfileUser = (user = {}) =>
  getUserProfileValue(user) === "engineering";

const SUPPLIER_UPLOAD_ARRAY_KEYS = new Set([
  "uploadedDocuments",
  "UploadedDocuments",
  "supplierUploadedDocuments",
  "SupplierUploadedDocuments",
  "supplierUploads",
  "SupplierUploads",
  "supplierUploadedFiles",
  "SupplierUploadedFiles",
  "uploadedFiles",
  "UploadedFiles",
  "files",
  "Files",
  "documents",
  "Documents",
  "attachments",
  "Attachments",
]);

const looksLikeSupplierUploadDoc = (value) => {
  if (!value) return false;
  if (typeof value === "string") return /\.(pdf|png|jpe?g|webp|gif|docx?|xlsx?|csv|txt|zip|pptx?)$/i.test(value);
  if (typeof value !== "object") return false;

  return Boolean(
    value?.s3Key ||
      value?.S3Key ||
      value?.key ||
      value?.Key ||
      value?.fileName ||
      value?.FileName ||
      value?.name ||
      value?.Name ||
      value?.originalFileName ||
      value?.OriginalFileName ||
      value?.downloadUrl ||
      value?.DownloadUrl
  );
};

const collectSupplierUploadArrays = (source, depth = 0, seen = new Set()) => {
  if (!source || depth > 6) return [];

  if (Array.isArray(source)) {
    if (source.some(looksLikeSupplierUploadDoc)) return [source];
    return source.flatMap((item) => collectSupplierUploadArrays(item, depth + 1, seen));
  }

  if (typeof source !== "object") return [];
  if (seen.has(source)) return [];
  seen.add(source);

  const arrays = [];
  for (const [key, value] of Object.entries(source)) {
    if (Array.isArray(value) && SUPPLIER_UPLOAD_ARRAY_KEYS.has(key) && value.some(looksLikeSupplierUploadDoc)) {
      arrays.push(value);
      continue;
    }

    if (Array.isArray(value) && value.some(looksLikeSupplierUploadDoc)) {
      const keyLooksRelated = /upload|document|file|attachment/i.test(key);
      if (keyLooksRelated) {
        arrays.push(value);
        continue;
      }
    }

    if (value && typeof value === "object") {
      arrays.push(...collectSupplierUploadArrays(value, depth + 1, seen));
    }
  }

  return arrays;
};

const normalizeSupplierUploadedDocuments = (task = {}) => {
  const taskItem =
    task?.taskItem ||
    task?.TaskItem ||
    task?.item ||
    task?.Item ||
    task?.task ||
    task?.Task ||
    {};

  const detail =
    taskItem?.TaskDetail ||
    taskItem?.taskDetail ||
    taskItem?.TaskDetails ||
    taskItem?.taskDetails ||
    task?.TaskDetail ||
    task?.taskDetail ||
    task?.TaskDetails ||
    task?.taskDetails ||
    {};

  const directCandidates = [
    task?.uploadedDocuments,
    task?.UploadedDocuments,
    task?.supplierUploadedDocuments,
    task?.SupplierUploadedDocuments,
    task?.supplierUploads,
    task?.SupplierUploads,
    task?.supplierUploadedFiles,
    task?.SupplierUploadedFiles,
    task?.uploadedFiles,
    task?.UploadedFiles,
    task?.documents,
    task?.Documents,
    task?.attachments,
    task?.Attachments,
    detail?.UploadedDocuments,
    detail?.SupplierUploadedDocuments,
    detail?.SupplierUploads,
    detail?.SupplierUploadedFiles,
    detail?.UploadedFiles,
    detail?.Documents,
    detail?.Attachments,
    taskItem?.UploadedDocuments,
    taskItem?.SupplierUploadedDocuments,
    taskItem?.SupplierUploads,
    taskItem?.SupplierUploadedFiles,
    taskItem?.UploadedFiles,
    taskItem?.Documents,
    taskItem?.Attachments,
  ].filter(Boolean);

  const discoveredArrays = collectSupplierUploadArrays({ task, taskItem, detail });

  const rawList = [...directCandidates, ...discoveredArrays].flatMap((raw) => {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    return [raw];
  });

  const seenDocs = new Set();

  return rawList
    .filter(Boolean)
    .map((doc, index) => {
      if (typeof doc === "string") {
        return {
          uploadId: `supplier-upload-${index + 1}`,
          fileName: doc,
          uploadedBy: "",
          uploadedAt: "",
          s3Key: "",
          s3Bucket: "",
          downloadUrl: "",
          fileType: "application/octet-stream",
          fileSize: "",
          supplierNote: "",
          fileDescription: "",
          taskId: task?.taskId || task?.TaskId || taskItem?.TaskId || "",
          requestId: task?.requestId || task?.RequestId || detail?.RequestId || taskItem?.TaskAssignedBy || "",
          index,
        };
      }

      const supplierNote = String(
        doc?.supplierNote ||
          doc?.SupplierNote ||
          doc?.fileDescription ||
          doc?.FileDescription ||
          doc?.description ||
          doc?.Description ||
          doc?.note ||
          doc?.Note ||
          doc?.comment ||
          doc?.Comment ||
          doc?.additionalInformation ||
          doc?.AdditionalInformation ||
          doc?.supplierAdditionalInformation ||
          doc?.SupplierAdditionalInformation ||
          ""
      ).trim();

      return {
        uploadId:
          doc?.uploadId ||
          doc?.UploadId ||
          doc?.id ||
          doc?.Id ||
          `supplier-upload-${index + 1}`,
        fileName:
          doc?.fileName ||
          doc?.FileName ||
          doc?.name ||
          doc?.Name ||
          doc?.originalFileName ||
          doc?.OriginalFileName ||
          doc?.documentName ||
          doc?.DocumentName ||
          doc?.attachmentName ||
          doc?.AttachmentName ||
          `Supplier document ${index + 1}`,
        uploadedBy:
          doc?.uploadedBy ||
          doc?.UploadedBy ||
          doc?.supplierEmail ||
          doc?.SupplierEmail ||
          doc?.uploadedByEmail ||
          doc?.UploadedByEmail ||
          "",
        uploadedAt:
          doc?.uploadedAt ||
          doc?.UploadedAt ||
          doc?.createdAt ||
          doc?.CreatedAt ||
          doc?.submittedAt ||
          doc?.SubmittedAt ||
          "",
        s3Key:
          doc?.s3Key ||
          doc?.S3Key ||
          doc?.key ||
          doc?.Key ||
          doc?.s3ObjectKey ||
          doc?.S3ObjectKey ||
          doc?.objectKey ||
          doc?.ObjectKey ||
          "",
        s3Bucket: doc?.s3Bucket || doc?.S3Bucket || doc?.bucket || doc?.Bucket || "",
        downloadUrl:
          doc?.downloadUrl ||
          doc?.DownloadUrl ||
          doc?.url ||
          doc?.Url ||
          doc?.presignedUrl ||
          doc?.PresignedUrl ||
          "",
        fileType:
          doc?.fileType ||
          doc?.FileType ||
          doc?.mimeType ||
          doc?.MimeType ||
          doc?.contentType ||
          doc?.ContentType ||
          "application/octet-stream",
        fileSize:
          doc?.fileSize ||
          doc?.FileSize ||
          doc?.size ||
          doc?.Size ||
          doc?.sizeBytes ||
          doc?.SizeBytes ||
          "",
        supplierNote,
        fileDescription: supplierNote,
        taskId: doc?.taskId || doc?.TaskId || task?.taskId || task?.TaskId || taskItem?.TaskId || "",
        requestId:
          doc?.requestId ||
          doc?.RequestId ||
          task?.requestId ||
          task?.RequestId ||
          detail?.RequestId ||
          detail?.requestId ||
          taskItem?.TaskAssignedBy ||
          "",
        index,
      };
    })
    .filter((doc) => {
      const key = `${String(doc.s3Key || "").trim()}|${String(doc.fileName || "").trim()}|${String(doc.uploadedAt || "").trim()}`;
      if (seenDocs.has(key)) return false;
      seenDocs.add(key);
      return Boolean(doc.fileName || doc.s3Key || doc.downloadUrl);
    });
};

const normalizeSupplierAdditionalInfo = (task = {}) => {
  const taskItem = task?.taskItem || {};
  const detail = taskItem?.TaskDetail || taskItem?.taskDetail || {};

  const raw =
    task?.additionalInformation ||
    task?.supplierAdditionalInformation ||
    task?.supplierNotes ||
    detail?.AdditionalInformation ||
    detail?.SupplierAdditionalInformation ||
    detail?.SupplierNotes ||
    taskItem?.AdditionalInformation ||
    taskItem?.SupplierAdditionalInformation ||
    taskItem?.SupplierNotes ||
    "";

  if (Array.isArray(raw)) return raw.filter(Boolean).map((x) => String(x));
  if (raw && typeof raw === "object") return [JSON.stringify(raw, null, 2)];
  if (raw) return [String(raw)];
  return [];
};

const SupplierTaskUploadCard = ({ task, user, sessionId, onUploadComplete, onSubmitComplete }) => {
  const uploadInputRef = useRef(null);
  const [selectedUploads, setSelectedUploads] = useState([]);
  const [submitMessage, setSubmitMessage] = useState("");
  const [uploadingSupplierFiles, setUploadingSupplierFiles] = useState(false);
  const [submittingReview, setSubmittingReview] = useState(false);

  if (!task) return null;

  const missingItems = Array.isArray(task.missingInformation)
    ? task.missingInformation.filter(Boolean)
    : [];

  const componentLabel =
    task.componentPart ||
    task.componentPartKey ||
    task.assignedFor ||
    task.taskName ||
    "-";

  const existingUploads = normalizeSupplierUploadedDocuments(task);

  const handleChooseFiles = (event) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;

    const nextUploads = files.map((file) => ({
      localId: `${file.name}-${file.size}-${file.lastModified}-${Math.random()
        .toString(16)
        .slice(2)}`,
      file,
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type || "Unknown",
      supplierNote: "",
    }));

    setSelectedUploads((prev) => [...prev, ...nextUploads]);
    setSubmitMessage("");
    event.target.value = "";
  };

  const updateUploadNote = (localId, note) => {
    setSelectedUploads((prev) =>
      prev.map((item) =>
        item.localId === localId ? { ...item, supplierNote: note } : item
      )
    );
  };

  const removeSelectedUpload = (localId) => {
    setSelectedUploads((prev) => prev.filter((item) => item.localId !== localId));
    setSubmitMessage("");
  };

  const formatFileSize = (size = 0) => {
    const value = Number(size || 0);
    if (!value) return "";
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleSubmitForReview = async () => {
    if (!selectedUploads.length && !existingUploads.length) {
      setSubmitMessage("Please add at least one document before submitting for review.");
      return;
    }

    const taskId = String(task?.taskId || "").trim();
    const requestId = String(task?.requestId || task?.assignedBy || "").trim();
    const activeSessionId = String(sessionId || taskId || "").trim();
    const userEmail = String(user?.email || "").trim();

    if (!taskId || !requestId || !activeSessionId || !userEmail) {
      setSubmitMessage("Missing Task ID, Request ID, Session ID, or user email.");
      return;
    }

    try {
      setUploadingSupplierFiles(true);
      setSubmittingReview(true);
      setSubmitMessage("Uploading supplier document(s)...");

      const token = await getAccessToken();

      const uploadedFiles = [];

      for (const item of selectedUploads) {
        const uploaded = await uploadSupplierTaskFile(
          {
            taskId,
            requestId,
            sessionId: activeSessionId,
            userId: userEmail,
            file: item.file,
            supplierNote: item.supplierNote || "",
            supplierFileDescription: item.supplierNote || "",
          },
          token
        );

        uploadedFiles.push(uploaded);
      }

      setSubmitMessage("Submitting supplier task for engineering review...");

      const submitRes = await submitSupplierTaskForReview(
        {
          taskId,
          requestId,
          sessionId: activeSessionId,
          userId: userEmail,
          supplierAdditionalInformation: "",
          uploadedFiles,
        },
        token
      );

      setSelectedUploads([]);
      setSubmitMessage("✅ Submitted for engineering review.");
      onSubmitComplete?.(submitRes);
      onUploadComplete?.(submitRes);
    } catch (e) {
      console.error("Supplier task submit failed:", e);
      setSubmitMessage(`❌ ${e?.message || "Supplier task upload failed"}`);
    } finally {
      setUploadingSupplierFiles(false);
      setSubmittingReview(false);
    }
  };

  return (
    <div
      className="emailDraftShell premiumEmailDraft supplierTaskCard"
      style={{
        position: "relative",
        overflow: "hidden",
        borderRadius: "24px",
        border: "1px solid rgba(13, 148, 136, 0.22)",
        background:
          "linear-gradient(145deg, rgba(255,255,255,0.99), rgba(248,250,252,0.96))",
        boxShadow:
          "0 24px 70px rgba(15, 23, 42, 0.12), inset 0 1px 0 rgba(255,255,255,0.9)",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: "0 auto 0 0",
          width: "6px",
          background: "linear-gradient(135deg, #0f766e, #2563eb)",
        }}
      />

      <div className="emailDraftHeader">
        <div>
          <div className="emailDraftEyebrow">Supplier Task</div>
          <div className="emailDraftTitle">Upload requested FMD information</div>
          <div
            style={{
              marginTop: "8px",
              color: "#64748b",
              fontSize: "13px",
              lineHeight: 1.45,
            }}
          >
            Add one or more documents. Each document can have its own supplier note, description, or clarification for engineering review.
          </div>
        </div>

        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", justifyContent: "flex-end" }}>
          <span
            style={{
              alignSelf: "center",
              borderRadius: "999px",
              padding: "8px 12px",
              fontSize: "11px",
              fontWeight: 800,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "#0f766e",
              background: "rgba(240, 253, 250, 0.96)",
              border: "1px solid rgba(20, 184, 166, 0.25)",
              whiteSpace: "nowrap",
            }}
          >
            {task.taskStatus || "CREATE"}
          </span>

          <span
            style={{
              alignSelf: "center",
              borderRadius: "999px",
              padding: "8px 12px",
              fontSize: "11px",
              fontWeight: 800,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "#3730a3",
              background: "rgba(238, 242, 255, 0.96)",
              border: "1px solid rgba(99, 102, 241, 0.2)",
              whiteSpace: "nowrap",
            }}
          >
            {task.taskType || "Supplier Request"}
          </span>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: "12px",
          margin: "16px 0",
        }}
      >
        {[
          ["Task ID", task.taskId || "-"],
          ["Priority", task.taskPriority || "-"],
          ["Component / Part", componentLabel],
          ["Task Status", task.taskStatus || "CREATE"],
        ].map(([label, value]) => (
          <div
            key={label}
            style={{
              borderRadius: "16px",
              border: "1px solid #e2e8f0",
              background: "rgba(255,255,255,0.82)",
              padding: "13px 14px",
              minWidth: 0,
            }}
          >
            <div
              style={{
                fontSize: "11px",
                fontWeight: 800,
                color: "#64748b",
                letterSpacing: "0.09em",
                textTransform: "uppercase",
                marginBottom: "6px",
              }}
            >
              {label}
            </div>
            <div style={{ fontSize: "14px", fontWeight: 750, color: "#0f172a", wordBreak: "break-word" }}>
              {value}
            </div>
          </div>
        ))}
      </div>

      <div className="emailDraftBodyCard">
        <div className="emailDraftPreview markdown-body">
          <p><strong>Task:</strong> {task.taskName || "Request for Material Disclosure"}</p>

          <p><strong>Requested Information:</strong></p>
          {missingItems.length ? (
            <ul>
              {missingItems.map((item, index) => (
                <li key={`${item}-${index}`}>{String(item)}</li>
              ))}
            </ul>
          ) : (
            <p>Full Material Disclosure document</p>
          )}

          <p><strong>Description:</strong> {task.description || "-"}</p>

          <p>
            <strong>Upload URL:</strong>{" "}
            <a href={task.uploadUrl} target="_blank" rel="noreferrer">
              {task.uploadUrl}
            </a>
          </p>

          <div
            style={{
              marginTop: "18px",
              borderTop: "1px solid #e2e8f0",
              paddingTop: "16px",
            }}
          >
            <p><strong>Documents to upload</strong></p>
            <input
              ref={uploadInputRef}
              type="file"
              multiple
              onChange={handleChooseFiles}
              style={{ display: "none" }}
            />

            <div style={{ display: "grid", gap: "12px" }}>
              {existingUploads.map((doc, index) => (
                <div
                  key={doc.uploadId || `${doc.fileName}-${index}`}
                  style={{
                    border: "1px solid #dbeafe",
                    borderRadius: "16px",
                    padding: "13px",
                    background: "#f8fbff",
                  }}
                >
                  <div style={{ fontWeight: 850, color: "#0f172a" }}>
                    {index + 1}. {doc.fileName}
                  </div>
                  <div style={{ color: "#64748b", fontSize: "12px", marginTop: "4px" }}>
                    Already uploaded {doc.uploadedAt ? `• ${doc.uploadedAt}` : ""}
                  </div>
                  {doc.supplierNote ? (
                    <div style={{ marginTop: "8px", color: "#334155", fontSize: "13px" }}>
                      <strong>Supplier note:</strong> {doc.supplierNote}
                    </div>
                  ) : null}
                </div>
              ))}

              {selectedUploads.map((item, index) => (
                <div
                  key={item.localId}
                  style={{
                    border: "1px solid #e2e8f0",
                    borderRadius: "16px",
                    padding: "13px",
                    background: "#fff",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "flex-start" }}>
                    <div>
                      <div style={{ fontWeight: 850, color: "#0f172a" }}>
                        {existingUploads.length + index + 1}. {item.fileName}
                      </div>
                      <div style={{ color: "#64748b", fontSize: "12px", marginTop: "4px" }}>
                        {item.fileType || "File"}{formatFileSize(item.fileSize) ? ` • ${formatFileSize(item.fileSize)}` : ""}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="premiumGhostBtn"
                      onClick={() => removeSelectedUpload(item.localId)}
                      style={{ minHeight: "34px", padding: "7px 10px" }}
                    >
                      Remove
                    </button>
                  </div>

                  <label
                    style={{
                      display: "block",
                      marginTop: "12px",
                      fontSize: "11px",
                      fontWeight: 850,
                      color: "#64748b",
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                    }}
                  >
                    Information / description for this file
                  </label>
                  <textarea
                    value={item.supplierNote}
                    onChange={(e) => updateUploadNote(item.localId, e.target.value)}
                    placeholder="Example: Full material disclosure for this component, material breakdown, certificate details, or clarification for engineering."
                    rows={3}
                    style={{
                      width: "100%",
                      marginTop: "7px",
                      borderRadius: "12px",
                      border: "1px solid #dbe3f0",
                      padding: "10px 12px",
                      outline: "none",
                      resize: "vertical",
                      fontSize: "13px",
                    }}
                  />
                </div>
              ))}

              {!existingUploads.length && !selectedUploads.length ? (
                <div
                  style={{
                    border: "1px dashed #cbd5e1",
                    borderRadius: "16px",
                    padding: "16px",
                    background: "#f8fafc",
                    color: "#64748b",
                  }}
                >
                  No documents selected yet. You can add multiple files, and each file can include its own information note.
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <div className="emailDraftFooter">
        <div className="emailDraftFooterHint">
          Customer details are intentionally hidden from the supplier. Each uploaded file will be saved with its own note for engineer review.
          {submitMessage ? <div className="formSaveMsg" style={{ marginTop: "8px" }}>{submitMessage}</div> : null}
        </div>

        <div className="emailDraftFooterActions">
          <button
            type="button"
            className="premiumGhostBtn"
            onClick={() => uploadInputRef.current?.click()}
            disabled={uploadingSupplierFiles || submittingReview}
          >
            Add Document
          </button>
          <button
            type="button"
            className="formSaveBtn premiumFormSaveBtn"
            onClick={handleSubmitForReview}
            disabled={
              uploadingSupplierFiles ||
              submittingReview ||
              (!selectedUploads.length && !existingUploads.length)
            }
          >
            {submittingReview ? "Submitting..." : uploadingSupplierFiles ? "Uploading..." : "Submit for Review"}
          </button>
        </div>
      </div>
    </div>
  );
};

const EngineerSupplierTaskReviewCard = ({ task, user, sessionId, reviewMarkdownOverride = "" }) => {
  if (!task) return null;

  const uploadedDocuments = normalizeSupplierUploadedDocuments(task);
  const missingItems = Array.isArray(task.missingInformation)
    ? task.missingInformation.filter(Boolean)
    : [];

  const componentLabel =
    task.componentPart ||
    task.componentPartKey ||
    task.assignedFor ||
    task.taskName ||
    "-";

  const status = String(task.taskStatus || "CREATE").toUpperCase();
  const isReadyForReview = ["REVIEW", "INREVIEW", "IN-PROGRESS", "INPROGRESS"].includes(status);
  const cleanReviewMarkdownOverride = String(reviewMarkdownOverride || "").trim();

  const getSupplierDocumentDownloadUrl = async (doc) => {
    const taskId = String(task?.taskId || doc?.taskId || "").trim();
    const requestId = String(task?.requestId || task?.assignedBy || doc?.requestId || "").trim();
    const activeSessionId = String(sessionId || taskId || "").trim();
    const userEmail = String(user?.email || "").trim();
    const fileName = doc?.fileName || "supplier-document";
    const fileType = doc?.fileType || "application/octet-stream";
    const s3Key = String(doc?.s3Key || "").trim();

    if (doc?.downloadUrl) return doc.downloadUrl;

    if (!s3Key) {
      throw new Error("No S3 key found for this supplier document.");
    }

    const token = await getAccessToken();

    try {
      const res = await downloadSupplierTaskFile(
        {
          taskId,
          requestId,
          sessionId: activeSessionId,
          userId: userEmail,
          fileName,
          s3Key,
          fileType,
        },
        token
      );

      const supplierUrl =
        (typeof res === "string" ? res : "") ||
        res?.downloadUrl ||
        res?.url ||
        res?.presignedUrl ||
        res?.data?.downloadUrl ||
        res?.payload?.downloadUrl ||
        "";

      if (supplierUrl) return supplierUrl;
    } catch (supplierErr) {
      console.warn("Supplier download endpoint failed, trying generic presign-download:", supplierErr);
    }

    const fallbackRes = await downloadFilePresigned(
      {
        userId: userEmail,
        sessionId: activeSessionId,
        fileName,
        fileType,
        s3Key,
      },
      token
    );

    const fallbackUrl =
      fallbackRes?.downloadUrl ||
      fallbackRes?.url ||
      fallbackRes?.presignedUrl ||
      fallbackRes?.data?.downloadUrl ||
      fallbackRes?.payload?.downloadUrl ||
      "";

    if (!fallbackUrl) {
      throw new Error("No download URL returned for supplier document.");
    }

    return fallbackUrl;
  };

  const handlePreviewSupplierDocument = async (doc) => {
    try {
      const url = await getSupplierDocumentDownloadUrl(doc);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      console.error("Supplier document preview failed:", e);
      alert(e?.message || "Preview failed");
    }
  };

  const handleDownloadSupplierDocument = async (doc) => {
    try {
      const url = await getSupplierDocumentDownloadUrl(doc);
      const fileName = doc?.fileName || "supplier-document";
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      console.error("Supplier document download failed:", e);
      alert(e?.message || "Download failed");
    }
  };

  return (
    <div
      className="emailDraftShell premiumEmailDraft engineerSupplierReviewCard"
      style={{
        position: "relative",
        overflow: "hidden",
        borderRadius: "24px",
        border: "1px solid rgba(99, 102, 241, 0.22)",
        background:
          "linear-gradient(145deg, rgba(255,255,255,0.99), rgba(248,250,255,0.96))",
        boxShadow:
          "0 24px 70px rgba(15, 23, 42, 0.12), inset 0 1px 0 rgba(255,255,255,0.9)",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: "0 auto 0 0",
          width: "6px",
          background: "linear-gradient(135deg, #4f46e5, #0ea5e9)",
        }}
      />

      <div className="emailDraftHeader">
        <div>
          <div className="emailDraftEyebrow">Engineer Supplier Review</div>
          <div className="emailDraftTitle">Review supplier uploaded information</div>
          <div
            style={{
              marginTop: "8px",
              color: "#64748b",
              fontSize: "13px",
              lineHeight: 1.45,
            }}
          >
            Supplier uploaded documents are ready for engineering review.
          </div>
        </div>

        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", justifyContent: "flex-end" }}>
          <span
            style={{
              alignSelf: "center",
              borderRadius: "999px",
              padding: "8px 12px",
              fontSize: "11px",
              fontWeight: 800,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: isReadyForReview ? "#047857" : "#92400e",
              background: isReadyForReview ? "rgba(236, 253, 245, 0.96)" : "rgba(255, 251, 235, 0.96)",
              border: isReadyForReview ? "1px solid rgba(16, 185, 129, 0.25)" : "1px solid rgba(245, 158, 11, 0.25)",
              whiteSpace: "nowrap",
            }}
          >
            {task.taskStatus || "CREATE"}
          </span>

          <span
            style={{
              alignSelf: "center",
              borderRadius: "999px",
              padding: "8px 12px",
              fontSize: "11px",
              fontWeight: 800,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "#3730a3",
              background: "rgba(238, 242, 255, 0.96)",
              border: "1px solid rgba(99, 102, 241, 0.2)",
              whiteSpace: "nowrap",
            }}
          >
            {task.taskType || "Supplier Request"}
          </span>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: "12px",
          margin: "16px 0",
        }}
      >
        {[
          ["Task ID", task.taskId || "-"],
          ["Related Request ID", task.requestId || "-"],
          ["Component / Part", componentLabel],
          ["Priority", task.taskPriority || "-"],
        ].map(([label, value]) => (
          <div
            key={label}
            style={{
              borderRadius: "16px",
              border: "1px solid #e2e8f0",
              background: "rgba(255,255,255,0.82)",
              padding: "13px 14px",
              minWidth: 0,
            }}
          >
            <div
              style={{
                fontSize: "11px",
                fontWeight: 800,
                color: "#64748b",
                letterSpacing: "0.09em",
                textTransform: "uppercase",
                marginBottom: "6px",
              }}
            >
              {label}
            </div>
            <div style={{ fontSize: "14px", fontWeight: 750, color: "#0f172a", wordBreak: "break-word" }}>
              {value}
            </div>
          </div>
        ))}
      </div>

      <div className="emailDraftBodyCard">
        {cleanReviewMarkdownOverride ? (
          <SupplierUploadedDocsMarkdownCard
            text={cleanReviewMarkdownOverride}
            user={user}
            sessionId={sessionId || task.taskId}
          />
        ) : (
          <div className="emailDraftPreview markdown-body">
            <p>
              Here are the supplier uploaded documents for this supplier task:
              <strong> {task.taskId || "-"}</strong>
            </p>

            <h3 style={{ marginTop: "14px" }}>Supplier Task Summary</h3>
            <ul>
              <li><strong>Status:</strong> {task.taskStatus || "CREATE"}</li>
              <li><strong>Priority:</strong> {task.taskPriority || "-"}</li>
              <li><strong>Assigned To:</strong> {task.taskItem?.TaskAssignedTo || task.assignedTo || "Supplier"}</li>
              <li><strong>Part:</strong> {componentLabel}</li>
              <li>
                <strong>Requested Information:</strong>{" "}
                {missingItems.length ? missingItems.join(", ") : "Full Material Disclosure document"}
              </li>
              <li><strong>Uploaded Documents:</strong> {uploadedDocuments.length}</li>
              <li>
                <strong>Next Action:</strong>{" "}
                {uploadedDocuments.length
                  ? "✅ Supplier has uploaded documents. Engineering review is required."
                  : "Waiting for supplier submission."}
              </li>
            </ul>

            <h3 style={{ marginTop: "18px" }}>Supplier uploaded documents</h3>

            {uploadedDocuments.length ? (
              <>
                <ol>
                  {uploadedDocuments.map((doc, index) => (
                    <li key={`${doc.fileName}-${index}`} style={{ marginBottom: "14px" }}>
                      <strong>{doc.fileName}</strong>
                      <ul>
                        {doc.uploadedAt ? <li>Uploaded At: {doc.uploadedAt}</li> : null}
                        <li>Uploaded By: {doc.uploadedBy || "Supplier"}</li>
                        <li>Supplier Note: {doc.supplierNote || "-"}</li>
                      </ul>
                    </li>
                  ))}
                </ol>

                <div
                  style={{
                    marginTop: "18px",
                    borderTop: "1px solid #e2e8f0",
                    paddingTop: "16px",
                    display: "grid",
                    gap: "12px",
                  }}
                >
                  <div
                    style={{
                      fontSize: "13px",
                      fontWeight: 900,
                      color: "#0f172a",
                      letterSpacing: "0.03em",
                    }}
                  >
                    Supplier document actions
                  </div>

                  {uploadedDocuments.map((doc, index) => (
                    <div
                      key={`${doc.s3Key || doc.fileName}-${index}`}
                      style={{
                        border: "1px solid #e2e8f0",
                        borderRadius: "16px",
                        padding: "13px",
                        background: "linear-gradient(180deg, #ffffff, #f8fafc)",
                        display: "flex",
                        justifyContent: "space-between",
                        gap: "14px",
                        alignItems: "center",
                        flexWrap: "wrap",
                      }}
                    >
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontWeight: 900, color: "#0f172a", wordBreak: "break-word" }}>
                          {index + 1}. {doc.fileName}
                        </div>
                        <div style={{ marginTop: "5px", color: "#64748b", fontSize: "12px" }}>
                          {doc.uploadedBy ? `Uploaded by: ${doc.uploadedBy}` : "Uploaded by: Supplier"}
                          {doc.uploadedAt ? ` • ${doc.uploadedAt}` : ""}
                        </div>
                        {doc.supplierNote ? (
                          <div style={{ marginTop: "7px", color: "#334155", fontSize: "13px" }}>
                            <strong>Supplier note:</strong> {doc.supplierNote}
                          </div>
                        ) : null}
                      </div>

                      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", justifyContent: "flex-end" }}>
                        <button
                          type="button"
                          className="premiumGhostBtn"
                          onClick={() => handlePreviewSupplierDocument(doc)}
                          disabled={!doc.downloadUrl && !doc.s3Key}
                          style={{ minHeight: "38px", padding: "8px 12px" }}
                        >
                          Preview
                        </button>

                        <button
                          type="button"
                          className="formSaveBtn premiumFormSaveBtn"
                          onClick={() => handleDownloadSupplierDocument(doc)}
                          disabled={!doc.downloadUrl && !doc.s3Key}
                          style={{ minHeight: "38px", padding: "8px 12px" }}
                        >
                          Download Document
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div
                style={{
                  border: "1px dashed #cbd5e1",
                  borderRadius: "16px",
                  padding: "16px",
                  background: "#f8fafc",
                  color: "#64748b",
                }}
              >
                No supplier documents uploaded yet. Waiting for supplier submission.
              </div>
            )}
          </div>
        )}
      </div>

      <div className="emailDraftFooter">
        <div className="emailDraftFooterHint">
          Engineer can review supplier uploaded documents here. Use Download Document to open the actual file from S3 using a presigned URL.
        </div>

        <div className="emailDraftFooterActions">
          <button type="button" className="premiumGhostBtn">
            Request Changes
          </button>
          <button type="button" className="formSaveBtn premiumFormSaveBtn" disabled={!uploadedDocuments.length}>
            Approve Supplier Submission
          </button>
        </div>
      </div>
    </div>
  );
};

const SupplierTaskCard = ({ task, isEngineerView = false, user, sessionId, reviewMarkdownOverride = "", onUploadComplete, onSubmitComplete }) => {
  if (!task) return null;

  if (isEngineerView) {
    return <EngineerSupplierTaskReviewCard task={task} user={user} sessionId={sessionId} reviewMarkdownOverride={reviewMarkdownOverride} />;
  }

  return <SupplierTaskUploadCard task={task} user={user} sessionId={sessionId} onUploadComplete={onUploadComplete} onSubmitComplete={onSubmitComplete} />;
};


/* ===============================
   ✅ Supplier uploaded documents in chat markdown
   Hides internal S3 key text and shows Preview / Download actions.
   =============================== */
const extractSupplierUploadedDocsFromMarkdown = (text = "") => {
  const value = String(text || "").replace(/\r\n/g, "\n");
  const lines = value.split("\n");
  const docs = [];
  let current = null;

  const taskIdFromText =
    value.match(/Supplier\s+Task\s*:\s*(TSK[A-Z]?#\d{8}#\d{6}-[A-Za-z0-9]+)/i)?.[1] ||
    value.match(/Task\s+ID\s*:\s*(TSK[A-Z]?#\d{8}#\d{6}-[A-Za-z0-9]+)/i)?.[1] ||
    value.match(/\b(TSK[A-Z]?#\d{8}#\d{6}-[A-Za-z0-9]+)\b/i)?.[1] ||
    "";

  const requestIdFromText =
    value.match(/customer\s+request\s+(REQ[A-Z]?#\d{8}#\d{6}-[A-Za-z0-9]+)/i)?.[1] ||
    value.match(/customer\s+request\s*:\s*(REQ[A-Z]?#\d{8}#\d{6}-[A-Za-z0-9]+)/i)?.[1] ||
    value.match(/\b(REQ[A-Z]?#\d{8}#\d{6}-[A-Za-z0-9]+)\b/i)?.[1] ||
    "";

  const startNewDoc = (fileName = "") => {
    if (current) docs.push(current);
    current = {
      fileName: String(fileName || "Supplier document").trim(),
      uploadedAt: "",
      uploadedBy: "",
      supplierNote: "",
      s3Key: "",
      fileType: "application/octet-stream",
      taskId: taskIdFromText,
      requestId: requestIdFromText,
    };
  };

  for (const rawLine of lines) {
    const clean = String(rawLine || "").trim();
    if (!clean) continue;

    const fileMatch =
      clean.match(/^\s*\d+\.\s+\*\*(.+?)\*\*/i) ||
      clean.match(/^\s*\d+\.\s+([^\n]+?\.(?:pdf|png|jpe?g|webp|gif|docx?|xlsx?|csv|txt|zip|pptx?))\s*$/i);

    if (fileMatch?.[1]) {
      startNewDoc(fileMatch[1]);
      continue;
    }

    if (!current) continue;

    const uploadedAt = clean.match(/Uploaded\s+At\s*:\s*(.+)$/i);
    if (uploadedAt?.[1]) {
      current.uploadedAt = uploadedAt[1].replace(/`/g, "").trim();
      continue;
    }

    const uploadedBy = clean.match(/Uploaded\s+By\s*:\s*(.+)$/i);
    if (uploadedBy?.[1]) {
      current.uploadedBy = uploadedBy[1].replace(/`/g, "").trim();
      continue;
    }

    const supplierNote = clean.match(/Supplier\s+Note\s*:\s*(.+)$/i);
    if (supplierNote?.[1]) {
      current.supplierNote = supplierNote[1].replace(/`/g, "").trim();
      continue;
    }

    const s3Key = clean.match(/S3\s+Key\s*:\s*`?([^`]+)`?/i);
    if (s3Key?.[1]) {
      current.s3Key = s3Key[1]
        .replace(/^[-*•]+\s*/, "")
        .replace(/`/g, "")
        .trim();
      continue;
    }
  }

  if (current) docs.push(current);

  return docs.filter((doc) => doc.fileName && doc.s3Key);
};

const removeSupplierS3KeyLinesFromMarkdown = (text = "") => {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => !/S3\s+Key\s*:/i.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

const extractSupplierUploadedDocsFromArtifact = (artifact = {}) => {
  const tasks = Array.isArray(artifact?.supplierTasks)
    ? artifact.supplierTasks
    : Array.isArray(artifact?.SupplierTasks)
    ? artifact.SupplierTasks
    : artifact?.supplierTask
    ? [artifact.supplierTask]
    : artifact?.taskItem
    ? [artifact.taskItem]
    : artifact?.task
    ? [artifact.task]
    : artifact?.type === "supplier_task"
    ? [artifact]
    : [];

  const docs = [];

  for (const task of tasks) {
    const detail = task?.TaskDetail || task?.taskDetail || {};
    const taskId = String(
      task?.TaskId ||
        task?.taskId ||
        artifact?.taskId ||
        artifact?.TaskId ||
        ""
    ).trim();
    const requestId = String(
      detail?.RequestId ||
        detail?.requestId ||
        task?.TaskAssignedBy ||
        task?.assignedBy ||
        task?.RequestId ||
        task?.requestId ||
        artifact?.requestId ||
        artifact?.RequestId ||
        ""
    ).trim();

    normalizeSupplierUploadedDocuments({
      ...(task || {}),
      taskId,
      TaskId: taskId,
      requestId,
      RequestId: requestId,
      taskItem: task,
      TaskDetail: detail,
    }).forEach((doc, index) => {
      docs.push({
        ...doc,
        taskId: doc.taskId || taskId,
        requestId: doc.requestId || requestId,
        index: docs.length + index,
      });
    });
  }

  return docs;
};

const mergeMarkdownDocsWithArtifactDocs = (markdownDocs = [], artifactDocs = []) => {
  if (!artifactDocs.length) return markdownDocs;
  if (!markdownDocs.length) return artifactDocs;

  const used = new Set();

  return markdownDocs.map((doc, index) => {
    const normalizedName = String(doc?.fileName || "").trim().toLowerCase();
    let matchIndex = artifactDocs.findIndex((candidate, candidateIndex) => {
      if (used.has(candidateIndex)) return false;
      return (
        String(candidate?.fileName || "").trim().toLowerCase() === normalizedName
      );
    });

    if (matchIndex < 0 && artifactDocs[index] && !used.has(index)) {
      matchIndex = index;
    }

    if (matchIndex < 0) return doc;

    used.add(matchIndex);
    const match = artifactDocs[matchIndex] || {};

    return {
      ...match,
      ...doc,
      s3Key: doc.s3Key || match.s3Key || match.S3Key || "",
      s3Bucket: doc.s3Bucket || match.s3Bucket || match.S3Bucket || "",
      fileType: doc.fileType || match.fileType || match.FileType || "application/octet-stream",
      fileSize: doc.fileSize || match.fileSize || match.FileSize || "",
      taskId: doc.taskId || match.taskId || match.TaskId || "",
      requestId: doc.requestId || match.requestId || match.RequestId || "",
      downloadUrl: doc.downloadUrl || match.downloadUrl || match.DownloadUrl || "",
    };
  });
};

const hasSupplierUploadedDocsMarkdown = (text = "", artifact = null) => {
  const value = String(text || "");
  const hasSupplierDocsText = /Supplier\s+uploaded\s+documents/i.test(value);
  if (!hasSupplierDocsText) return false;

  const markdownDocs = extractSupplierUploadedDocsFromMarkdown(value);
  const artifactDocs = extractSupplierUploadedDocsFromArtifact(artifact || {});

  return markdownDocs.length > 0 || artifactDocs.length > 0;
};

const SupplierUploadedDocsMarkdownCard = ({ text, artifact, user, sessionId }) => {
  const markdownDocs = extractSupplierUploadedDocsFromMarkdown(text);
  const artifactDocs = extractSupplierUploadedDocsFromArtifact(artifact || {});
  const docs = mergeMarkdownDocsWithArtifactDocs(markdownDocs, artifactDocs);
  const cleanText = removeSupplierS3KeyLinesFromMarkdown(text);

  const getSupplierDocumentUrl = async (doc) => {
    const token = await getAccessToken();
    const taskId = String(doc?.taskId || "").trim();
    const requestId = String(doc?.requestId || "").trim();
    const activeSessionId = String(sessionId || taskId || "").trim();
    const userEmail = String(user?.email || "").trim();
    const fileName = String(doc?.fileName || "supplier-document").trim();
    const fileType = String(doc?.fileType || "application/octet-stream").trim();
    const s3Key = String(doc?.s3Key || doc?.S3Key || "").trim();
    const existingDownloadUrl = String(
      doc?.downloadUrl || doc?.DownloadUrl || doc?.url || doc?.Url || ""
    ).trim();

    if (existingDownloadUrl) {
      return existingDownloadUrl;
    }

    if (!s3Key) {
      throw new Error("No S3 key found for this supplier document.");
    }

    try {
      const res = await downloadSupplierTaskFile(
        {
          taskId,
          requestId,
          sessionId: activeSessionId,
          userId: userEmail,
          fileName,
          s3Key,
          fileType,
        },
        token
      );

      const supplierUrl =
        (typeof res === "string" ? res : "") ||
        res?.downloadUrl ||
        res?.url ||
        res?.presignedUrl ||
        res?.data?.downloadUrl ||
        res?.payload?.downloadUrl ||
        "";

      if (supplierUrl) return supplierUrl;
    } catch (supplierErr) {
      console.warn(
        "Supplier markdown document download endpoint failed, trying generic presign-download:",
        supplierErr
      );
    }

    const fallbackRes = await downloadFilePresigned(
      {
        userId: userEmail,
        sessionId: activeSessionId,
        fileName,
        fileType,
        s3Key,
      },
      token
    );

    const fallbackUrl =
      fallbackRes?.downloadUrl ||
      fallbackRes?.url ||
      fallbackRes?.presignedUrl ||
      fallbackRes?.data?.downloadUrl ||
      fallbackRes?.payload?.downloadUrl ||
      "";

    if (!fallbackUrl) {
      throw new Error("No download URL returned for supplier document.");
    }

    return fallbackUrl;
  };

  const handlePreview = async (doc) => {
    try {
      const url = await getSupplierDocumentUrl(doc);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      console.error("Supplier markdown document preview failed:", e);
      alert(e?.message || "Preview failed");
    }
  };

  const handleDownload = async (doc) => {
    try {
      const url = await getSupplierDocumentUrl(doc);
      const fileName = doc?.fileName || "supplier-document";
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      console.error("Supplier markdown document download failed:", e);
      alert(e?.message || "Download failed");
    }
  };

  return (
    <div className="supplierUploadedDocsMarkdownCard">
      <MarkdownRenderer text={cleanText} />

      <div
        style={{
          marginTop: "18px",
          borderTop: "1px solid #e2e8f0",
          paddingTop: "16px",
          display: "grid",
          gap: "12px",
        }}
      >
        <div
          style={{
            fontSize: "13px",
            fontWeight: 900,
            color: "#0f172a",
            letterSpacing: "0.03em",
          }}
        >
          Supplier document actions
        </div>

        {docs.map((doc, index) => (
          <div
            key={`${doc.s3Key}-${index}`}
            style={{
              border: "1px solid #e2e8f0",
              borderRadius: "16px",
              padding: "13px",
              background: "linear-gradient(180deg, #ffffff, #f8fafc)",
              display: "flex",
              justifyContent: "space-between",
              gap: "14px",
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 900, color: "#0f172a", wordBreak: "break-word" }}>
                {index + 1}. {doc.fileName}
              </div>
              <div style={{ marginTop: "5px", color: "#64748b", fontSize: "12px" }}>
                {doc.uploadedBy ? `Uploaded by: ${doc.uploadedBy}` : "Uploaded by: Supplier"}
                {doc.uploadedAt ? ` • ${doc.uploadedAt}` : ""}
              </div>
              {doc.supplierNote ? (
                <div style={{ marginTop: "7px", color: "#334155", fontSize: "13px" }}>
                  <strong>Supplier note:</strong> {doc.supplierNote}
                </div>
              ) : null}
            </div>

            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <button
                type="button"
                className="premiumGhostBtn"
                onClick={() => handlePreview(doc)}
                style={{ minHeight: "38px", padding: "8px 12px" }}
              >
                Preview
              </button>
              <button
                type="button"
                className="formSaveBtn premiumFormSaveBtn"
                onClick={() => handleDownload(doc)}
                style={{ minHeight: "38px", padding: "8px 12px" }}
              >
                Download Document
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const EmailDraftCard = ({ draft, onSaveDraft, onSendEmail, onPreviewAttachment, onDownloadAttachment }) => {
  const draftSentConfirmationText = String(
    draft?.body ||
      draft?.Body ||
      draft?.text ||
      draft?.content ||
      draft?.reply ||
      ""
  ).trim();

  if (isEmailSentConfirmationText(draftSentConfirmationText)) {
    return <EmailSentConfirmationCard text={draftSentConfirmationText} />;
  }

  const isSupplier = Boolean(draft?.isSupplierEmail) || isSupplierEmailDraft(draft);
  const defaultDraft = {
    to: "",
    from: CUSTOMER_REQUEST_FROM_EMAIL,
    subject: "",
    body: "",
    kind: isSupplier ? "supplier_fmd_request" : "customer_request_email",
    emailKind: isSupplier ? "supplier_fmd_request" : "customer_request_email",
    isSupplierEmail: isSupplier,
  };

  const [isEditing, setIsEditing] = useState(false);
  const [localDraft, setLocalDraft] = useState(draft || defaultDraft);
  const [statusMsg, setStatusMsg] = useState("");

  useEffect(() => {
    const nextIsSupplier =
      Boolean(draft?.isSupplierEmail) || isSupplierEmailDraft(draft);
    setLocalDraft(
      draft || {
        ...defaultDraft,
        kind: nextIsSupplier ? "supplier_fmd_request" : "customer_request_email",
        emailKind: nextIsSupplier ? "supplier_fmd_request" : "customer_request_email",
        isSupplierEmail: nextIsSupplier,
      }
    );
    setStatusMsg("");
    setIsEditing(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  if (!draft) return null;

  const updateField = (key, value) => {
    if (key === "from") return;
    setLocalDraft((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = () => {
    onSaveDraft?.({
      ...localDraft,
      from: localDraft?.from || CUSTOMER_REQUEST_FROM_EMAIL,
      isSupplierEmail: isSupplier,
      kind: isSupplier ? "supplier_fmd_request" : localDraft?.kind || "customer_request_email",
      emailKind: isSupplier ? "supplier_fmd_request" : localDraft?.emailKind || "customer_request_email",
    });
    setStatusMsg("Draft saved locally.");
    setIsEditing(false);
  };

  const handleSend = () => {
    onSendEmail?.({
      ...localDraft,
      from: localDraft?.from || CUSTOMER_REQUEST_FROM_EMAIL,
      isSupplierEmail: isSupplier,
      kind: isSupplier ? "supplier_fmd_request" : localDraft?.kind || "customer_request_email",
      emailKind: isSupplier ? "supplier_fmd_request" : localDraft?.emailKind || "customer_request_email",
    });
    setStatusMsg(isSupplier ? "" : "Send action triggered.");
  };

  const accent = isSupplier
    ? "linear-gradient(135deg, #0f766e, #2563eb)"
    : "linear-gradient(135deg, #4f46e5, #7c3aed)";

  return (
    <div
      className={`emailDraftShell premiumEmailDraft ${
        isSupplier ? "supplierEmailDraft" : "customerEmailDraft"
      }`}
      style={{
        position: "relative",
        overflow: "hidden",
        borderRadius: "24px",
        border: isSupplier
          ? "1px solid rgba(13, 148, 136, 0.22)"
          : "1px solid rgba(99, 102, 241, 0.22)",
        background:
          "linear-gradient(145deg, rgba(255,255,255,0.98), rgba(248,250,252,0.96))",
        boxShadow:
          "0 24px 70px rgba(15, 23, 42, 0.12), inset 0 1px 0 rgba(255,255,255,0.9)",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: "0 auto 0 0",
          width: "6px",
          background: accent,
        }}
      />

      <div className="emailDraftHeader">
        <div>
          <div className="emailDraftEyebrow">
            {isSupplier ? "Supplier Email Draft" : "Customer Email Draft"}
          </div>
          <div className="emailDraftTitle">
            {isSupplier
              ? "Request FMD documents from supplier"
              : "Review before sending"}
          </div>
          {isSupplier ? (
            <div
              style={{
                marginTop: "8px",
                color: "#64748b",
                fontSize: "13px",
                lineHeight: 1.45,
              }}
            >
              This email includes the supplier upload URL and OTP login instruction.
            </div>
          ) : null}
        </div>

        <div className="emailDraftActionsTop" style={{ display: "flex", gap: "10px" }}>
          <span
            style={{
              alignSelf: "center",
              borderRadius: "999px",
              padding: "8px 12px",
              fontSize: "11px",
              fontWeight: 800,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: isSupplier ? "#0f766e" : "#3730a3",
              background: isSupplier ? "rgba(240, 253, 250, 0.96)" : "rgba(238, 242, 255, 0.96)",
              border: isSupplier ? "1px solid rgba(20, 184, 166, 0.25)" : "1px solid rgba(99, 102, 241, 0.2)",
              whiteSpace: "nowrap",
            }}
          >
            {isSupplier ? "Supplier Request" : "Customer Review"}
          </span>

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
              placeholder={isSupplier ? "supplier@example.com" : "customer@example.com"}
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
          <div className="emailDraftMetaLabel">From</div>
          <div className="emailDraftMetaValue strong">
            {localDraft.from || CUSTOMER_REQUEST_FROM_EMAIL}
          </div>
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

      {Array.isArray(localDraft.attachments) && localDraft.attachments.length > 0 ? (
        <div className="emailAttachmentStrip">
          <div className="emailAttachmentStripLabel">Attachment</div>
          {localDraft.attachments.map((file, idx) => (
            <div className="emailAttachmentRow" key={`${file?.fileName || "attachment"}-${idx}`}>
              <div className="emailAttachmentPill">
                <span className="emailAttachmentIcon">📎</span>
                <span className="emailAttachmentName">
                  {file?.fileName || localDraft?.attachmentFileName || "Assessment report.pdf"}
                </span>
              </div>
              <div className="emailAttachmentActions">
                <button
                  type="button"
                  className="emailAttachmentBtn"
                  onClick={() => onPreviewAttachment?.(file)}
                >
                  Preview
                </button>
                <button
                  type="button"
                  className="emailAttachmentBtn"
                  onClick={() => onDownloadAttachment?.(file)}
                >
                  Download
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : localDraft?.attachmentFileName ? (
        <div className="emailAttachmentStrip">
          <div className="emailAttachmentStripLabel">Attachment</div>
          <div className="emailAttachmentRow">
            <div className="emailAttachmentPill">
              <span className="emailAttachmentIcon">📎</span>
              <span className="emailAttachmentName">{localDraft.attachmentFileName}</span>
            </div>
            <div className="emailAttachmentActions">
              <button
                type="button"
                className="emailAttachmentBtn"
                onClick={() => onPreviewAttachment?.(localDraft)}
              >
                Preview
              </button>
              <button
                type="button"
                className="emailAttachmentBtn"
                onClick={() => onDownloadAttachment?.(localDraft)}
              >
                Download
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="emailDraftFooter">
        <div className="emailDraftFooterHint">
          {isEditing
            ? "Edit the draft and save your changes before sending."
            : isSupplier
            ? "Preview the supplier-facing FMD request email before sending."
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
            {isSupplier ? "Send to Supplier" : "Send Email"}
          </button>
        </div>
      </div>

      {statusMsg ? <div className="formSaveMsg">{statusMsg}</div> : null}
    </div>
  );
};


/* ===============================
   ✅ Assessment Report PDF + Customer Email Card
   =============================== */
const AssessmentReportCard = ({
  message,
  sessionAssessmentMarkdown = "",
  user,
  sessionId,
  onSaveDraft,
  onSendEmail,
}) => {

  const artifact = getAssessmentReportArtifact(message) || {};
  const requestId =
    artifact?.requestId || artifact?.RequestId || extractRequestIdFromSessionId(sessionId);
  const reportS3Path = artifact?.assessmentReportS3Path || "";
  const reportStatus = artifact?.assessmentReportPublishedStatus || "";
  const reportFileName = fileNameFromS3Path(reportS3Path);
  const text = extractMessageText(message) || "";
  const viewerMarkdown =
    getAssessmentMarkdownForViewer(message || {}, text) ||
    getAssessmentMarkdownForViewer(
      { assessmentReportMarkdown: sessionAssessmentMarkdown },
      sessionAssessmentMarkdown
    );

  const [loadingAction, setLoadingAction] = useState("");
  const [statusMsg, setStatusMsg] = useState("");
  const [generatedDraft, setGeneratedDraft] = useState(null);

  const getPdfUrl = async () => {
    const token = await getAccessToken();
    const res = await presignAssessmentReportPdf(
      {
        sessionId,
        userId: user?.email,
        requestId,
        reportS3Path,
      },
      token
    );
    const url = res?.previewUrl || res?.downloadUrl || res?.url || "";
    if (!url) throw new Error("PDF URL was not returned by backend.");
    return { url, fileName: res?.fileName || reportFileName };
  };

  const handlePreviewPdf = async () => {
    try {
      setLoadingAction("preview");
      setStatusMsg("");
      const { url } = await getPdfUrl();
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      console.error("Assessment PDF preview failed:", e);
      setStatusMsg(e?.message || "PDF preview failed");
    } finally {
      setLoadingAction("");
    }
  };

  const handleDownloadPdf = async () => {
    try {
      setLoadingAction("download");
      setStatusMsg("");
      const { url, fileName } = await getPdfUrl();
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName || reportFileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      console.error("Assessment PDF download failed:", e);
      setStatusMsg(e?.message || "PDF download failed");
    } finally {
      setLoadingAction("");
    }
  };

  const handleGenerateEmail = async () => {
    try {
      setLoadingAction("email");
      setStatusMsg("");
      const token = await getAccessToken();
      const res = await generateAssessmentCustomerEmail(
        {
          sessionId,
          userId: user?.email,
          requestId,
        },
        token
      );

      const draft = res?.emailDraft || null;
      if (!draft) throw new Error("Email draft was not returned by backend.");

      const finalReportS3Path =
        reportS3Path ||
        draft?.assessmentReportS3Path ||
        draft?.reportS3Path ||
        "";

      const finalAttachmentFileName =
        draft?.attachmentFileName ||
        fileNameFromS3Path(finalReportS3Path, reportFileName);

      setGeneratedDraft({
        ...draft,
        type: "email_draft",
        emailKind: "assessment_report_customer_email",
        kind: "assessment_report_customer_email",
        attachAssessmentPdf: true,
        reportS3Path: finalReportS3Path,
        assessmentReportS3Path: finalReportS3Path,
        attachmentFileName: finalAttachmentFileName,
        attachments: finalReportS3Path
          ? [
              {
                fileName: finalAttachmentFileName,
                s3Path: finalReportS3Path,
                reportS3Path: finalReportS3Path,
                assessmentReportS3Path: finalReportS3Path,
                type: "application/pdf",
              },
            ]
          : [],
      });
      setStatusMsg("Email draft generated with assessment PDF attachment.");
    } catch (e) {
      console.error("Generate assessment customer email failed:", e);
      setStatusMsg(e?.message || "Generate email failed");
    } finally {
      setLoadingAction("");
    }
  };

  return (
    <div className="assessmentPdfStack">
      <div className="assessmentPdfCard">
        <div className="assessmentPdfHeader">
          <div className="assessmentPdfIcon" aria-hidden="true">PDF</div>
          <div className="assessmentPdfHeaderText">
            <div className="assessmentPdfEyebrow">Assessment report</div>
            <div className="assessmentPdfTitle">Assessment report package ready</div>
            <div className="assessmentPdfSubtitle">
              The final assessment PDF has been published and is ready for customer communication.
            </div>
          </div>
          {reportStatus ? (
            <div className="assessmentPdfStatusPill">{reportStatus}</div>
          ) : null}
        </div>

        {reportS3Path ? (
          <div className="assessmentPdfFileBox">
            <div className="assessmentPdfFileIcon" aria-hidden="true">📄</div>
            <div className="assessmentPdfFileMeta">
              <div className="assessmentPdfFileLabel">Attached PDF</div>
              <div className="assessmentPdfFileName" title={reportFileName}>{reportFileName}</div>
            </div>
          </div>
        ) : null}

        <div className="assessmentPdfActionsRow">
          <div className="assessmentPdfHint">
            Review or download the published PDF, then generate the customer email with this PDF attached.
          </div>
          <div className="assessmentPdfActions">
            <button type="button" className="assessmentPdfBtn assessmentPdfBtnGhost" disabled={!reportS3Path || loadingAction === "preview"} onClick={handlePreviewPdf}>
              {loadingAction === "preview" ? "Opening..." : "Preview PDF"}
            </button>
            <button type="button" className="assessmentPdfBtn assessmentPdfBtnGhost" disabled={!reportS3Path || loadingAction === "download"} onClick={handleDownloadPdf}>
              {loadingAction === "download" ? "Downloading..." : "Download PDF"}
            </button>
            <button type="button" className="assessmentPdfBtn assessmentPdfBtnPrimary" disabled={!reportS3Path || loadingAction === "email"} onClick={handleGenerateEmail}>
              {loadingAction === "email" ? "Generating..." : "Generate customer email"}
            </button>
          </div>
        </div>

        {statusMsg ? <div className="assessmentPdfMessage">{statusMsg}</div> : null}


      </div>

      {viewerMarkdown ? (
        <details className="assessmentReportChatToggle">
          <summary>View full markdown report</summary>
          <div className="markdown-body assessmentReportChatMarkdown">
            <MarkdownRenderer text={viewerMarkdown} />
          </div>
        </details>
      ) : null}

      {generatedDraft ? (
        <div className="assessmentPdfDraftWide">
          <EmailDraftCard
            draft={generatedDraft}
            onSaveDraft={onSaveDraft}
            onSendEmail={onSendEmail}
            onPreviewAttachment={handlePreviewPdf}
            onDownloadAttachment={handleDownloadPdf}
          />
        </div>
      ) : null}
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
  const requestDetail = safe.RequestDetail || safe.RequestDetails || {};
  const customerDetail = safe.CustomerDetail || safe.CustomerDetails || {};

  const customerName = safe.CustomerName ?? customerDetail.CustomerName ?? "";
  const customerPartName =
    safe.CustomerPartName ?? customerDetail.CustomerPartName ?? "";
  const customerPartNumber =
    safe.CustomerPartNumber ?? customerDetail.CustomerPartNumber ?? "";
  const requestName =
    safe.RequestName ?? safe.title ?? requestDetail.RequestName ?? "";
  const requestDescription =
    safe.RequestDescription ?? requestDetail.RequestDescription ?? "";
  const requestType = safe.RequestType ?? requestDetail.RequestType ?? "";
  const requestCompletionDate =
    safe.RequestCompletionDateTime ??
    safe.RequestCompletionDate ??
    requestDetail.RequestCompletionDateTime ??
    "";
  const requestPriority =
    safe.RequestPriority ?? requestDetail.RequestPriority ?? "Medium";
  const requestorMethod =
    safe.RequestorMethod ?? requestDetail.RequestorMethod ?? "EMAIL";
  const requestorContent = requestDescription;
  const requestConfirmationEmail =
    safe.RequestConfirmationEmail ?? requestDetail.RequestConfirmationEmail ?? "";

  const notifyCustomer = Boolean(
    safe.NotifyCustomer ?? safe.notifyCustomer ?? false
  );
  const customerEmail =
    safe.CustomerEmail ??
    safe.customerEmail ??
    safe.CustomerContactEmail ??
    safe.CustomerContactEmailId ??
    customerDetail.CustomerContactEmailId ??
    customerDetail.CustomerContactEmail ??
    "";

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
    RequestName: requestName,
    RequestDescription: requestDescription,
    RequestType: requestType,
    RequestCompletionDateTime: requestCompletionDate,
    RequestCompletionDate: requestCompletionDate,
    RequestPriority: requestPriority,
    RequestorMethod: requestorMethod,
    RequestorContent: requestorContent,
    RequestConfirmationEmail: requestConfirmationEmail,
    NotifyCustomer: notifyCustomer,
    CustomerEmail: customerEmail,
    CustomerContactEmailId: customerEmail,
    EmailFrom: CUSTOMER_REQUEST_FROM_EMAIL,
    RequestDetail: {
      ...(safe.RequestDetail || {}),
      RequestName: requestName,
      RequestDescription: requestDescription,
      RequestType: requestType,
      RequestPriority: requestPriority,
      RequestCompletionDateTime: requestCompletionDate,
      RequestorMethod: requestorMethod,
      RequestorContent: requestorContent,
      RequestConfirmationEmail: requestConfirmationEmail,
    },
    CustomerDetail: {
      ...(safe.CustomerDetail || {}),
      CustomerPartNumber: customerPartNumber,
      CustomerPartName: customerPartName,
      CustomerContactEmailId: customerEmail,
    },
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
      makeField("RequestName", "Request Name", "text", requestName, true),
      makeField("RequestType", "Request Type", "text", requestType, true),
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
      makeField(
        "NotifyCustomer",
        "Notify Customer",
        "checkbox",
        notifyCustomer,
        false
      ),
      makeField("CustomerEmail", "Customer Email", "email", customerEmail, false),
    ],
  };
};

const FormEditorCard = ({
  formDraft,
  setFormDraft,
  onSave,
  onGenerateEmailDraft,
  onNotifyCustomerSelected,
  saving,
  generatingEmailDraft,
  saveMsg,
}) => {
  if (!formDraft) return null;

  const isCustomerRequestForm =
    (formDraft?.fields || []).some((f) =>
      [
        "CustomerName",
        "CustomerPartName",
        "CustomerPartNumber",
        "RequestName",
        "RequestDescription",
        "RequestType",
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

      const previousValue = prev[key];
      const next = { ...prev, [key]: nextVal };
      next.fields = (next.fields || []).map((f) =>
        f.key === key ? { ...f, value: nextVal } : f
      );

      if (
        key === "NotifyCustomer" &&
        Boolean(previousValue) === false &&
        Boolean(nextVal) === true
      ) {
        setTimeout(() => {
          onNotifyCustomerSelected?.(next);
        }, 0);
      }

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
            disabled={saving || !onSave}
          >
            {saving ? "Saving..." : "Save"}
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
    [
      "RequestName",
      "RequestType",
      "RequestDescription",
      "RequestCompletionDate",
    ].includes(f.key)
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
  const requestName = String(getValueByKey("RequestName") || "").trim();
  const requestType = String(getValueByKey("RequestType") || "").trim();
  const requestDescription = String(getValueByKey("RequestDescription") || "").trim();
  const requestorContent = requestDescription;
  const requestCompletionDate = String(
    getValueByKey("RequestCompletionDate") || ""
  ).trim();
  const selectedPriority = String(getFieldValue(priorityField) || "Medium");
  const notifyCustomer = Boolean(getValueByKey("NotifyCustomer"));
  const customerEmail = String(getValueByKey("CustomerEmail") || "").trim();

  const requiredChecks = [
    { key: "CustomerName", label: "Customer Name", value: customerName },
    { key: "CustomerPartName", label: "Customer Part Name", value: customerPartName },
    {
      key: "CustomerPartNumber",
      label: "Customer Part Number",
      value: customerPartNumber,
    },
    { key: "RequestName", label: "Request Name", value: requestName },
    { key: "RequestType", label: "Request Type", value: requestType },
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
      if (f.key === "RequestName") {
        return "Example: Material Declaration, Compliance Assessment, or IMDS Submission.";
      }
      if (f.key === "RequestType") {
        return "Example: IMDS Submission, Material Compliance, or Regulatory Review.";
      }
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
    <div
      className="request-form-shell"
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) minmax(280px, 340px)",
        gap: "24px",
        alignItems: "start",
        width: "100%",
      }}
    >
      <div
        className="request-form-main"
        style={{
          alignSelf: "start",
          marginTop: 0,
          minWidth: 0,
        }}
      >
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
                  {formReady ? "Ready" : "Needs attention"}
                </div>
                <div className="premiumMetaBadge">
                  <span className="premiumMetaDot" />
                  {completedCount} / {requiredChecks.length} completed
                </div>
              </div>
            </div>

            <div className="premiumFormHint">Edit and review</div>
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

            <div className="premiumFormGroup premiumFormGroupFull">
              <label className="premiumFormLabel">Notify Customer</label>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  marginTop: "8px",
                }}
              >
                <input
                  id="notify-customer-checkbox"
                  type="checkbox"
                  checked={notifyCustomer}
                  onChange={(e) =>
                    updateField("NotifyCustomer", e.target.checked)
                  }
                />
                <label
                  htmlFor="notify-customer-checkbox"
                  style={{
                    fontSize: "14px",
                    fontWeight: 500,
                    color: "#24324a",
                    cursor: "pointer",
                  }}
                >
                  Select Notify Customer
                </label>
              </div>

              <div className="premiumFieldHelp" style={{ marginTop: "8px" }}>
                When enabled, email draft generation starts directly from this request.
              </div>
            </div>

            {notifyCustomer ? (
              <div className="premiumFormGrid">
                <div className="premiumFormGroup premiumFormGroupFull">
                  <label className="premiumFormLabel">Customer Email</label>
                  <input
                    className="premiumFormInput"
                    type="email"
                    value={customerEmail}
                    onChange={(e) =>
                      updateField("CustomerEmail", e.target.value)
                    }
                    placeholder="customer@example.com"
                  />
                </div>

                <div className="premiumFormGroup premiumFormGroupFull">
                  <label className="premiumFormLabel">From</label>
                  <input
                    className="premiumFormInput"
                    type="text"
                    value={CUSTOMER_REQUEST_FROM_EMAIL}
                    readOnly
                  />
                  <div className="premiumFieldHelp">
                    This sender email is fixed as requested.
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          <div className="formFooter premiumFormFooter">
            <div className="premiumFormFooterLeft">
              <div className="premiumFormFooterTitle">
                {formReady ? "Form is ready" : "Complete the required fields"}
              </div>
              <div className="premiumFormFooterSub">
                {formReady
                  ? notifyCustomer
                    ? "Customer notification is enabled. Email draft generation will start directly."
                    : "Review the summary and save this request."
                  : `${missingRequired.length} required field${
                      missingRequired.length > 1 ? "s are" : " is"
                    } still missing.`}
              </div>
            </div>

            <div className="premiumFormFooterActions">

              {!notifyCustomer && (
                <button
                  type="button"
                  className="formSaveBtn premiumFormSaveBtn"
                  onClick={onSave}
                  disabled={saving || !formReady}
                >
                  {saving ? "Submitting..." : "Submit for Review"}
                </button>
              )}

              {notifyCustomer && (
                <button
                  type="button"
                  className="formSaveBtn premiumFormSaveBtn"
                  onClick={onGenerateEmailDraft}
                  disabled={saving || generatingEmailDraft || !formReady}
                >
                  {generatingEmailDraft ? "Generating..." : "Generate Email Draft"}
                </button>
              )}
            </div>

            {saveMsg ? <div className="formSaveMsg">{saveMsg}</div> : null}
          </div>
        </div>
      </div>

      <aside
        className="request-form-side"
        style={{
          alignSelf: "start",
          marginTop: 0,
          paddingTop: 0,
          display: "flex",
          flexDirection: "column",
          gap: "16px",
          minWidth: 0,
        }}
      >
        <div className="requestSideCard" style={{ marginTop: 0 }}>
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
              <div className="requestSummaryLabel">Request Name</div>
              <div className="requestSummaryValue">
                {requestName || (
                  <span className="requestSummaryMuted">Not provided</span>
                )}
              </div>
            </div>

            <div className="requestSummaryItem">
              <div className="requestSummaryLabel">Request Type</div>
              <div className="requestSummaryValue">
                {requestType || (
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

            <div className="requestSummaryItem">
              <div className="requestSummaryLabel">Notify Customer</div>
              <div className="requestSummaryValue">
                {notifyCustomer ? "Yes" : "No"}
              </div>
            </div>

            {notifyCustomer ? (
              <>
                <div className="requestSummaryItem">
                  <div className="requestSummaryLabel">Customer Email</div>
                  <div className="requestSummaryValue">
                    {customerEmail || (
                      <span className="requestSummaryMuted">Not provided</span>
                    )}
                  </div>
                </div>

                <div className="requestSummaryItem">
                  <div className="requestSummaryLabel">From</div>
                  <div className="requestSummaryValue">
                    {CUSTOMER_REQUEST_FROM_EMAIL}
                  </div>
                </div>
              </>
            ) : null}
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
              All required fields are completed. The request is ready.
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
    raw === "REQUEST_PROGRESS" ||
    raw === "ASSESSMENT_INPROGRESS" ||
    raw === "ASSESSMENT_IN_PROGRESS"
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
      item?.rawRequestStatus ||
      item?.RequestStatus ||
      item?.Status ||
      item?.RawRequestStatus ||
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
    item?.lastActivityAt ||
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

    if (!q) return clean.slice(0, 20);

    return clean
      .filter((s) => {
        const parsed = parseRequestSuggestion(s);
        const statusLabel = getSuggestionStatusLabel(s).toLowerCase();

        return (
          String(parsed.requestId || "").toLowerCase().includes(q) ||
          String(parsed.partName || "").toLowerCase().includes(q) ||
          String(parsed.partNumber || "").toLowerCase().includes(q) ||
          statusLabel.includes(q) ||
          String(s?.sessionId || "").toLowerCase().includes(q) ||
          String(s?.title || "").toLowerCase().includes(q)
        );
      })
      .slice(0, 20);
  }, [query, suggestions, existingStatusFilter]);

  const isExistingOpen = mode === "existing";

  return (
    <div className="customer-request-inline-card">
      <div className="customer-request-inline-eyebrow">
        CUSTOMER REQUEST ASSISTANT 
      </div>

      <h2 className="customer-request-inline-title">
         How can I help you with your customer request today?
      </h2>

    
      

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
             Share the customer, part, and requirement details. I’ll help you prepare the request step by step.
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
             Find a request to review status, customer replies, assessment progress, or next actions.
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
                                <span className="part-number">
                                  {" "}
                                  • {parsed.partNumber}
                                </span>
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
  refreshSidebar,
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
  const [generatingEmailDraft, setGeneratingEmailDraft] = useState(false);
  const [formSaveMsg, setFormSaveMsg] = useState("");
  const [formInsertIndex, setFormInsertIndex] = useState(null);

  const [isStartingCustomerRequest, setIsStartingCustomerRequest] = useState(false);

  const [liveCustomerRequestSuggestions, setLiveCustomerRequestSuggestions] = useState(
    Array.isArray(customerRequestSuggestions) ? customerRequestSuggestions : []
  );
  const [existingRequestsLoading, setExistingRequestsLoading] = useState(false);

  const [showCustomerReplyModal, setShowCustomerReplyModal] = useState(false);
  const [customerReplySubject, setCustomerReplySubject] = useState("");
  const [customerReplyBody, setCustomerReplyBody] = useState("");
  const [processingCustomerReply, setProcessingCustomerReply] = useState(false);
  const [submittingEmailReview, setSubmittingEmailReview] = useState(false);

  // Real backend request status used by the workflow fulfillment bar.
  // This is refreshed from Customer Request Store so the bar does not depend only
  // on old chat text like "REQUEST-CONFIRMED".
  const [currentRequestStatusOverride, setCurrentRequestStatusOverride] = useState("");

  // Engineering Supplier Task: the sidebar/card can contain an old task snapshot.
  // Cache a fresh backend task summary so the Supplier Task card shows the same
  // uploaded document list + Download buttons as the customer-request chat reply.
  const [supplierTaskReviewMarkdownByTaskId, setSupplierTaskReviewMarkdownByTaskId] = useState({});
  const [supplierTaskReviewLoadingKey, setSupplierTaskReviewLoadingKey] = useState("");

  const scrollRef = useRef(null);
  const textareaRef = useRef(null);
  const uploadBtnRef = useRef(null);

  const chatIdRef = useRef(chat?.id);
  const visibleMessageCountRef = useRef(0);
  const customerRequestSearchSeqRef = useRef(0);
  const supplierTaskAutoLoadedRef = useRef(new Set());

  const getActiveSessionId = useCallback(() => {
    // Prefer React prop over ref. The ref can lag behind immediately after
    // clicking a sidebar session, which was causing email drafts to use the
    // previous request id in the subject.
    const active = chat?.id || chatIdRef.current || "default-chat";
    chatIdRef.current = active;
    return active;
  }, [chat?.id]);

  const isRequestMonitoringSession = useMemo(() => {
    const active = String(chat?.id || chat?.title || "").trim().toLowerCase();
    return (
      active === "request monitoring & status" ||
      active.includes("request monitoring") ||
      active.includes("monitoring & status")
    );
  }, [chat?.id, chat?.title]);

  const isEngineerProfile = useMemo(() => isEngineeringProfileUser(user), [user]);

  const isActiveSupplierTaskSession = useMemo(() => {
    return isSupplierTaskSessionId(chat?.id);
  }, [chat?.id]);

  const isCustomerRequestSession = useCallback((sessionId = "") => {
    return /^REQ[A-Z]?#\d{8}#\d{6}-/i.test(String(sessionId || ""));
  }, []);

  const adoptSessionFromResponseSafely = useCallback(
    async (res, fallbackSessionId) => {
      const returnedSessionId =
        res?.newSessionId || res?.sessionId || res?.SessionId || "";

      // Once we are inside a real customer request session, do not let a save
      // or email-draft response move the UI to a newly generated request id.
      if (isCustomerRequestSession(fallbackSessionId)) {
        chatIdRef.current = fallbackSessionId;
        return fallbackSessionId;
      }

      if (returnedSessionId && returnedSessionId !== fallbackSessionId) {
        chatIdRef.current = returnedSessionId;
        await adoptServerSessionId?.(returnedSessionId);
        await refreshSidebar?.();
        return returnedSessionId;
      }

      if (returnedSessionId) {
        chatIdRef.current = returnedSessionId;
        return returnedSessionId;
      }

      return fallbackSessionId;
    },
    [adoptServerSessionId, refreshSidebar, isCustomerRequestSession]
  );

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
    setShowCustomerReplyModal(false);
    setCustomerReplySubject("");
    setCustomerReplyBody("");
    setProcessingCustomerReply(false);
    setSubmittingEmailReview(false);
    setCurrentRequestStatusOverride("");
    setSupplierTaskReviewLoadingKey("");

    if (isSupplierTaskSessionId(chat?.id)) {
      setShowForm(false);
      setFormDraft(null);
      setGeneratingEmailDraft(false);
      setSavingForm(false);
    }
  }, [chat?.id]);

  useEffect(() => {
    setLiveCustomerRequestSuggestions((prev) =>
      mergeUniqueRequestSuggestions(
        Array.isArray(customerRequestSuggestions) ? customerRequestSuggestions : [],
        prev
      )
    );
  }, [customerRequestSuggestions]);

  const mergedCustomerRequestSuggestions = useMemo(() => {
    return mergeUniqueRequestSuggestions(
      liveCustomerRequestSuggestions,
      Array.isArray(customerRequestSuggestions) ? customerRequestSuggestions : []
    );
  }, [liveCustomerRequestSuggestions, customerRequestSuggestions]);

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

  const getPreferredCustomerEmail = useCallback((msg = null) => {
    return String(
      msg?.artifact?.to ||
        msg?.artifact?.To ||
        msg?.artifact?.toEmail ||
        msg?.artifact?.ToEmail ||
        msg?.artifact?.emailDraft?.to ||
        msg?.artifact?.EmailDraft?.to ||
        msg?.emailDraft?.to ||
        msg?.EmailDraft?.to ||
        msg?.toEmail ||
        msg?.ToEmail ||
        msg?.to ||
        msg?.To ||
        ""
    ).trim();
  }, []);

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

    const emailDraft = normalizeEmailDraft(
      msg,
      text,
      getPreferredCustomerEmail(msg)
    );
    const supplierTask = normalizeSupplierTask(msg);

    const nextMessage = {
      ...msg,
      sender,
      text,
      role: msg.role || (sender === "bot" ? "assistant" : "user"),
      content: msg.content ?? text,
      attachments,
      artifact: msg.artifact || null,
      supplierTask,
      flowType: msg.flowType || null,
      step: msg.step || null,
      question: msg.question || null,
      options: Array.isArray(msg.options) ? msg.options : [],
      inputType: msg.inputType || null,
      emailDraft,
    };

    updateMessages((prev) => {
      const last = prev?.[prev.length - 1];
      if (isSameCustomerFlowCard(last, nextMessage)) {
        return prev;
      }
      return [...prev, nextMessage];
    });
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

      const emailDraft = normalizeEmailDraft(
        m,
        text,
        getPreferredCustomerEmail(m)
      );
      const supplierTask = normalizeSupplierTask(m);

      return {
        id: m.id || `msg-${i}`,
        sender,
        text,
        role: m.role || (sender === "bot" ? "assistant" : "user"),
        content: m.content ?? text,
        attachments,
        artifact: m.artifact || null,
        supplierTask,
        flowType: m.flowType || null,
        step: m.step || null,
        question: m.question || null,
        options: Array.isArray(m.options) ? m.options : [],
        inputType: m.inputType || null,
        emailDraft,
      };
    });

  const hasActiveCustomerFlow = useMemo(() => {
    if (isActiveSupplierTaskSession) return false;

    const raw = chat?.messages || [];
    return raw.some(
      (m) =>
        m?.flowType === "customer_request" ||
        isCustomerFlowQuestionText(extractMessageText(m))
    );
  }, [chat?.messages, isActiveSupplierTaskSession]);

  const cleanedMessages = useMemo(() => {
    const raw = chat?.messages || [];
    const activeRequestId = extractRequestIdFromSessionId(chat?.id || "");

    // Supplier task safety: keep supplier task/card messages and hide only stale
    // customer request flow prompts that can remain from the previous session.
    // This avoids both problems: old customer flow overlay and blank screen.
    const sourceMessages = isActiveSupplierTaskSession
      ? raw.filter(
          (item) =>
            !isCustomerRequestFlowOnlyMessage(item) &&
            !isSupplierTaskAutoChatNoiseMessage(item)
        )
      : raw;

    const dedupedRaw = [];
    const seenEmailReviewKeys = new Set();

    for (const item of sourceMessages) {
      const previous = dedupedRaw[dedupedRaw.length - 1];
      if (isSameCustomerFlowCard(previous, item)) {
        continue;
      }

      // Hide raw backend marker/user messages. The assistant review card below
      // presents the customer reply in a cleaner way.
      if (isRawCustomerEmailReplyMessage(item)) {
        continue;
      }

      // Frontend safety: even if DynamoDB already has duplicate poller rows,
      // show only one card per customer reply.
      //
      // IMPORTANT:
      // Do not run request-id filtering for normal markdown/status messages.
      // Request Monitoring tables contain REQC#... text, and the old logic was
      // treating that as an email-review request id, then hiding the status table
      // because the active session is "Request Monitoring & Status".
      const emailReviewKey = getEmailReviewDedupeKey(item);
      if (emailReviewKey) {
        const emailReviewRequestId = getEmailReviewRequestIdFromMessage(item);
        const isRealActiveRequest = /^REQ[A-Z]?#/i.test(activeRequestId || "");

        if (
          isRealActiveRequest &&
          emailReviewRequestId &&
          emailReviewRequestId.toLowerCase() !== activeRequestId.toLowerCase()
        ) {
          continue;
        }

        if (seenEmailReviewKeys.has(emailReviewKey)) {
          continue;
        }
        seenEmailReviewKeys.add(emailReviewKey);
      }

      dedupedRaw.push(item);
    }

    const flowQuestions = new Set(
      dedupedRaw
        .filter(
          (m) =>
            m?.flowType === "customer_request" ||
            isCustomerFlowQuestionText(extractMessageText(m))
        )
        .map((m) =>
          String(m?.question || extractMessageText(m) || "")
            .trim()
            .toLowerCase()
        )
        .filter(Boolean)
    );

    return dedupedRaw.filter((m, idx) => {
      const sender = extractMessageSender(m);
      const text = String(extractMessageText(m) || "").trim().toLowerCase();

      if (isSystemFlowMarkerText(text)) return false;

      if (isCustomerRequestStarterSession) {
        if (
          !m?.flowType &&
          (text === "create a new customer request" ||
            text === "select customer name" ||
            text === "select customer part name" ||
            text === "select customer part number" ||
            text === "select customer part name and number" ||
            text === "enter customer name" ||
            text === "enter customer part name" ||
            text === "enter customer part number")
        ) {
          return false;
        }
      }

      const hasAttachments =
        Array.isArray(m?.attachments) && m.attachments.length > 0;
      const hasArtifact = !!m?.artifact;
      const isFlowCard =
        m?.flowType === "customer_request" || isCustomerFlowQuestionText(text);
      const isEmail =
        !!m?.emailDraft || (sender === "bot" && looksLikeEmailDraft(text));

      const next = dedupedRaw[idx + 1];
      const prev = dedupedRaw[idx - 1];
      const nextQuestion = String(
        next?.question || extractMessageText(next) || ""
      )
        .trim()
        .toLowerCase();
      const prevQuestion = String(
        prev?.question || extractMessageText(prev) || ""
      )
        .trim()
        .toLowerCase();

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
  }, [chat?.messages, chat?.id, isCustomerRequestStarterSession, isActiveSupplierTaskSession]);

  const normalizedMessages = useMemo(
    () => normalize(cleanedMessages),
    [cleanedMessages, getPreferredCustomerEmail]
  );

  const activeSessionAssessmentMarkdown = useMemo(
    () => getAssessmentMarkdownFromSessionData(chat || {}),
    [chat]
  );

  const activeSupplierTaskForReview = useMemo(() => {
    if (!isActiveSupplierTaskSession) return null;

    const fromMessages = normalizedMessages
      .map((m) => m?.supplierTask)
      .find((task) => task && String(task?.taskId || "").trim());

    if (fromMessages) return fromMessages;

    const chatTaskLike = {
      ...(chat || {}),
      ...(chat?.supplierTask || {}),
      ...(chat?.task || {}),
      ...(chat?.taskItem || {}),
      ...(chat?.metadata || {}),
      sessionId: chat?.id,
      SessionId: chat?.id,
      taskId: chat?.id,
      TaskId: chat?.id,
    };

    return normalizeSupplierTask({ supplierTask: chatTaskLike });
  }, [isActiveSupplierTaskSession, normalizedMessages, chat]);

  const activeSupplierTaskReviewKey = useMemo(() => {
    return String(
      activeSupplierTaskForReview?.taskId ||
        activeSupplierTaskForReview?.TaskId ||
        chat?.id ||
        ""
    ).trim();
  }, [activeSupplierTaskForReview, chat?.id]);

  const activeSupplierTaskReviewMarkdown = useMemo(() => {
    if (!activeSupplierTaskReviewKey) return "";
    return String(supplierTaskReviewMarkdownByTaskId?.[activeSupplierTaskReviewKey] || "").trim();
  }, [supplierTaskReviewMarkdownByTaskId, activeSupplierTaskReviewKey]);

  useEffect(() => {
    // Important:
    // Engineer supplier review is now a real workflow card loaded from the
    // Supplier Task data, not a normal AI chat prompt.
    //
    // Previously this effect sent:
    // "show my pending task for supplier task ... with uploaded documents"
    // to /chat. Bedrock then replied with the generic
    // "I do not have capability..." message after 1-2 seconds.
    //
    // Keep this effect only as a cleanup guard so switching into/out of a
    // supplier task never triggers that old auto prompt again.
    if (!isEngineerProfile || !isActiveSupplierTaskSession) return;

    setSupplierTaskReviewLoadingKey((current) =>
      current === activeSupplierTaskReviewKey ? "" : current
    );
  }, [isEngineerProfile, isActiveSupplierTaskSession, activeSupplierTaskReviewKey]);

  const hasVisibleCustomerFlowCard = useMemo(() => {
    return normalizedMessages.some(
      (m) =>
        m?.flowType === "customer_request" ||
        isCustomerFlowQuestionText(extractMessageText(m))
    );
  }, [normalizedMessages]);

  const currentRequestStatus = useMemo(() => {
    const backendStatus = normalizeWorkflowStatus(currentRequestStatusOverride);
    const formStatus = normalizeWorkflowStatus(
      formDraft?.RequestStatus || formDraft?.requestStatus || ""
    );
    const messageStatus = extractCurrentRequestStatusFromMessages(normalizedMessages);
    const hasSupplierPending = hasSupplierPendingAssessmentSignal(normalizedMessages);

    // KC/FMD rule:
    // If supplier FMD task/email is created, assessment is still in progress.
    // Do not let an older REQUEST-CONFIRMED form/sidebar value keep the
    // fulfillment bar behind the actual workflow.
    if (
      hasSupplierPending &&
      (!backendStatus ||
        backendStatus === "REQUEST-CONFIRMED" ||
        backendStatus === "ASSESSMENT-TRIGGERED" ||
        backendStatus === "ASSESSMENT-COMPLETED")
    ) {
      return "ASSESSMENT-INPROGRESS";
    }

    // Priority:
    // 1) real status refreshed from backend/DynamoDB
    // 2) supplier pending signal from chat
    // 3) current form state
    // 4) fallback from chat messages
    return backendStatus || formStatus || messageStatus;
  }, [currentRequestStatusOverride, formDraft, normalizedMessages]);

  const shouldShowWorkflowFulfillmentBar = useMemo(() => {
    // Supplier task screen is not the customer request lifecycle screen.
    // Hide the right-side request fulfillment bar when supplier is logged into
    // a TSKS/TSKE task or when the loaded message is a supplier task card.
    if (isSupplierTaskSessionId(chat?.id)) return false;
    if (hasLoadedSupplierTaskMessage(normalizedMessages)) return false;

    return Boolean(currentRequestStatus);
  }, [chat?.id, currentRequestStatus, normalizedMessages]);


  const workflowSections = useMemo(() => {
    return WORKFLOW_STATUS_ORDER.map((status) => ({
      key: status,
      status,
      label: status
        .toLowerCase()
        .split("-")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" "),
      elementId: `workflow-${status}`,
    }));
  }, []);

  const workflowAnchorIdsByMessageIndex = useMemo(() => {
    const assigned = new Set();
    const anchorMap = {};

    normalizedMessages.forEach((message, index) => {
      const status = extractWorkflowStatusFromMessage(message);
      if (!status || assigned.has(status)) return;

      assigned.add(status);
      anchorMap[index] = `workflow-${status}`;
    });

    return anchorMap;
  }, [normalizedMessages]);

  useEffect(() => {
    visibleMessageCountRef.current = normalizedMessages.length;
  }, [normalizedMessages.length]);

  const computedFormInsertIndex = useMemo(() => {
    if (!showForm || !formDraft) return null;

    let lastPreparedFormIndex = -1;
    for (let i = 0; i < normalizedMessages.length; i += 1) {
      const text = extractMessageText(normalizedMessages[i]);
      if (isPreparedFormMessage(text)) {
        lastPreparedFormIndex = i;
      }
    }

    if (lastPreparedFormIndex >= 0) {
      return lastPreparedFormIndex + 1;
    }

    const firstReviewPromptIndex = normalizedMessages.findIndex((m) =>
      isReviewPromptMessage(extractMessageText(m))
    );
    if (firstReviewPromptIndex >= 0) {
      return firstReviewPromptIndex;
    }

    const firstEmailIndex = normalizedMessages.findIndex(
      (m) => !!m?.emailDraft
    );
    if (firstEmailIndex >= 0) {
      return firstEmailIndex;
    }

    return formInsertIndex === null ? normalizedMessages.length : formInsertIndex;
  }, [normalizedMessages, showForm, formDraft, formInsertIndex]);

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
    if (isActiveSupplierTaskSession) {
      setShowForm(false);
      setFormDraft(null);
      setFormSaveMsg("");
      setFormInsertIndex(null);
      return;
    }

    if (hasValidFormState(formState)) {
      const hydrated = buildCustomerRequestFormDraft(formState);

      setShowForm(true);
      setFormSaveMsg("");

      setFormDraft((prev) => {
        const prevStr = JSON.stringify(prev || {});
        const nextStr = JSON.stringify(hydrated || {});
        return prevStr === nextStr ? prev : hydrated;
      });

      setFormInsertIndex((prev) => {
        if (prev !== null) return prev;
        return getPersistedFormInsertIndex(chat?.messages || []);
      });

      return;
    }

    setShowForm(false);
    setFormDraft(null);
    setFormSaveMsg("");
    setFormInsertIndex(null);
  }, [formState, chat?.id, chat?.messages, isActiveSupplierTaskSession]);

  const pushLocalCustomerRequestSuggestion = useCallback(
    ({
      sessionId,
      requestId,
      customerName,
      customerPartName,
      customerPartNumber,
      requestStatus,
    }) => {
      const sid = String(sessionId || "").trim();
      if (!sid) return;

      const rid = String(requestId || "").trim();
      const partName = String(customerPartName || "").trim();
      const partNumber = String(customerPartNumber || "").trim();
      const customer = String(customerName || "").trim();
      const rawStatus = String(requestStatus || "REQUEST-CREATE").trim();

      const optimisticItem = {
        sessionId: sid,
        requestId: rid,
        title: partName || rid || sid,
        customerName: customer,
        customerPartName: partName,
        customerPartNumber: partNumber,
        requestStatus: rawStatus,
        rawRequestStatus: rawStatus,
        status: rawStatus,
        lastActivityAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        ageDays: 0,
        daysInState: 0,
        sourceType: "local_optimistic",
      };

      setLiveCustomerRequestSuggestions((prev) =>
        mergeUniqueRequestSuggestions([optimisticItem], prev)
      );
    },
    []
  );

  const AttachmentRow = ({ att }) => {
    const name = att.fileName || att.name || "file";
    const s3Key = att.s3Key;
    const fileType = att.fileType || att.mimeType || "application/octet-stream";
    const fileSize = att.fileSize ?? att.size ?? 0;

    const onDownload = async () => {
      try {
        const token = await getAccessToken();
        const sessionId = getActiveSessionId() || null;

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

    const artifact = msg.artifact || {};
    const artifactType = String(artifact?.type || artifact?.artifactType || "")
      .toLowerCase()
      .trim();
    const artifactTitle = String(artifact?.artifact_id || artifact?.title || "").trim();
    const artifactContent =
      typeof artifact?.content === "string" ? artifact.content.trim() : "";

    // Hide empty/generic backend artifact placeholders like
    // "Generated Artifact • text • permanent".
    // These are metadata-only artifacts and should not render as a visible card.
    if (!artifactContent) {
      return null;
    }

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

  const getBackendReplyText = (res = {}) => {
    const directCandidates = [
      res?.reply,
      res?.message,
      res?.answer,
      res?.text,
      res?.assistantText,
      res?.assistantReply,
      res?.chatReply,
      res?.statusMarkdown,
      res?.markdown,
      res?.output,
      res?.response,
      res?.result?.reply,
      res?.result?.message,
      res?.payload?.reply,
      res?.payload?.message,
      res?.data?.reply,
      res?.data?.message,
      res?.body?.reply,
      res?.body?.message,
    ];

    for (const value of directCandidates) {
      if (typeof value === "string" && value.trim()) {
        return value;
      }
    }

    if (typeof res?.body === "string" && res.body.trim()) {
      try {
        return getBackendReplyText(JSON.parse(res.body));
      } catch (e) {
        return res.body;
      }
    }

    return "";
  };

  const isStatusRequestText = (value = "") =>
    /\b(status|dashboard|monitoring)\b/i.test(String(value || ""));

  useEffect(() => {
    if (!isEngineerProfile || !isActiveSupplierTaskSession) return;

    const taskId = String(activeSupplierTaskReviewKey || getActiveSessionId() || "").trim();
    if (!taskId || !user?.email) return;

    // If this exact supplier-task review markdown is already loaded, do not call backend again.
    // Important: a stale fallback card can have supplierTask data but 0 uploaded documents;
    // that must NOT block this backend load, because the task store may now contain uploads.
    const existingReviewMarkdown = String(
      supplierTaskReviewMarkdownByTaskId?.[taskId] || ""
    ).trim();

    const alreadyHasLoadedTaskWithDocs = normalizedMessages.some((m) => {
      const existingTaskId = String(
        m?.supplierTask?.taskId ||
          m?.supplierTask?.TaskId ||
          m?.artifact?.taskId ||
          m?.artifact?.TaskId ||
          ""
      ).trim();

      if (existingTaskId !== taskId) return false;

      const docs = normalizeSupplierUploadedDocuments(
        m?.supplierTask || m?.artifact || m || {}
      );

      return docs.length > 0;
    });

    if (existingReviewMarkdown || alreadyHasLoadedTaskWithDocs) return;
    if (supplierTaskAutoLoadedRef.current.has(taskId)) return;

    let cancelled = false;
    supplierTaskAutoLoadedRef.current.add(taskId);

    const loadSupplierTaskReview = async () => {
      try {
        setSupplierTaskReviewLoadingKey(taskId);
        const token = await getAccessToken();

        // Silent workflow load: engineer should not type anything in Supplier Task section.
        // Backend handles this as a supplier-task workflow route and must not send it to Bedrock.
        const res = await sendChatMessage(
          taskId,
          "__LOAD_SUPPLIER_TASK_REVIEW__",
          user.email,
          token,
          [],
          false
        );

        if (cancelled) return;

        const rawReplyText = getBackendReplyText(res) || "";
        const replyText = isSupplierTaskGenericNoAccessReplyText(rawReplyText)
          ? ""
          : rawReplyText || "Supplier task loaded.";

        // Store the exact same markdown summary used in the Customer Request flow,
        // so the top Supplier Task card immediately shows uploaded documents +
        // download/preview buttons without the engineer typing anything.
        if (replyText) {
          setSupplierTaskReviewMarkdownByTaskId((prev) => ({
            ...(prev || {}),
            [taskId]: replyText,
          }));
        }

        const artifact =
          res?.artifact ||
          res?.Artifact ||
          res?.payload?.artifact ||
          res?.data?.artifact ||
          {
            type: "supplier_task",
            taskId,
            taskItem: res?.supplierTask || res?.taskItem || {},
            uploadedDocuments:
              res?.uploadedDocuments ||
              res?.supplierUploadedDocuments ||
              [],
          };

        const taskItem =
          res?.supplierTask ||
          res?.taskItem ||
          artifact?.taskItem ||
          artifact?.TaskItem ||
          {};

        const uploadedDocuments =
          res?.uploadedDocuments ||
          res?.supplierUploadedDocuments ||
          artifact?.uploadedDocuments ||
          artifact?.supplierUploadedDocuments ||
          [];

        const hasUsefulSupplierPayload =
          normalizeSupplierUploadedDocuments({
            ...(artifact || {}),
            taskItem,
            uploadedDocuments,
            supplierUploadedDocuments: uploadedDocuments,
          }).length > 0 ||
          String(artifact?.type || "").toLowerCase() === "supplier_task" ||
          Boolean(res?.supplierTask || res?.taskItem);

        if (replyText || hasUsefulSupplierPayload) {
          addMessage({
            id: `engineer-supplier-review-${taskId}-${Date.now()}`,
            sender: "bot",
            role: "assistant",
            text: replyText || "Supplier task loaded.",
            artifact,
            supplierTask: {
              ...(artifact || {}),
              type: "supplier_task",
              taskId,
              TaskId: taskId,
              taskItem,
              uploadedDocuments,
              supplierUploadedDocuments: uploadedDocuments,
            },
          });
        }
      } catch (e) {
        console.error("Auto-load supplier task review failed:", e);
        supplierTaskAutoLoadedRef.current.delete(taskId);
      } finally {
        if (!cancelled) {
          setSupplierTaskReviewLoadingKey((current) =>
            current === taskId ? "" : current
          );
        }
      }
    };

    loadSupplierTaskReview();

    return () => {
      cancelled = true;
    };
  }, [
    isEngineerProfile,
    isActiveSupplierTaskSession,
    activeSupplierTaskReviewKey,
    user?.email,
    normalizedMessages,
    supplierTaskReviewMarkdownByTaskId,
    getActiveSessionId,
  ]);

  const adoptSessionFromResponse = async (res, fallbackSessionId) => {
    return adoptSessionFromResponseSafely(res, fallbackSessionId);
  };

  const handleSearchExistingCustomerRequests = useCallback(
    async (query = "", statusFilter = "ALL") => {
      if (!user?.email) return;

      const seq = Date.now() + Math.random();
      customerRequestSearchSeqRef.current = seq;
      setExistingRequestsLoading(true);

      try {
        const token = await getAccessToken();
        const res = await searchCustomerRequests(token, query, statusFilter);

        if (customerRequestSearchSeqRef.current !== seq) return;

        const items = Array.isArray(res?.items) ? res.items : [];
        setLiveCustomerRequestSuggestions((prev) =>
          mergeUniqueRequestSuggestions(items, prev)
        );
      } catch (e) {
        console.error("Customer request search failed:", e);
      } finally {
        if (customerRequestSearchSeqRef.current === seq) {
          setExistingRequestsLoading(false);
        }
      }
    },
    [user?.email]
  );

  const getWorkflowStatusFromCustomerRequestItem = useCallback((item = {}) => {
    return normalizeWorkflowStatus(
      item?.requestStatus ||
        item?.RequestStatus ||
        item?.rawRequestStatus ||
        item?.RawRequestStatus ||
        item?.status ||
        item?.Status ||
        item?.workflowState ||
        item?.WorkflowState ||
        ""
    );
  }, []);

  const getWorkflowStatusFromApiResponse = useCallback(
    (res = {}) => {
      const directStatus = normalizeWorkflowStatus(
        res?.requestStatus ||
          res?.RequestStatus ||
          res?.currentStatus ||
          res?.CurrentStatus ||
          res?.status ||
          res?.Status ||
          res?.workflowState ||
          res?.WorkflowState ||
          res?.item?.RequestStatus ||
          res?.item?.requestStatus ||
          res?.request?.RequestStatus ||
          res?.request?.requestStatus ||
          ""
      );

      if (directStatus) return directStatus;

      const items = Array.isArray(res?.items)
        ? res.items
        : Array.isArray(res?.Items)
        ? res.Items
        : [];

      for (const item of items) {
        const status = getWorkflowStatusFromCustomerRequestItem(item);
        if (status) return status;
      }

      return "";
    },
    [getWorkflowStatusFromCustomerRequestItem]
  );

  const refreshActiveRequestStatus = useCallback(async () => {
    const workingSessionId = getActiveSessionId();

    if (!isCustomerRequestSession(workingSessionId) || !user?.email) {
      return "";
    }

    const activeRequestId = extractRequestIdFromSessionId(workingSessionId);
    if (!activeRequestId) return "";

    try {
      const token = await getAccessToken();
      const res = await searchCustomerRequests(token, activeRequestId, "ALL");

      const items = Array.isArray(res?.items)
        ? res.items
        : Array.isArray(res?.Items)
        ? res.Items
        : [];

      const matchedItem =
        items.find((item) => {
          const itemSessionId = String(
            item?.sessionId || item?.SessionId || ""
          ).trim();
          const itemRequestId = String(
            item?.requestId || item?.RequestId || ""
          ).trim();

          return (
            itemRequestId === activeRequestId ||
            extractRequestIdFromSessionId(itemSessionId) === activeRequestId ||
            itemSessionId.includes(activeRequestId)
          );
        }) || items[0];

      const status = getWorkflowStatusFromCustomerRequestItem(matchedItem);

      if (status) {
        setCurrentRequestStatusOverride(status);

        setLiveCustomerRequestSuggestions((prev) =>
          mergeUniqueRequestSuggestions(
            [
              {
                ...(matchedItem || {}),
                sessionId: matchedItem?.sessionId || matchedItem?.SessionId || workingSessionId,
                requestId: matchedItem?.requestId || matchedItem?.RequestId || activeRequestId,
                requestStatus: status,
                rawRequestStatus: status,
                status,
                lastActivityAt: new Date().toISOString(),
              },
            ],
            prev
          )
        );
      }

      return status;
    } catch (e) {
      console.warn("Failed to refresh active request status:", e);
      return "";
    }
  }, [
    getActiveSessionId,
    getWorkflowStatusFromCustomerRequestItem,
    isCustomerRequestSession,
    user?.email,
  ]);

  useEffect(() => {
    const workingSessionId = getActiveSessionId();

    if (!isCustomerRequestSession(workingSessionId)) {
      setCurrentRequestStatusOverride("");
      return undefined;
    }

    refreshActiveRequestStatus();

    const timer = window.setInterval(() => {
      refreshActiveRequestStatus();
    }, 15000);

    return () => window.clearInterval(timer);
  }, [chat?.id, getActiveSessionId, isCustomerRequestSession, refreshActiveRequestStatus]);

  const handleFileSelect = async (file) => {
    const currentChatId = getActiveSessionId();
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

  const buildNormalizedFormPayload = (draftOverride = null) => {
    const baseDraft = draftOverride || formDraft || {};

    const activeSessionId = getActiveSessionId();
    const activeRequestId = extractRequestIdFromSessionId(activeSessionId);

    const normalizedPayload = {
      RequestId: activeRequestId || baseDraft.RequestId || "",
      SessionId: activeSessionId || baseDraft.SessionId || "",
      CustomerName: baseDraft.CustomerName || "",
      CustomerPartName: baseDraft.CustomerPartName || "",
      CustomerPartNumber: baseDraft.CustomerPartNumber || "",
      RequestName: baseDraft.RequestName || baseDraft.title || "",
      RequestDescription: baseDraft.RequestDescription || "",
      RequestType: baseDraft.RequestType || "",
      RequestCompletionDateTime:
        baseDraft.RequestCompletionDateTime || baseDraft.RequestCompletionDate || "",
      RequestCompletionDate:
        baseDraft.RequestCompletionDate || baseDraft.RequestCompletionDateTime || "",
      RequestPriority: baseDraft.RequestPriority || "Medium",
      RequestorMethod: baseDraft.RequestorMethod || "EMAIL",
      RequestorContent:
        baseDraft.RequestorContent || baseDraft.RequestDescription || "",
      RequestConfirmationEmail: baseDraft.RequestConfirmationEmail || "",
      NotifyCustomer: Boolean(baseDraft.NotifyCustomer),
      CustomerEmail: baseDraft.CustomerEmail || baseDraft.CustomerContactEmailId || "",
      CustomerContactEmailId:
        baseDraft.CustomerContactEmailId || baseDraft.CustomerEmail || "",
      EmailFrom: CUSTOMER_REQUEST_FROM_EMAIL,
    };

    const visibleFieldValues = {};

    if (Array.isArray(baseDraft.fields)) {
      for (const f of baseDraft.fields) {
        if (f?.key) {
          const nextValue = f.value ?? "";
          normalizedPayload[f.key] = nextValue;
          visibleFieldValues[f.key] = nextValue;
        }
      }
    }

    // IMPORTANT:
    // In the Request Changes flow, the engineer edits the visible form fields.
    // Those visible field values must be the final source of truth for every
    // editable value before saving/generating the revised customer email.
    const latestCustomerName = String(
      visibleFieldValues.CustomerName ?? normalizedPayload.CustomerName ?? ""
    ).trim();

    const latestCustomerPartName = String(
      visibleFieldValues.CustomerPartName ?? normalizedPayload.CustomerPartName ?? ""
    ).trim();

    const latestCustomerPartNumber = String(
      visibleFieldValues.CustomerPartNumber ?? normalizedPayload.CustomerPartNumber ?? ""
    ).trim();

    const latestRequestName = String(
      visibleFieldValues.RequestName ?? normalizedPayload.RequestName ?? ""
    ).trim();

    const latestRequestType = String(
      visibleFieldValues.RequestType ?? normalizedPayload.RequestType ?? ""
    ).trim();

    const latestRequestDescription = String(
      visibleFieldValues.RequestDescription ??
        normalizedPayload.RequestDescription ??
        ""
    ).trim();

    const latestRequestPriority = String(
      visibleFieldValues.RequestPriority ?? normalizedPayload.RequestPriority ?? "Medium"
    ).trim();

    const latestVisibleCompletionDate = String(
      visibleFieldValues.RequestCompletionDate ??
        normalizedPayload.RequestCompletionDate ??
        normalizedPayload.RequestCompletionDateTime ??
        ""
    ).trim();

    const latestCustomerEmail = String(
      visibleFieldValues.CustomerEmail ??
        normalizedPayload.CustomerEmail ??
        normalizedPayload.CustomerContactEmailId ??
        ""
    ).trim();

    const latestNotifyCustomer =
      visibleFieldValues.NotifyCustomer !== undefined
        ? Boolean(visibleFieldValues.NotifyCustomer)
        : Boolean(normalizedPayload.NotifyCustomer);

    normalizedPayload.CustomerName = latestCustomerName;
    normalizedPayload.CustomerPartName = latestCustomerPartName;
    normalizedPayload.CustomerPartNumber = latestCustomerPartNumber;
    normalizedPayload.RequestName = latestRequestName;
    normalizedPayload.RequestType = latestRequestType;
    normalizedPayload.RequestDescription = latestRequestDescription;
    normalizedPayload.RequestPriority = latestRequestPriority || "Medium";

    // Keep both date fields synced with the latest edited visible value.
    normalizedPayload.RequestCompletionDate = latestVisibleCompletionDate;
    normalizedPayload.RequestCompletionDateTime = latestVisibleCompletionDate;

    normalizedPayload.NotifyCustomer = latestNotifyCustomer;
    normalizedPayload.CustomerEmail = latestCustomerEmail;
    normalizedPayload.CustomerContactEmailId = latestCustomerEmail;
    normalizedPayload.EmailFrom = CUSTOMER_REQUEST_FROM_EMAIL;

    normalizedPayload.RequestorMethod =
      normalizedPayload.RequestorMethod || "EMAIL";
    normalizedPayload.RequestorContent =
      latestRequestDescription || normalizedPayload.RequestorContent || "";

    // Re-apply after fields loop so a stale form field cannot overwrite it.
    normalizedPayload.RequestId = activeRequestId || normalizedPayload.RequestId || "";
    normalizedPayload.SessionId = activeSessionId || normalizedPayload.SessionId || "";

    normalizedPayload.CustomerPart = `${normalizedPayload.CustomerPartNumber || ""}#${normalizedPayload.CustomerPartName || ""}`.replace(/^#|#$/g, "");

    normalizedPayload.RequestDetail = {
      RequestName: normalizedPayload.RequestName || "",
      RequestDescription: normalizedPayload.RequestDescription || "",
      RequestType: normalizedPayload.RequestType || "",
      RequestPriority: normalizedPayload.RequestPriority || "Medium",
      RequestCompletionDateTime: normalizedPayload.RequestCompletionDateTime || "",
      RequestorMethod: normalizedPayload.RequestorMethod || "EMAIL",
      RequestorContent: normalizedPayload.RequestorContent || "",
      RequestConfirmationEmail: normalizedPayload.RequestConfirmationEmail || "",
    };

    normalizedPayload.CustomerDetail = {
      CustomerPartNumber: normalizedPayload.CustomerPartNumber || "",
      CustomerPartName: normalizedPayload.CustomerPartName || "",
      CustomerContactEmailId: normalizedPayload.CustomerEmail || "",
    };

    return normalizedPayload;
  };

  const handleSaveForm = async () => {
    if (!formDraft || !user?.email) return;

    setSavingForm(true);
    setFormSaveMsg("");

    try {
      const token = await getAccessToken();

      const workingSessionId = getActiveSessionId();
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
        RequestId:
          extractRequestIdFromSessionId(workingSessionId) ||
          formDraft?.RequestId ||
          res?.requestId ||
          res?.RequestId ||
          "",
        SessionId: workingSessionId,
      });

      setFormDraft(nextSavedDraft);
      onFormStateChange?.(workingSessionId, nextSavedDraft);

      pushLocalCustomerRequestSuggestion({
        sessionId: res?.newSessionId || res?.sessionId || workingSessionId,
        requestId: nextSavedDraft?.RequestId || res?.requestId || "",
        customerName: nextSavedDraft?.CustomerName || "",
        customerPartName: nextSavedDraft?.CustomerPartName || "",
        customerPartNumber: nextSavedDraft?.CustomerPartNumber || "",
        requestStatus: "REQUEST-CREATE",
      });

      await adoptSessionFromResponse(res, workingSessionId);
    } catch (e) {
      console.error("Form save failed:", e);
      const msg = e?.message || "Save failed";
      setFormSaveMsg(`❌ ${msg}`);
    } finally {
      setSavingForm(false);
    }
  };

  const handleGenerateEmailDraftFromForm = useCallback(
    async (draftOverride = null, options = {}) => {
      if (!user?.email) return;

      const { silentPrompt = false } = options;

      try {
        setGeneratingEmailDraft(true);
        setFormSaveMsg("");

        const token = await getAccessToken();
        const workingSessionId = getActiveSessionId();
        const normalizedPayload = buildNormalizedFormPayload(draftOverride);

        const requestBody = {
          session: {
            SessionId: workingSessionId,
          },
          payload: normalizedPayload,
        };

        const saveRes = await saveGeneratedForm(requestBody, token);

        const nextSavedDraft = buildCustomerRequestFormDraft({
          ...(draftOverride || formDraft || {}),
          ...normalizedPayload,
          RequestId:
            extractRequestIdFromSessionId(workingSessionId) ||
            draftOverride?.RequestId ||
            formDraft?.RequestId ||
            saveRes?.requestId ||
            saveRes?.RequestId ||
            "",
          SessionId: workingSessionId,
        });

        setFormDraft(nextSavedDraft);
        onFormStateChange?.(workingSessionId, nextSavedDraft);

        pushLocalCustomerRequestSuggestion({
          sessionId: saveRes?.newSessionId || saveRes?.sessionId || workingSessionId,
          requestId: nextSavedDraft?.RequestId || saveRes?.requestId || "",
          customerName: nextSavedDraft?.CustomerName || "",
          customerPartName: nextSavedDraft?.CustomerPartName || "",
          customerPartNumber: nextSavedDraft?.CustomerPartNumber || "",
          requestStatus: "REQUEST-CREATE",
        });

        const adoptedSessionId = await adoptSessionFromResponse(
          saveRes,
          workingSessionId
        );

        const activeSessionId = adoptedSessionId || workingSessionId;

        if (!silentPrompt) {
          addMessage({
            sender: "bot",
            role: "assistant",
            text:
              "Would you like me to generate a professional customer email draft for this request? You can review and edit it before sending.",
          });
        }

        const draftRes = await sendChatMessage(
          activeSessionId,
          "generate email draft",
          user.email,
          token,
          [],
          false
        );

        await adoptSessionFromResponse(draftRes, activeSessionId);

        let artifact = draftRes?.artifact || draftRes?.Artifact || draftRes?.payload?.artifact || null;
        let replyText = getBackendReplyText(draftRes);

        if (!artifact) {
          const parsed = tryParseArtifact(replyText);
          artifact = parsed.artifact || null;
          replyText = parsed.replyText || "";
        }

        const lockedArtifact = lockArtifactToSession(
          artifact,
          activeSessionId,
          nextSavedDraft
        );
        const lockedEmailDraft = lockEmailDraftToSession(
          draftRes?.emailDraft || null,
          activeSessionId,
          nextSavedDraft
        );
        const lockedReplyText = lockReplyTextSubjectToSession(
          replyText,
          activeSessionId,
          nextSavedDraft
        );

        addMessage({
          sender: "bot",
          role: "assistant",
          text: lockedReplyText || "Email draft generated successfully.",
          artifact: lockedArtifact,
          emailDraft: lockedEmailDraft,
          toEmail:
            draftRes?.toEmail ||
            lockedEmailDraft?.to ||
            lockedArtifact?.to ||
            "",
        });

        setFormSaveMsg("✅ Email draft generated");
      } catch (e) {
        console.error("Generate email draft failed:", e);
        const msg = e?.message || "Failed to generate email draft";
        setFormSaveMsg(`❌ ${msg}`);
        addMessage({
          sender: "bot",
          role: "assistant",
          text: `❌ ${msg}`,
        });
      } finally {
        setGeneratingEmailDraft(false);
      }
    },
    [user?.email, chat?.id, formDraft, onFormStateChange, pushLocalCustomerRequestSuggestion, getActiveSessionId]
  );

  const pushFlowMessageFromResponse = (res) => {
    const flowMsg = buildCustomerFlowMessageFromResponse(res);
    if (!flowMsg) return false;
    addMessage(flowMsg);
    return true;
  };

  const handleStartNewCustomerRequest = async () => {
    if (isStartingCustomerRequest || isTyping) return;

    try {
      const currentChatId = getActiveSessionId();
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

      const didPushFlow = pushFlowMessageFromResponse({
        ...res,
        sessionId: workingSessionId,
      });

      if (!didPushFlow) {
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
      const currentChatId = getActiveSessionId();
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

      const didPushFlow = pushFlowMessageFromResponse({
        ...res,
        sessionId: workingSessionId,
      });

      if (didPushFlow) {
        return;
      }

      if (res?.formState) {
        const hydrated = buildCustomerRequestFormDraft({
          ...res.formState,
          RequestId:
            res?.formState?.RequestId || res?.requestId || res?.RequestId || "",
        });

        addMessage({
          sender: "bot",
          role: "assistant",
          text: res?.reply || "I have prepared the customer request form.",
        });

        pushLocalCustomerRequestSuggestion({
          sessionId: workingSessionId,
          requestId: hydrated?.RequestId || res?.requestId || "",
          customerName: hydrated?.CustomerName || "",
          customerPartName: hydrated?.CustomerPartName || "",
          customerPartNumber: hydrated?.CustomerPartNumber || "",
          requestStatus: "REQUEST-CREATE",
        });

        openFormInline(hydrated, { afterNextMessage: true });
        onFormStateChange?.(workingSessionId, hydrated);
        await refreshSidebar?.();
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

        const existingDraft = normalizeEmailDraft(
          m,
          text,
          getPreferredCustomerEmail(m)
        );

        if (existingDraft && idx === prev.length - 1) {
          return {
            ...m,
            emailDraft: {
              ...draft,
              to: draft?.to || existingDraft?.to || getPreferredCustomerEmail(m),
              from: draft?.from || existingDraft?.from || CUSTOMER_REQUEST_FROM_EMAIL,
              isSupplierEmail:
                Boolean(draft?.isSupplierEmail) ||
                Boolean(existingDraft?.isSupplierEmail),
              kind:
                draft?.kind ||
                existingDraft?.kind ||
                (draft?.isSupplierEmail || existingDraft?.isSupplierEmail
                  ? "supplier_fmd_request"
                  : "customer_request_email"),
              emailKind:
                draft?.emailKind ||
                existingDraft?.emailKind ||
                (draft?.isSupplierEmail || existingDraft?.isSupplierEmail
                  ? "supplier_fmd_request"
                  : "customer_request_email"),
            },
          };
        }
        return m;
      })
    );
  };

  const handleSupplierTaskUpdated = useCallback(
    async (res = {}) => {
      const updatedTask =
        res?.supplierTask ||
        res?.task ||
        res?.item ||
        res?.taskItem ||
        null;

      const taskId = String(
        updatedTask?.TaskId ||
          updatedTask?.taskId ||
          res?.taskId ||
          res?.TaskId ||
          ""
      ).trim();

      if (taskId) {
        supplierTaskAutoLoadedRef.current.delete(taskId);

        const replyText = getBackendReplyText(res);
        if (replyText) {
          setSupplierTaskReviewMarkdownByTaskId((prev) => ({
            ...(prev || {}),
            [taskId]: replyText,
          }));
        }

        updateMessages((prev) =>
          (prev || []).map((m) => {
            const currentTask = normalizeSupplierTask(m);
            if (!currentTask || String(currentTask.taskId || "").trim() !== taskId) {
              return m;
            }

            const mergedArtifact = {
              ...(m.artifact || {}),
              type: "supplier_task",
              taskItem: updatedTask || currentTask.taskItem || {},
              taskId,
              taskStatus:
                updatedTask?.TaskStatus ||
                updatedTask?.taskStatus ||
                res?.taskStatus ||
                res?.TaskStatus ||
                currentTask.taskStatus,
            };

            return {
              ...m,
              artifact: mergedArtifact,
              supplierTask: normalizeSupplierTask({
                ...m,
                artifact: mergedArtifact,
                supplierTask: {
                  ...(m.supplierTask || {}),
                  taskItem: updatedTask || currentTask.taskItem || {},
                },
              }),
            };
          })
        );
      }

      await refreshSidebar?.();
    },
    [updateMessages, refreshSidebar]
  );


  const resolveEmailAttachmentReportPath = (file = {}) => {
    return String(
      file?.s3Path ||
        file?.reportS3Path ||
        file?.assessmentReportS3Path ||
        file?.attachmentS3Path ||
        file?.reportPublishedFilePath ||
        ""
    ).trim();
  };

  const handlePreviewEmailAttachment = async (file = {}) => {
    try {
      const reportS3Path = resolveEmailAttachmentReportPath(file);
      if (!reportS3Path) {
        throw new Error("Attachment PDF path is missing.");
      }

      const token = await getAccessToken();
      const res = await presignAssessmentReportPdf(
        {
          sessionId: getActiveSessionId(),
          userId: user?.email,
          requestId:
            file?.requestId ||
            file?.RequestId ||
            extractRequestIdFromSessionId(getActiveSessionId()),
          reportS3Path,
        },
        token
      );

      const url = res?.previewUrl || res?.downloadUrl || res?.url || "";
      if (!url) throw new Error("PDF URL was not returned by backend.");
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      console.error("Email attachment preview failed:", e);
      addMessage({
        sender: "bot",
        role: "assistant",
        text: `❌ ${e?.message || "Attachment preview failed"}`,
      });
    }
  };

  const handleDownloadEmailAttachment = async (file = {}) => {
    try {
      const reportS3Path = resolveEmailAttachmentReportPath(file);
      if (!reportS3Path) {
        throw new Error("Attachment PDF path is missing.");
      }

      const token = await getAccessToken();
      const res = await presignAssessmentReportPdf(
        {
          sessionId: getActiveSessionId(),
          userId: user?.email,
          requestId:
            file?.requestId ||
            file?.RequestId ||
            extractRequestIdFromSessionId(getActiveSessionId()),
          reportS3Path,
        },
        token
      );

      const url = res?.downloadUrl || res?.previewUrl || res?.url || "";
      if (!url) throw new Error("PDF URL was not returned by backend.");

      const a = document.createElement("a");
      a.href = url;
      a.download =
        res?.fileName ||
        file?.fileName ||
        file?.FileName ||
        fileNameFromS3Path(reportS3Path);
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      console.error("Email attachment download failed:", e);
      addMessage({
        sender: "bot",
        role: "assistant",
        text: `❌ ${e?.message || "Attachment download failed"}`,
      });
    }
  };


  const handleSendEmailDraft = async (draft) => {
    try {
      const to = String(draft?.to || "").trim();
      const workingSessionId = getActiveSessionId();
      const isSupplierDraft =
        Boolean(draft?.isSupplierEmail) || isSupplierEmailDraft(draft);

      const lockedDraft = isSupplierDraft
        ? draft
        : lockEmailDraftToSession(draft, workingSessionId, formDraft);

      const subject = String(lockedDraft?.subject || "").trim();
      const originalBody = String(lockedDraft?.body || draft?.body || "").trim();
      const requestId =
        extractRequestIdFromSessionId(workingSessionId) || formDraft?.RequestId || "";

      const customerPart = `${formDraft?.CustomerPartNumber || extractPartNumberFromSessionId(workingSessionId) || ""}#${formDraft?.CustomerPartName || extractPartNameFromSessionId(workingSessionId) || ""}`.replace(/^#|#$/g, "");

      const isAssessmentReportEmail =
        String(lockedDraft?.emailKind || lockedDraft?.kind || "").trim() ===
          "assessment_report_customer_email" || Boolean(lockedDraft?.attachAssessmentPdf);

      const compactEmailBody = isSupplierDraft || isAssessmentReportEmail
        ? ""
        : buildCompactCustomerEmailBody({
            requestId,
            customerName: formDraft?.CustomerName || "",
            customerPart,
            requestName: formDraft?.RequestName || formDraft?.title || "Customer Request",
            requestDescription: formDraft?.RequestDescription || originalBody || "",
            requestType: formDraft?.RequestType || "",
            requestPriority: formDraft?.RequestPriority || "Medium",
            requestCompletionDateTime:
              formDraft?.RequestCompletionDateTime || formDraft?.RequestCompletionDate || "",
            engineeringContactEmailId: user?.email || "",
          });

      const body = isSupplierDraft || isAssessmentReportEmail ? originalBody : compactEmailBody || originalBody;
      const confirmationMarkdown = body;

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

      const res = await sendCustomerEmail(
        {
          sessionId: workingSessionId,
          userId: user?.email,
          to,
          from: lockedDraft?.from || CUSTOMER_REQUEST_FROM_EMAIL,
          subject,
          body,
          requestId,
          RequestConfirmationEmail: confirmationMarkdown,
          emailKind: isSupplierDraft
            ? "supplier_fmd_request"
            : lockedDraft?.emailKind || lockedDraft?.kind || "customer_request_email",
          isSupplierEmail: isSupplierDraft,
          attachAssessmentPdf: Boolean(lockedDraft?.attachAssessmentPdf),
          reportS3Path: lockedDraft?.reportS3Path || lockedDraft?.assessmentReportS3Path || "",
          assessmentReportS3Path: lockedDraft?.assessmentReportS3Path || lockedDraft?.reportS3Path || "",
          attachmentFileName: lockedDraft?.attachmentFileName || "",
          attachments: Array.isArray(lockedDraft?.attachments) ? lockedDraft.attachments : [],
        },
        token
      );

      const emailStatus = isSupplierDraft
        ? normalizeWorkflowStatus("ASSESSMENT-INPROGRESS")
        : getWorkflowStatusFromApiResponse(res) || normalizeWorkflowStatus("REQUEST-REVIEW");

      if (emailStatus) {
        setCurrentRequestStatusOverride(emailStatus);
      }

      addMessage({
        sender: "bot",
        role: "assistant",
        text:
          res?.reply ||
          (isSupplierDraft
            ? `✅ Supplier email sent successfully to ${to}.`
            : `✅ Email sent successfully to ${to}. Status moved to REQUEST-REVIEW.`),
        RequestStatus: emailStatus,
        requestStatus: emailStatus,
      });

      if (!isSupplierDraft) {
        pushLocalCustomerRequestSuggestion({
          sessionId: res?.sessionId || workingSessionId,
          requestId: res?.requestId || formDraft?.RequestId || "",
          customerName: formDraft?.CustomerName || "",
          customerPartName: formDraft?.CustomerPartName || "",
          customerPartNumber: formDraft?.CustomerPartNumber || "",
          requestStatus: emailStatus,
        });

        await refreshActiveRequestStatus();
      }

      await refreshSidebar?.();
    } catch (e) {
      console.error("Send email failed:", e);
      addMessage({
        sender: "bot",
        role: "assistant",
        text: `❌ ${e?.message || "Failed to send email"}`,
      });
    }
  };

  const handleProcessCustomerReply = async () => {
    try {
      const emailSubject = String(customerReplySubject || "").trim();
      const emailBody = String(customerReplyBody || "").trim();

      if (!emailSubject && !emailBody) {
        return;
      }

      setProcessingCustomerReply(true);

      const token = await getAccessToken();
      const workingSessionId = getActiveSessionId();

      const res = await processCustomerReply(
        {
          sessionId: workingSessionId,
          userId: user?.email,
          emailSubject,
          emailBody,
        },
        token
      );

      const replyStatus =
        getWorkflowStatusFromApiResponse(res) ||
        normalizeWorkflowStatus(res?.confirmed ? "REQUEST-CONFIRMED" : "REQUEST-REVIEW");
      setCurrentRequestStatusOverride(replyStatus);

      addMessage({
        sender: "bot",
        role: "assistant",
        text:
          res?.reply ||
          (res?.confirmed
            ? "✅ Customer reply processed. Status moved to REQUEST-CONFIRMED."
            : "ℹ️ Customer reply processed, but it was not classified as confirmation."),
        RequestStatus: replyStatus,
        requestStatus: replyStatus,
      });

      pushLocalCustomerRequestSuggestion({
        sessionId: res?.sessionId || workingSessionId,
        requestId: res?.requestId || formDraft?.RequestId || "",
        customerName: formDraft?.CustomerName || "",
        customerPartName: formDraft?.CustomerPartName || "",
        customerPartNumber: formDraft?.CustomerPartNumber || "",
        requestStatus: replyStatus,
      });

      await refreshSidebar?.();
      await refreshActiveRequestStatus();
      window.setTimeout(() => refreshActiveRequestStatus(), 2500);
      window.setTimeout(() => refreshActiveRequestStatus(), 6000);

      setShowCustomerReplyModal(false);
      setCustomerReplySubject("");
      setCustomerReplyBody("");
    } catch (e) {
      console.error("Process customer reply failed:", e);
      addMessage({
        sender: "bot",
        role: "assistant",
        text: `❌ ${e?.message || "Failed to process customer reply"}`,
      });
    } finally {
      setProcessingCustomerReply(false);
    }
  };

  const handleSubmitEmailReviewForAssessment = async () => {
    try {
      const workingSessionId = getActiveSessionId();
      if (!workingSessionId || !user?.email) return;

      const replyInfo = extractCustomerEmailReplyFromMessages(normalizedMessages);
      const emailSubject = replyInfo.subject || "Customer email reply";
      const emailBody = replyInfo.body || "Customer reply reviewed and approved by engineer.";

      setSubmittingEmailReview(true);

      const token = await getAccessToken();

      // Step 1: keep the existing email-review update.
      // This is NOT the old temporary assessment endpoint.
      // It only records that engineer accepted the customer reply.
      const reviewRes = await processCustomerReply(
        {
          sessionId: workingSessionId,
          userId: user?.email,
          emailSubject,
          emailBody,
          action: "SUBMIT_FOR_ASSESSMENT",
          askType: "EMAIL REVIEW",
        },
        token
      );

      const finalRequestId =
        reviewRes?.requestId ||
        reviewRes?.RequestId ||
        extractRequestIdFromSessionId(workingSessionId);

      const finalSessionId =
        reviewRes?.sessionId ||
        reviewRes?.SessionId ||
        workingSessionId;

      // Step 2: trigger the only assessment endpoint allowed by KC:
      // /fmd-assessment -> FMD Core Engine AgentCore runtime.
      // KC working payload:
      // WorkflowName, WorkflowRunId, WorkflowRunType=Full,
      // CustomerName, CustomerRequestId, ChatSessionId, ChatUserId,
      // DelegationCapacity, EngineeringPartKey.
      const fmdRes = await triggerFmdAssessment(
        {
          WorkflowName: "FMD",
          WorkflowRunId: makeKcWorkflowRunId(),
          WorkflowRunType: "Full",
          CustomerName: "General Motors",
          CustomerRequestId: finalRequestId,
          ChatSessionId: finalSessionId,
          ChatUserId: user?.email,
          DelegationCapacity: "3",
          EngineeringPartKey: "BRK-7700#High-Perf Brake Assy",
        },
        token
      );

      const assessmentSubmitStatus =
        getWorkflowStatusFromApiResponse(fmdRes) ||
        getWorkflowStatusFromApiResponse(reviewRes) ||
        normalizeWorkflowStatus("ASSESSMENT-INPROGRESS");

      setCurrentRequestStatusOverride(assessmentSubmitStatus);

      addMessage({
        sender: "bot",
        role: "assistant",
        text:
          fmdRes?.reply ||
          fmdRes?.message ||
          "✅ Email review completed and FMD Core Engine assessment triggered.",
        RequestStatus: assessmentSubmitStatus,
        requestStatus: assessmentSubmitStatus,
        artifact: {
          type: "fmd_assessment_result",
          requestId: finalRequestId,
          response: fmdRes,
        },
      });

      pushLocalCustomerRequestSuggestion({
        sessionId: finalSessionId,
        requestId: finalRequestId,
        customerName: formDraft?.CustomerName || "",
        customerPartName:
          formDraft?.CustomerPartName || extractPartNameFromSessionId(finalSessionId),
        customerPartNumber:
          formDraft?.CustomerPartNumber || extractPartNumberFromSessionId(finalSessionId),
        requestStatus: assessmentSubmitStatus,
      });

      await refreshSidebar?.();
      await refreshActiveRequestStatus();
      window.setTimeout(() => refreshActiveRequestStatus(), 2500);
      window.setTimeout(() => refreshActiveRequestStatus(), 6000);
    } catch (e) {
      console.error("Submit for FMD Core Engine assessment failed:", e);
      addMessage({
        sender: "bot",
        role: "assistant",
        text: `❌ ${e?.message || "Failed to submit request for FMD Core Engine assessment"}`,
      });
    } finally {
      setSubmittingEmailReview(false);
    }
  };

  const buildRequestChangeDraftFromItem = (item = {}, workingSessionId = "") => {
    const requestDetail =
      item?.RequestDetail ||
      item?.RequestDetails ||
      item?.requestDetail ||
      item?.requestDetails ||
      {};

    const customerDetail =
      item?.CustomerDetail ||
      item?.CustomerDetails ||
      item?.customerDetail ||
      item?.customerDetails ||
      {};

    const customerPartRaw = String(
      item?.CustomerPart || item?.customerPart || item?.customerPartKey || ""
    ).trim();

    const customerPartPieces = customerPartRaw.split("#");
    const customerPartNumberFromRaw = customerPartPieces[0] || "";
    const customerPartNameFromRaw = customerPartPieces.slice(1).join("#") || "";

    const activeRequestId = extractRequestIdFromSessionId(workingSessionId);

    return buildCustomerRequestFormDraft({
      ...(hasValidFormState(formState) ? formState : {}),
      ...(formDraft || {}),
      ...(item || {}),

      RequestId:
        item?.RequestId ||
        item?.requestId ||
        formDraft?.RequestId ||
        formState?.RequestId ||
        activeRequestId ||
        "",

      SessionId: workingSessionId,

      CustomerName:
        item?.CustomerName ||
        item?.customerName ||
        customerDetail?.CustomerName ||
        formDraft?.CustomerName ||
        formState?.CustomerName ||
        "",

      CustomerPartName:
        item?.CustomerPartName ||
        item?.customerPartName ||
        customerDetail?.CustomerPartName ||
        customerPartNameFromRaw ||
        formDraft?.CustomerPartName ||
        formState?.CustomerPartName ||
        extractPartNameFromSessionId(workingSessionId) ||
        "",

      CustomerPartNumber:
        item?.CustomerPartNumber ||
        item?.customerPartNumber ||
        customerDetail?.CustomerPartNumber ||
        customerPartNumberFromRaw ||
        formDraft?.CustomerPartNumber ||
        formState?.CustomerPartNumber ||
        extractPartNumberFromSessionId(workingSessionId) ||
        "",

      RequestName:
        item?.RequestName ||
        item?.requestName ||
        requestDetail?.RequestName ||
        formDraft?.RequestName ||
        formState?.RequestName ||
        "Customer Request",

      RequestType:
        item?.RequestType ||
        item?.requestType ||
        requestDetail?.RequestType ||
        formDraft?.RequestType ||
        formState?.RequestType ||
        "",

      RequestDescription:
        item?.RequestDescription ||
        item?.requestDescription ||
        requestDetail?.RequestDescription ||
        requestDetail?.RequestorContent ||
        formDraft?.RequestDescription ||
        formState?.RequestDescription ||
        "",

      RequestCompletionDateTime:
        item?.RequestCompletionDateTime ||
        item?.requestCompletionDateTime ||
        requestDetail?.RequestCompletionDateTime ||
        requestDetail?.RequestCompletionDate ||
        formDraft?.RequestCompletionDateTime ||
        formDraft?.RequestCompletionDate ||
        formState?.RequestCompletionDateTime ||
        formState?.RequestCompletionDate ||
        "",

      RequestCompletionDate:
        item?.RequestCompletionDate ||
        item?.requestCompletionDate ||
        requestDetail?.RequestCompletionDate ||
        requestDetail?.RequestCompletionDateTime ||
        formDraft?.RequestCompletionDate ||
        formDraft?.RequestCompletionDateTime ||
        formState?.RequestCompletionDate ||
        formState?.RequestCompletionDateTime ||
        "",

      RequestPriority:
        item?.RequestPriority ||
        item?.requestPriority ||
        requestDetail?.RequestPriority ||
        formDraft?.RequestPriority ||
        formState?.RequestPriority ||
        "Medium",

      RequestorMethod:
        item?.RequestorMethod ||
        item?.requestorMethod ||
        requestDetail?.RequestorMethod ||
        formDraft?.RequestorMethod ||
        formState?.RequestorMethod ||
        "EMAIL",

      RequestorContent:
        item?.RequestorContent ||
        item?.requestorContent ||
        requestDetail?.RequestorContent ||
        requestDetail?.RequestDescription ||
        formDraft?.RequestorContent ||
        formDraft?.RequestDescription ||
        formState?.RequestorContent ||
        formState?.RequestDescription ||
        "",

      RequestConfirmationEmail:
        item?.RequestConfirmationEmail ||
        item?.requestConfirmationEmail ||
        requestDetail?.RequestConfirmationEmail ||
        formDraft?.RequestConfirmationEmail ||
        formState?.RequestConfirmationEmail ||
        "",

      CustomerEmail:
        item?.CustomerEmail ||
        item?.customerEmail ||
        item?.CustomerContactEmailId ||
        item?.customerContactEmailId ||
        customerDetail?.CustomerContactEmailId ||
        customerDetail?.CustomerContactEmail ||
        formDraft?.CustomerEmail ||
        formDraft?.CustomerContactEmailId ||
        formState?.CustomerEmail ||
        formState?.CustomerContactEmailId ||
        "",

      CustomerContactEmailId:
        item?.CustomerContactEmailId ||
        item?.customerContactEmailId ||
        customerDetail?.CustomerContactEmailId ||
        customerDetail?.CustomerContactEmail ||
        formDraft?.CustomerContactEmailId ||
        formDraft?.CustomerEmail ||
        formState?.CustomerContactEmailId ||
        formState?.CustomerEmail ||
        "",

      NotifyCustomer: true,
      EmailFrom: CUSTOMER_REQUEST_FROM_EMAIL,
    });
  };

  const handleRequestChangesFromEmailReview = async () => {
    const workingSessionId = getActiveSessionId();
    const activeRequestId = extractRequestIdFromSessionId(workingSessionId);

    if (!workingSessionId || !activeRequestId || !user?.email) {
      addMessage({
        sender: "bot",
        role: "assistant",
        text: "❌ Unable to open request changes because the active request could not be resolved.",
      });
      return;
    }

    const replyInfo = extractCustomerEmailReplyFromMessages(normalizedMessages);
    const emailSubject = replyInfo.subject || "Customer email reply";
    const emailBody = replyInfo.body || "Customer requested changes before assessment.";

    let backendReply = "";
    let backendStatus = "EMAIL-REVIEW";
    let matchedRequestItem = null;

    try {
      setSubmittingEmailReview(true);

      const token = await getAccessToken();

      const res = await processCustomerReply(
        {
          sessionId: workingSessionId,
          userId: user?.email,
          emailSubject,
          emailBody,
          action: "REQUEST_CHANGES",
          askType: "EMAIL REVIEW",
          changeReason:
            emailBody ||
            "Customer requested changes before assessment. Engineer will update the request and resend a revised email.",
        },
        token
      );

      backendReply = res?.reply || "";
      backendStatus =
        getWorkflowStatusFromApiResponse(res) || normalizeWorkflowStatus("EMAIL-REVIEW");

      const searchRes = await searchCustomerRequests(token, activeRequestId, "ALL");
      const items = Array.isArray(searchRes?.items)
        ? searchRes.items
        : Array.isArray(searchRes?.Items)
        ? searchRes.Items
        : [];

      matchedRequestItem =
        items.find((item) => {
          const itemSessionId = String(item?.sessionId || item?.SessionId || "").trim();
          const itemRequestId = String(item?.requestId || item?.RequestId || "").trim();

          return (
            itemRequestId === activeRequestId ||
            extractRequestIdFromSessionId(itemSessionId) === activeRequestId ||
            itemSessionId.includes(activeRequestId)
          );
        }) || items[0] || null;

      setCurrentRequestStatusOverride(backendStatus);
    } catch (e) {
      console.error("Request changes action failed, opening local edit form:", e);
      backendReply = `⚠️ Request changes form opened locally, but backend change-request update failed: ${
        e?.message || "Unknown error"
      }`;
      backendStatus = normalizeWorkflowStatus("EMAIL-REVIEW");
      setCurrentRequestStatusOverride(backendStatus);
    } finally {
      setSubmittingEmailReview(false);
    }

    const nextDraft = buildRequestChangeDraftFromItem(
      matchedRequestItem || {},
      workingSessionId
    );

    addMessage({
      sender: "bot",
      role: "assistant",
      text:
        "I have prepared the customer request form. Please review and save.\n\n" +
        (backendReply ||
          "📝 Request changes selected. Update the request details/date/priority, then generate a revised email for the customer."),
      RequestStatus: backendStatus,
      requestStatus: backendStatus,
    });

    // Force the existing customer request form to render directly after the new
    // request-changes message. Without this, the persisted-form insert logic can
    // place the form near the old original form higher in the chat history.
    setShowForm(true);
    setFormDraft(nextDraft);
    setFormInsertIndex(visibleMessageCountRef.current + 1);
    setFormSaveMsg(
      "Update the request changes, then generate and send a revised customer email."
    );

    setTimeout(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    }, 80);

    onFormStateChange?.(workingSessionId, nextDraft);

    pushLocalCustomerRequestSuggestion({
      sessionId: workingSessionId,
      requestId: activeRequestId,
      customerName: nextDraft?.CustomerName || "",
      customerPartName:
        nextDraft?.CustomerPartName || extractPartNameFromSessionId(workingSessionId),
      customerPartNumber:
        nextDraft?.CustomerPartNumber || extractPartNumberFromSessionId(workingSessionId),
      requestStatus: backendStatus,
    });

    await refreshSidebar?.();
    await refreshActiveRequestStatus();
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

      const currentChatId = getActiveSessionId();
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

      const didPushFlow = pushFlowMessageFromResponse({
        ...res,
        sessionId: workingSessionId,
      });

      if (didPushFlow) {
        setPendingAttachments([]);
        return;
      }

      let artifact = res?.artifact || res?.Artifact || res?.payload?.artifact || null;
      let replyText = getBackendReplyText(res);

      if (!artifact) {
        const parsed = tryParseArtifact(replyText);
        artifact = parsed.artifact || null;
        replyText = parsed.replyText || "";
      }

      if (!replyText && isStatusRequestText(typedText)) {
        replyText =
          "⚠️ Status data was processed by backend, but the frontend could not read the reply text. Please check the /chat Network response shape.";
      }

      addMessage({
        sender: "bot",
        role: "assistant",
        text: replyText,
        artifact,
      });

      setTimeout(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
      }, 80);

      if (res?.formState) {
        const hydrated = buildCustomerRequestFormDraft({
          ...res.formState,
          RequestId:
            res?.formState?.RequestId || res?.requestId || res?.RequestId || "",
        });
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
    !isActiveSupplierTaskSession &&
    !isCustomerRequestStarterSession &&
    (!cleanedMessages || cleanedMessages.length === 0);

  const showInlineCustomerStarter =
    !isActiveSupplierTaskSession &&
    isCustomerRequestStarterSession &&
    !showForm &&
    !hasActiveCustomerFlow &&
    !hasVisibleCustomerFlowCard &&
    normalizedMessages.length === 0;

  const supplierTaskFallbackMessage = useMemo(() => {
    if (!isActiveSupplierTaskSession || normalizedMessages.length > 0) return null;

    const chatTaskLike = {
      ...(chat || {}),
      ...(chat?.supplierTask || {}),
      ...(chat?.task || {}),
      ...(chat?.taskItem || {}),
      ...(chat?.metadata || {}),
      sessionId: chat?.id,
      SessionId: chat?.id,
      taskId: chat?.id,
      TaskId: chat?.id,
    };

    return buildSupplierTaskFallbackMessage(getActiveSessionId(), chatTaskLike);
  }, [isActiveSupplierTaskSession, normalizedMessages.length, getActiveSessionId, chat]);

  // Manual customer reply process is disabled. Customer replies should come
  // only from the mailbox poller / EMAIL-REVIEW workflow.
  const canShowProcessReplyButton = false;

  const emailReviewReplyInfo = useMemo(
    () => extractCustomerEmailReplyFromMessages(normalizedMessages),
    [normalizedMessages]
  );

  const canShowEmailReviewActionCard = useMemo(() => {
    if (isActiveSupplierTaskSession) return false;
    if (!hasEmailReviewSignal(normalizedMessages)) return false;

    const alreadySubmitted = normalizedMessages.some((m) => {
      const text = String(m?.text || "").toLowerCase();
      return (
        text.includes("request-confirmed") ||
        text.includes("submitted for assessment") ||
        text.includes("email review completed")
      );
    });

    return !alreadySubmitted;
  }, [normalizedMessages, isActiveSupplierTaskSession]);

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
          onGenerateEmailDraft={() => handleGenerateEmailDraftFromForm()}
          onNotifyCustomerSelected={(nextDraft) =>
            handleGenerateEmailDraftFromForm(nextDraft, { silentPrompt: false })
          }
          saving={savingForm}
          generatingEmailDraft={generatingEmailDraft}
          saveMsg={formSaveMsg}
        />
      </div>
    </div>
  );

  const shouldRenderFormAtTop =
    showForm && formDraft && computedFormInsertIndex === 0;

  const shouldRenderFormAtEnd =
    showForm &&
    formDraft &&
    (computedFormInsertIndex === null ||
      computedFormInsertIndex >= normalizedMessages.length);

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

      {shouldShowWorkflowFulfillmentBar && !isRequestMonitoringSession && (
        <WorkflowFulfillmentBar
          requestStatus={currentRequestStatus}
          workflowSections={workflowSections}
        />
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
                    suggestions={mergedCustomerRequestSuggestions}
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

            {supplierTaskFallbackMessage && (
              <div className="msg-row bot">
                <div className="msg-bubble">
                  <SupplierTaskCard
                    task={supplierTaskFallbackMessage.supplierTask}
                    isEngineerView={isEngineerProfile}
                    user={user}
                    sessionId={getActiveSessionId()}
                    reviewMarkdownOverride={activeSupplierTaskReviewMarkdown}
                    onUploadComplete={handleSupplierTaskUpdated}
                    onSubmitComplete={handleSupplierTaskUpdated}
                  />
                </div>
              </div>
            )}

            {normalizedMessages.map((m, index) => {
              const workflowAnchorId = isRequestMonitoringSession
                ? null
                : workflowAnchorIdsByMessageIndex[index];

              const supplierTaskDocsCount = m?.supplierTask
                ? normalizeSupplierUploadedDocuments(m.supplierTask).length
                : 0;

              const shouldRenderSupplierTaskCard =
                !!m?.supplierTask &&
                (isActiveSupplierTaskSession || supplierTaskDocsCount > 0);

              return (
                <React.Fragment key={`${chat?.id || "chat"}-${m.id || "msg"}-${index}`}>
                  {showForm &&
                    formDraft &&
                    computedFormInsertIndex === index &&
                    renderFormMessageRow(`inline-form-before-${index}`)}

                  <div
                    id={workflowAnchorId || undefined}
                    className={`msg-row ${m.sender}`}
                  >
                    <div className="msg-bubble">
                    {m.flowType === "customer_request" ? (
                      <CustomerRequestStepCard
                        message={m}
                        onSelectOption={handleFlowOptionSelect}
                        onSubmitManualInput={handleManualFlowSubmit}
                      />
                    ) : isAssessmentReportMessage(m) ? (
                      <AssessmentReportCard
                        message={m}
                        sessionAssessmentMarkdown={activeSessionAssessmentMarkdown}
                        user={user}
                        sessionId={getActiveSessionId()}
                        onSaveDraft={handleSaveEmailDraft}
                        onSendEmail={handleSendEmailDraft}
                      />
                    ) : getMessageEmailDraft(m) ? (
                      <EmailDraftCard
                        draft={getMessageEmailDraft(m)}
                        onSaveDraft={handleSaveEmailDraft}
                        onSendEmail={handleSendEmailDraft}
                        onPreviewAttachment={handlePreviewEmailAttachment}
                        onDownloadAttachment={handleDownloadEmailAttachment}
                      />
                    ) : shouldRenderSupplierTaskCard ? (
                      <SupplierTaskCard
                        task={m.supplierTask}
                        isEngineerView={isEngineerProfile}
                        user={user}
                        sessionId={getActiveSessionId()}
                        reviewMarkdownOverride={activeSupplierTaskReviewMarkdown}
                        onUploadComplete={handleSupplierTaskUpdated}
                        onSubmitComplete={handleSupplierTaskUpdated}
                      />
                    ) : hasSupplierUploadedDocsMarkdown(m.text || "", m.artifact) ? (
                      <SupplierUploadedDocsMarkdownCard
                        text={m.text || ""}
                        artifact={m.artifact}
                        user={user}
                        sessionId={getActiveSessionId()}
                      />
                    ) : (
                      <MarkdownRenderer
                        text={m.text || ""}
                        onRequestRowClick={handleRequestRowClick}
                      />
                    )}
                    {!m.emailDraft &&
                      !m.supplierTask &&
                      !m.flowType &&
                      !hasSupplierUploadedDocsMarkdown(m.text || "", m.artifact) &&
                      !isAssessmentReportMessage(m) &&
                      !isPreparedFormMessage(m.text || "") &&
                      !isCustomerFlowQuestionText(m.text || "") &&
                      renderArtifact(m)}
                    {renderAttachments(m.attachments)}
                    </div>
                  </div>
                </React.Fragment>
              );
            })}

            {normalizedMessages.length === 0 && shouldRenderFormAtEnd
              ? renderFormMessageRow("inline-form-empty-end")
              : null}

            {normalizedMessages.length > 0 && shouldRenderFormAtEnd
              ? renderFormMessageRow("inline-form-end")
              : null}

            {canShowEmailReviewActionCard && (
              <div className="msg-row bot">
                <div className="msg-bubble">
                  <EmailReviewActionCard
                    replyInfo={emailReviewReplyInfo}
                    requestId={extractRequestIdFromSessionId(getActiveSessionId())}
                    assignedTo={user?.email || ""}
                    onSubmitForAssessment={handleSubmitEmailReviewForAssessment}
                    onRequestChanges={handleRequestChangesFromEmailReview}
                    loading={submittingEmailReview}
                  />
                </div>
              </div>
            )}

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