// src/api/api-config.js

// ===============================
// API CONFIG FOR AWS API GATEWAY
// ===============================

// Main chat app API.
// This API must be used for normal chat routes, AgentCore chat,
// file upload/download, customer/supplier workflow, and KC FMD endpoint.
export const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL ||
  "https://mfdhqhocm4.execute-api.ap-south-1.amazonaws.com"
).replace(/\/$/, "");

// KC final decision:
// Keep only one assessment endpoint in the chat app.
// Old temporary /assessment-trigger API is no longer used.
// All assessment triggers now go through /fmd-assessment on the main chat API.

console.log("✅ LOADED api-config.js FROM:", import.meta.url, "TIME:", Date.now());
console.log("✅ api-config UPDATED VERSION 1029 - KC FMD FULL PAYLOAD");
console.log("✅ CHAT API BASE URL:", API_BASE_URL);
console.log("✅ FMD CORE ENGINE URL:", `${API_BASE_URL}/fmd-assessment`);

// ===============================
// ENDPOINTS
// ===============================
export const ENDPOINTS = {
  // Main chat API routes
  chat: `${API_BASE_URL}/chat`,
  agentcoreChat: `${API_BASE_URL}/agentcore-chat`,

  // KC FMD / Core Engine endpoint in main chat API
  fmdAssessment: `${API_BASE_URL}/fmd-assessment`,

  initialise: `${API_BASE_URL}/initialise`,
  rename: `${API_BASE_URL}/rename`,
  delete: `${API_BASE_URL}/delete`,

  // ✅ create session by chat type
  createSession: `${API_BASE_URL}/session/create`,

  // ✅ request monitoring status table
  requestMonitoringStatus: `${API_BASE_URL}/status`,

  // ✅ CUSTOMER REQUEST SEARCH
  customerRequestSearch: `${API_BASE_URL}/customer-request/search`,

  // ✅ KC FILE FLOW
  kcFileUpload: `${API_BASE_URL}/file/presign-upload`,
  kcFileDownload: `${API_BASE_URL}/file/presign-download`,

  // ✅ FR1
  fileConfirm: `${API_BASE_URL}/file/confirm`,

  // ✅ SUPPLIER TASK FLOW
  supplierTaskSubmitReview: `${API_BASE_URL}/supplier-task/submit-review`,
  supplierTaskUpdate: `${API_BASE_URL}/supplier-task/update`,

  // ✅ FORM SAVE
  formSave: `${API_BASE_URL}/form`,

  // ✅ RDS MASTER DATA
  customerMaster: `${API_BASE_URL}/customer-master`,
  productMaster: `${API_BASE_URL}/product-master`,

  // ✅ EMAIL FLOW
  saveEmailDraft: `${API_BASE_URL}/email/draft`,
  sendEmail: `${API_BASE_URL}/customer-request/send-email`,
  processCustomerReply: `${API_BASE_URL}/customer-request/process-reply`,

  // ✅ ASSESSMENT REPORT PDF + CUSTOMER EMAIL FLOW
  assessmentReportPresign: `${API_BASE_URL}/assessment/report/presign`,
  assessmentEmailGenerate: `${API_BASE_URL}/assessment/email/generate`,

  // ✅ REPORT DELIVERY PUBLIC CUSTOMER FLOW
  reportValidateToken: `${API_BASE_URL}/report/validate-token`,
  reportSendOtp: `${API_BASE_URL}/report/send-otp`,
  reportVerifyOtp: `${API_BASE_URL}/report/verify-otp`,
  reportDownload: `${API_BASE_URL}/report/download`,
  reportSubmitFeedback: `${API_BASE_URL}/report/submit-feedback`,

  // CONFIG
  config: `${API_BASE_URL}/config`,
};

const debugLog = (...args) => console.log("[api-config]", ...args);

const assertToken = (token) => {
  if (!token) throw new Error("No token provided");
};

// ===============================
// ⏱️ REQUEST TIMEOUTS
// ===============================
const REQUEST_TIMEOUT_CHAT = 30000; // 30s
const REQUEST_TIMEOUT_AGENT = 90000; // 90s
const REQUEST_TIMEOUT_STANDARD = 30000; // 30s

// ===============================
// ✅ COMMON RESPONSE PARSER
// ===============================
const parseJsonSafe = async (res) => {
  try {
    const text = await res.text();
    return {
      text,
      data: text ? JSON.parse(text) : {},
    };
  } catch {
    return { text: "", data: {} };
  }
};

const asString = (value) => String(value ?? "").trim();


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


// ===============================
// ✅ DYNAMODB / ASSESSMENT REPORT NORMALIZER
// ===============================
// Some backend routes return normal JSON, while some return DynamoDB-style
// AttributeValue objects like { S: "..." }, { M: {...} }, { L: [...] }.
// These helpers make report/status fields clean before ChatWindow receives them.
export const unwrapDynamoValue = (value) => {
  if (value === null || value === undefined) return value;

  if (typeof value !== "object") return value;

  if (Array.isArray(value)) return value.map(unwrapDynamoValue);

  if (Object.prototype.hasOwnProperty.call(value, "S")) return value.S ?? "";
  if (Object.prototype.hasOwnProperty.call(value, "N")) return value.N ?? "";
  if (Object.prototype.hasOwnProperty.call(value, "BOOL")) return Boolean(value.BOOL);
  if (Object.prototype.hasOwnProperty.call(value, "NULL")) return null;
  if (Object.prototype.hasOwnProperty.call(value, "M")) return unwrapDynamoValue(value.M || {});
  if (Object.prototype.hasOwnProperty.call(value, "L")) return unwrapDynamoValue(value.L || []);
  if (Object.prototype.hasOwnProperty.call(value, "SS")) return value.SS || [];
  if (Object.prototype.hasOwnProperty.call(value, "NS")) return value.NS || [];

  const out = {};
  for (const [key, val] of Object.entries(value)) {
    out[key] = unwrapDynamoValue(val);
  }
  return out;
};

const firstNonEmpty = (...values) => {
  for (const value of values) {
    const unwrapped = unwrapDynamoValue(value);
    if (typeof unwrapped === "string" && unwrapped.trim()) return unwrapped.trim();
    if (unwrapped !== null && unwrapped !== undefined && typeof unwrapped !== "object") {
      const text = String(unwrapped).trim();
      if (text) return text;
    }
  }
  return "";
};

export const normalizeAssessmentReportFields = (item = {}) => {
  const clean = unwrapDynamoValue(item) || {};
  const assessmentDetail = clean.AssessmentDetail || clean.assessmentDetail || {};

  const reportMarkdown = firstNonEmpty(
    clean.AssessmentReportMarkdown,
    clean.assessmentReportMarkdown,
    clean.AssessmentResult,
    clean.assessmentResult,
    clean.ReportMarkdown,
    clean.reportMarkdown,
    clean.Report,
    clean.report,
    assessmentDetail.Report,
    assessmentDetail.report,
    assessmentDetail.AssessmentReportMarkdown,
    assessmentDetail.assessmentReportMarkdown,
    assessmentDetail.AssessmentResult,
    assessmentDetail.assessmentResult,
    assessmentDetail.ReportMarkdown,
    assessmentDetail.reportMarkdown
  );

  const reportS3Path = firstNonEmpty(
    clean.AssessmentReportS3Key,
    clean.assessmentReportS3Key,
    clean.AssessmentReportS3Path,
    clean.assessmentReportS3Path,
    clean.ReportPublishedFilePath,
    clean.reportPublishedFilePath,
    clean.ReportS3Key,
    clean.reportS3Key,
    clean.ReportPath,
    clean.reportPath,
    assessmentDetail.ReportPublishedFilePath,
    assessmentDetail.reportPublishedFilePath,
    assessmentDetail.AssessmentReportS3Key,
    assessmentDetail.assessmentReportS3Key,
    assessmentDetail.ReportS3Key,
    assessmentDetail.reportS3Key,
    assessmentDetail.ReportPath,
    assessmentDetail.reportPath
  );

  const reportPublishedStatus = firstNonEmpty(
    clean.ReportPublishedStatus,
    clean.reportPublishedStatus,
    assessmentDetail.ReportPublishedStatus,
    assessmentDetail.reportPublishedStatus
  );

  const reportCreatedBy = firstNonEmpty(
    clean.ReportCreatedBy,
    clean.reportCreatedBy,
    assessmentDetail.ReportCreatedBy,
    assessmentDetail.reportCreatedBy
  );

  const reportCreatedOn = firstNonEmpty(
    clean.ReportCreatedOn,
    clean.reportCreatedOn,
    assessmentDetail.ReportCreatedOn,
    assessmentDetail.reportCreatedOn
  );

  return {
    ...clean,
    AssessmentDetail: {
      ...assessmentDetail,
      ...(reportMarkdown ? { Report: reportMarkdown } : {}),
      ...(reportS3Path ? { ReportPublishedFilePath: reportS3Path } : {}),
      ...(reportPublishedStatus ? { ReportPublishedStatus: reportPublishedStatus } : {}),
      ...(reportCreatedBy ? { ReportCreatedBy: reportCreatedBy } : {}),
      ...(reportCreatedOn ? { ReportCreatedOn: reportCreatedOn } : {}),
    },
    ...(reportMarkdown
      ? {
          AssessmentReportMarkdown: reportMarkdown,
          assessmentReportMarkdown: reportMarkdown,
          AssessmentResult: reportMarkdown,
          assessmentResult: reportMarkdown,
        }
      : {}),
    ...(reportS3Path
      ? {
          AssessmentReportS3Key: reportS3Path,
          assessmentReportS3Key: reportS3Path,
          AssessmentReportS3Path: reportS3Path,
          assessmentReportS3Path: reportS3Path,
        }
      : {}),
    ...(reportPublishedStatus
      ? {
          ReportPublishedStatus: reportPublishedStatus,
          reportPublishedStatus,
        }
      : {}),
  };
};

const normalizeCustomerRequestItem = (item = {}) => {
  const clean = normalizeAssessmentReportFields(item);

  const requestStatus = firstNonEmpty(
    clean.RequestStatus,
    clean.requestStatus,
    clean.Status,
    clean.status
  );

  const requestId = firstNonEmpty(
    clean.RequestId,
    clean.requestId,
    clean.id
  );

  const sessionId = firstNonEmpty(
    clean.SessionId,
    clean.sessionId
  );

  return {
    ...clean,
    ...(requestStatus ? { RequestStatus: requestStatus, requestStatus } : {}),
    ...(requestId ? { RequestId: requestId, requestId } : {}),
    ...(sessionId ? { SessionId: sessionId, sessionId } : {}),
  };
};

export const normalizeCustomerRequestResponse = (data = {}) => {
  const clean = unwrapDynamoValue(data) || {};

  const normalizeArray = (arr) =>
    Array.isArray(arr) ? arr.map(normalizeCustomerRequestItem) : arr;

  const normalized = {
    ...clean,
    ...(Array.isArray(clean.items) ? { items: normalizeArray(clean.items) } : {}),
    ...(Array.isArray(clean.Items) ? { Items: normalizeArray(clean.Items) } : {}),
    ...(Array.isArray(clean.requests) ? { requests: normalizeArray(clean.requests) } : {}),
    ...(Array.isArray(clean.Requests) ? { Requests: normalizeArray(clean.Requests) } : {}),
    ...(Array.isArray(clean.results) ? { results: normalizeArray(clean.results) } : {}),
    ...(Array.isArray(clean.Results) ? { Results: normalizeArray(clean.Results) } : {}),
    ...(Array.isArray(clean.sessions) ? { sessions: normalizeArray(clean.sessions) } : {}),
    ...(Array.isArray(clean.Sessions) ? { Sessions: normalizeArray(clean.Sessions) } : {}),
    ...(Array.isArray(clean.data) ? { data: normalizeArray(clean.data) } : {}),
    ...(clean.item ? { item: normalizeCustomerRequestItem(clean.item) } : {}),
    ...(clean.Item ? { Item: normalizeCustomerRequestItem(clean.Item) } : {}),
    ...(clean.request ? { request: normalizeCustomerRequestItem(clean.request) } : {}),
    ...(clean.Request ? { Request: normalizeCustomerRequestItem(clean.Request) } : {}),
  };

  // Some APIs return a single CustomerRequest item at root.
  if (
    normalized.RequestId ||
    normalized.requestId ||
    normalized.RequestStatus ||
    normalized.requestStatus ||
    normalized.AssessmentDetail
  ) {
    return normalizeCustomerRequestItem(normalized);
  }

  return normalized;
};

// ✅ KC strict CustomerRequestStore frontend payload helper
// Backend is still the final source of truth, but this avoids sending random extra
// frontend-only fields when saving the customer request form.
const normalizeCustomerRequestPayload = (payload = {}) => {
  if (!payload || typeof payload !== "object") return {};

  const requestDetail = payload.RequestDetail || payload.RequestDetails || {};
  const customerDetail = payload.CustomerDetail || payload.CustomerDetails || {};

  const requestId = asString(payload.RequestId || payload.requestId);
  const sessionId = asString(payload.SessionId || payload.sessionId);

  const customerName = asString(payload.CustomerName || customerDetail.CustomerName);
  const customerPartName = asString(
    payload.CustomerPartName || customerDetail.CustomerPartName
  );
  const customerPartNumber = asString(
    payload.CustomerPartNumber || customerDetail.CustomerPartNumber
  );
  const customerContactEmailId = asString(
    payload.CustomerContactEmailId ||
      payload.CustomerContactEmail ||
      payload.CustomerEmail ||
      customerDetail.CustomerContactEmailId ||
      customerDetail.CustomerContactEmail
  ).toLowerCase();

  const requestName = asString(
    payload.RequestName || payload.title || requestDetail.RequestName
  );
  const requestDescription = asString(
    payload.RequestDescription || requestDetail.RequestDescription
  );
  const requestType = asString(payload.RequestType || requestDetail.RequestType);
  const requestPriority = asString(
    payload.RequestPriority || requestDetail.RequestPriority
  );
  const requestCompletionDateTime = asString(
    payload.RequestCompletionDateTime ||
      payload.RequestCompletionDate ||
      requestDetail.RequestCompletionDateTime ||
      requestDetail.RequestCompletionDate
  );
  const requestorMethod = asString(
    payload.RequestorMethod || requestDetail.RequestorMethod || "EMAIL"
  );
  const requestorContent =
    asString(payload.RequestorContent || requestDetail.RequestorContent || requestDescription) ||
    requestDescription;
  const requestConfirmationEmail = asString(
    payload.RequestConfirmationEmail || requestDetail.RequestConfirmationEmail
  );

  const cleaned = {
    CustomerName: customerName,
    CustomerPartName: customerPartName,
    CustomerPartNumber: customerPartNumber,
    RequestName: requestName,
    RequestDescription: requestDescription,
    RequestType: requestType,
    RequestPriority: requestPriority,
    RequestCompletionDateTime: requestCompletionDateTime,
    RequestCompletionDate: requestCompletionDateTime,
    RequestorMethod: requestorMethod,
    RequestorContent: requestorContent,
    NotifyCustomer: Boolean(payload.NotifyCustomer),
    CustomerEmail: customerContactEmailId,
    CustomerContactEmailId: customerContactEmailId,
    RequestDetail: {
      RequestName: requestName,
      RequestDescription: requestDescription,
      RequestType: requestType,
      RequestPriority: requestPriority,
      RequestCompletionDateTime: requestCompletionDateTime,
      RequestorMethod: requestorMethod,
      RequestorContent: requestorContent,
      RequestConfirmationEmail: requestConfirmationEmail,
    },
    CustomerDetail: {
      CustomerPartNumber: customerPartNumber,
      CustomerPartName: customerPartName,
      CustomerContactEmailId: customerContactEmailId,
    },
  };

  if (requestId) cleaned.RequestId = requestId;
  if (sessionId) cleaned.SessionId = sessionId;
  if (payload.RequestStatus) cleaned.RequestStatus = asString(payload.RequestStatus);

  return cleaned;
};

// ✅ Build compact customer confirmation email text.
export const buildRequestConfirmationEmailMarkdown = ({
  requestId = "",
  requestLoggedDateTime = "",
  requestStatus = "REQUEST-REVIEW",
  customerName = "",
  customerPart = "",
  requestName = "",
  requestDescription = "",
  requestType = "",
  requestPriority = "",
  requestCompletionDateTime = "",
  requestorContent = "",
  engineeringContactEmailId = "",
  requestCreatedBy = "Engineering Operations Team",
} = {}) => {
  const safeRequestName = asString(requestName) || "Customer Request";
  const safeCustomerPart = asString(customerPart);
  const safeRequestId = asString(requestId);
  const safeCustomerName = asString(customerName) || "Customer";
  const safeRequestType = asString(requestType) || "Customer Request";
  const safeStatus = asString(requestStatus) || "REQUEST-REVIEW";
  const safeDescription =
    asString(requestDescription) || asString(requestorContent) || "Not provided";
  const safePriority = asString(requestPriority) || "Medium";
  const safeCompletion = asString(requestCompletionDateTime) || "Not provided";
  const safeLoggedDate = asString(requestLoggedDateTime) || "Not provided";
  const safeEngineer = asString(engineeringContactEmailId) || "";
  const safeCreatedBy = asString(requestCreatedBy) || "Engineering Operations Team";

  return [
    `Subject: Confirmation of Request: ${safeRequestName} - ${safeCustomerPart} (Ref: ${safeRequestId})`,
    "",
    `Dear ${safeCustomerName} Team,`,
    "",
    `We have received and logged your request for ${safeRequestType}.`,
    "",
    "Request Information",
    `Request ID: ${safeRequestId}`,
    `Date Logged: ${safeLoggedDate}`,
    `Request Type: ${safeRequestType}`,
    `Current Status: ${safeStatus}`,
    `Priority: ${safePriority}`,
    "",
    "Part & Project Details",
    `Customer: ${safeCustomerName}`,
    `Part Description: ${safeCustomerPart}`,
    `Objective: ${safeDescription}`,
    "",
    "Timeline & Contact",
    `Estimated Completion: ${safeCompletion}`,
    safeEngineer ? `Engineering Lead: ${safeEngineer}` : "",
    "",
    "Next Steps:",
    `Our team is currently in the ${safeStatus} phase. We will reach out if any further clarification or documentation is required. Otherwise, you can expect an update by the estimated completion date.`,
    "",
    "Best regards,",
    safeCreatedBy,
    "Engineering Operations Department",
  ]
    .filter((line, index, arr) => {
      // keep single blank lines but avoid repeated blanks
      if (line !== "") return true;
      return arr[index - 1] !== "";
    })
    .join("\n");
};

// ✅ normalize attachments so backend always receives same keys
const normalizeAttachments = (attachments) => {
  if (!Array.isArray(attachments)) return [];
  return attachments
    .filter((a) => a && a.s3Key)
    .map((a) => ({
      fileName: a.fileName || a.name || "file",
      fileType: a.fileType || a.mimeType || "application/octet-stream",
      fileSize: a.fileSize ?? a.size ?? 0,
      s3Key: a.s3Key,
      docType: a.docType || null,
    }));
};

// ✅ normalize chat type before sending to backend
const normalizeCreateSessionType = (chatType) => {
  const value = String(chatType || "").trim();

  if (value === "REQUEST_MONITORING") {
    return "REQUEST_MONITORING_STATUS";
  }

  return value;
};

// ✅ normalize source filter before sending to backend
const normalizeSourceFilter = (sourceFilter) => {
  const value = String(sourceFilter || "all").trim().toLowerCase();

  if (
    value === "customer_request_store" ||
    value === "chat_session_store" ||
    value === "all"
  ) {
    return value;
  }

  return "all";
};

// Agent ON  -> /agentcore-chat
// Agent OFF -> /chat
const pickChatEndpoint = (agentMode) =>
  agentMode ? ENDPOINTS.agentcoreChat : ENDPOINTS.chat;

// ===============================
// ✅ CREATE SESSION
// POST /session/create
// ===============================
export const createSession = async (token, email, chatType) => {
  assertToken(token);
  if (!email) throw new Error("Email is required");
  if (!chatType) throw new Error("chatType is required");

  const finalChatType = normalizeCreateSessionType(chatType);

  const res = await fetch(ENDPOINTS.createSession, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      session: {
        UserId: email,
        chatType: finalChatType,
      },
    }),
  });

  const { text, data } = await parseJsonSafe(res);

  if (!res.ok) {
    throw new Error(
      data?.error ||
        data?.message ||
        text ||
        `Create session failed (${res.status})`
    );
  }

  return data;
};

// ===============================
// ✅ REQUEST MONITORING STATUS
// GET /status
// ===============================
export const getRequestMonitoringStatus = async (token) => {
  assertToken(token);

  const res = await fetch(ENDPOINTS.requestMonitoringStatus, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  });

  const { text, data } = await parseJsonSafe(res);

  if (!res.ok) {
    throw new Error(
      data?.error ||
        data?.message ||
        text ||
        `Request monitoring fetch failed (${res.status})`
    );
  }

  return data;
};

// ===============================
// ✅ CUSTOMER REQUEST SEARCH
// POST /customer-request/search
// ===============================
export const searchCustomerRequests = async (
  token,
  query = "",
  sourceFilter = "all"
) => {
  assertToken(token);

  const finalSourceFilter = normalizeSourceFilter(sourceFilter);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_STANDARD);

  try {
    const res = await fetch(ENDPOINTS.customerRequestSearch, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        session: {
          query: query || "",
          sourceFilter: finalSourceFilter,
        },
      }),
      signal: controller.signal,
    });

    const { text, data } = await parseJsonSafe(res);

    if (!res.ok) {
      throw new Error(
        data?.error ||
          data?.message ||
          text ||
          `Customer request search failed (${res.status})`
      );
    }

    return normalizeCustomerRequestResponse(data);
  } catch (e) {
    if (String(e?.name).includes("AbortError")) {
      throw new Error("REQUEST_TIMEOUT");
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
};

// ===============================
// ✅ CUSTOMER REQUEST LIVE STATUS
// Uses existing /customer-request/search to fetch latest DynamoDB status
// for one active request/session.
// ===============================
export const getCustomerRequestLiveStatus = async (
  token,
  requestIdOrSessionId = ""
) => {
  assertToken(token);

  const query = asString(requestIdOrSessionId);

  if (!query) {
    return {
      requestStatus: "",
      rawRequestStatus: "",
      requestId: "",
      sessionId: "",
      item: null,
    };
  }

  const data = await searchCustomerRequests(
    token,
    query,
    "customer_request_store"
  );

  const candidates = [
    ...(Array.isArray(data?.items) ? data.items : []),
    ...(Array.isArray(data?.Items) ? data.Items : []),
    ...(Array.isArray(data?.requests) ? data.requests : []),
    ...(Array.isArray(data?.Requests) ? data.Requests : []),
    ...(Array.isArray(data?.results) ? data.results : []),
    ...(Array.isArray(data?.Results) ? data.Results : []),
    ...(Array.isArray(data?.sessions) ? data.sessions : []),
    ...(Array.isArray(data?.Sessions) ? data.Sessions : []),
    ...(Array.isArray(data?.data) ? data.data : []),
  ].map(normalizeCustomerRequestItem);

  const normalizeId = (value = "") => asString(value).toLowerCase();

  const cleanQuery = normalizeId(query);

  const shortRequestId = query.split("#").slice(0, 3).join("#");
  const cleanShortRequestId = normalizeId(shortRequestId);

  const matched =
    candidates.find((item = {}) => {
      const itemRequestId = normalizeId(
        item?.RequestId ||
          item?.requestId ||
          item?.id ||
          ""
      );

      const itemSessionId = normalizeId(
        item?.SessionId ||
          item?.sessionId ||
          ""
      );

      return (
        itemRequestId === cleanQuery ||
        itemSessionId === cleanQuery ||
        itemRequestId === cleanShortRequestId ||
        itemSessionId.startsWith(cleanShortRequestId)
      );
    }) ||
    candidates[0] ||
    data?.item ||
    data?.Item ||
    data?.request ||
    data?.Request ||
    (data?.RequestId || data?.requestId || data?.AssessmentDetail ? data : null) ||
    null;

  const normalizedMatched = matched ? normalizeCustomerRequestItem(matched) : null;

  const rawStatus = asString(
    normalizedMatched?.RequestStatus ||
      normalizedMatched?.requestStatus ||
      normalizedMatched?.Status ||
      normalizedMatched?.status ||
      normalizedMatched?.rawRequestStatus ||
      normalizedMatched?.RawRequestStatus ||
      data?.RequestStatus ||
      data?.requestStatus ||
      data?.status ||
      ""
  );

  return {
    requestStatus: rawStatus,
    rawRequestStatus: rawStatus,
    requestId: asString(
      normalizedMatched?.RequestId ||
        normalizedMatched?.requestId ||
        data?.RequestId ||
        data?.requestId ||
        shortRequestId ||
        query
    ),
    sessionId: asString(
      normalizedMatched?.SessionId ||
        normalizedMatched?.sessionId ||
        data?.SessionId ||
        data?.sessionId ||
        query
    ),
    item: normalizedMatched,
    assessmentReportMarkdown: normalizedMatched?.AssessmentReportMarkdown || "",
    assessmentReportS3Key: normalizedMatched?.AssessmentReportS3Key || "",
    assessmentDetail: normalizedMatched?.AssessmentDetail || null,
    response: data,
  };
};


// ===============================
// ✅ ASSESSMENT WORKFLOW TRIGGER
// KC final decision:
// Old temporary /assessment-trigger is removed/stopped.
// This function name is kept only for backward compatibility with existing UI imports.
// It now calls the real Core Engine endpoint: POST /fmd-assessment.
// ===============================
export const triggerAssessmentWorkflow = async (
  {
    requestId = "",
    customerRequestId = "",
    chatSessionId = "",
    chatUserId = "",
    customerName = "",
    customerPart = "",
    requestStatus = "",
    customerPartKey = "",
    engineeringPartKey = "",
    workflowRunType = "Full",
    delegationCapacity = "3",
  } = {},
  token = ""
) => {
  assertToken(token);

  const finalRequestId = asString(requestId || customerRequestId);

  if (!finalRequestId) {
    throw new Error("CustomerRequestId is required");
  }

  const resolvedCustomerPartKey = asString(customerPartKey || customerPart);

  const parsedEngineeringPartKey =
    asString(engineeringPartKey) ||
    (resolvedCustomerPartKey.includes("#")
      ? resolvedCustomerPartKey.split("#")[0]
      : resolvedCustomerPartKey);

  return triggerFmdAssessment(
    {
      requestId: finalRequestId,
      customerRequestId: finalRequestId,
      chatSessionId,
      chatUserId,
      workflowRunType,
      delegationCapacity,
      customerPartKey: resolvedCustomerPartKey,
      engineeringPartKey: parsedEngineeringPartKey,
      customerName,
      customerPart,
      requestStatus,
    },
    token
  );
};

// ===============================
// ✅ KC FMD / CORE ENGINE ASSESSMENT
// POST /fmd-assessment on main srs-ai-dev-user-chat API
// IMPORTANT: This uses API_BASE_URL through ENDPOINTS.fmdAssessment.
// ===============================
export const triggerFmdAssessment = async (
  payload = {},
  token
) => {
  assertToken(token);

  const finalRequestId = asString(
    payload.CustomerRequestId ||
      payload.customerRequestId ||
      payload.RequestId ||
      payload.requestId
  );

  if (!finalRequestId) {
    throw new Error("CustomerRequestId is required");
  }

  const kcSessionPayload = {
    WorkflowName: "FMD",
    WorkflowRunId: asString(payload.WorkflowRunId || payload.workflowRunId) || makeKcWorkflowRunId(),
    WorkflowRunType: "Full",
    CustomerName: asString(
      payload.CustomerName ||
        payload.customerName ||
        "General Motors"
    ),
    CustomerRequestId: finalRequestId,
    ChatSessionId: asString(
      payload.ChatSessionId ||
        payload.chatSessionId ||
        payload.SessionId ||
        payload.sessionId
    ),
    ChatUserId: asString(
      payload.ChatUserId ||
        payload.chatUserId ||
        payload.UserId ||
        payload.userId ||
        payload.email
    ),
    DelegationCapacity: String(
      payload.DelegationCapacity ||
        payload.delegationCapacity ||
        "3"
    ),
    EngineeringPartKey: asString(
      payload.EngineeringPartKey ||
        payload.engineeringPartKey ||
        payload.EngPartkey ||
        payload.engPartkey ||
        "BRK-7700#High-Perf Brake Assy"
    ),
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_AGENT);

  try {
    const res = await fetch(ENDPOINTS.fmdAssessment, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        session: kcSessionPayload,
      }),
      signal: controller.signal,
    });

    const { text, data } = await parseJsonSafe(res);

    if (!res.ok) {
      throw new Error(
        data?.error ||
          data?.message ||
          text ||
          `FMD assessment failed (${res.status})`
      );
    }

    return data;
  } catch (e) {
    if (String(e?.name).includes("AbortError")) {
      throw new Error("AGENT_TIMEOUT");
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
};

// ===============================
// ✅ FETCH CUSTOMER MASTER
// POST /customer-master
// ===============================
export const fetchCustomerMaster = async (token) => {
  assertToken(token);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_STANDARD);

  try {
    const res = await fetch(ENDPOINTS.customerMaster, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({}),
      signal: controller.signal,
    });

    const { text, data } = await parseJsonSafe(res);

    if (!res.ok) {
      throw new Error(
        data?.error ||
          data?.message ||
          text ||
          `Customer master fetch failed (${res.status})`
      );
    }

    return data;
  } catch (e) {
    if (String(e?.name).includes("AbortError")) {
      throw new Error("REQUEST_TIMEOUT");
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
};

// ===============================
// ✅ FETCH PRODUCT MASTER
// POST /product-master
// ===============================
export const fetchProductMaster = async (customerId, token) => {
  assertToken(token);
  if (!customerId) throw new Error("customerId is required");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_STANDARD);

  try {
    const res = await fetch(ENDPOINTS.productMaster, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        session: {
          CustomerId: customerId,
        },
      }),
      signal: controller.signal,
    });

    const { text, data } = await parseJsonSafe(res);

    if (!res.ok) {
      throw new Error(
        data?.error ||
          data?.message ||
          text ||
          `Product master fetch failed (${res.status})`
      );
    }

    return data;
  } catch (e) {
    if (String(e?.name).includes("AbortError")) {
      throw new Error("REQUEST_TIMEOUT");
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
};

// ===============================
// SEND CHAT MESSAGE
// ===============================
export const sendChatMessage = async (
  chatId,
  text,
  userEmail,
  token,
  attachments = [],
  agentMode = false
) => {
  assertToken(token);

  const normalized = normalizeAttachments(attachments);
  const url = pickChatEndpoint(agentMode);

  const timeoutMs =
    url === ENDPOINTS.agentcoreChat ? REQUEST_TIMEOUT_AGENT : REQUEST_TIMEOUT_CHAT;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        action: "prompt",
        session: {
          UserId: userEmail,
          SessionId: chatId,
          UserPrompt: text,
          Attachments: normalized,
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(errText || `Chat API failed (${response.status})`);
    }

    return await response.json();
  } catch (err) {
    if (err.name === "AbortError") {
      const mode =
        url === ENDPOINTS.agentcoreChat ? "AGENT_TIMEOUT" : "REQUEST_TIMEOUT";
      throw new Error(mode);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
};

// ===============================
// INITIALISE CHAT
// ===============================
export const initialiseChat = async (token, email, sessionId = null) => {
  assertToken(token);
  if (!email) throw new Error("Token or email missing");

  const response = await fetch(ENDPOINTS.initialise, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      session: {
        UserId: email,
        SessionId: sessionId,
      },
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`Initialise failed: ${errText}`);
  }

  const data = await response.json();
  return normalizeCustomerRequestResponse(data);
};

// ===============================
// RENAME CHAT
// ===============================
export const renameChat = async (token, userEmail, sessionId, title) => {
  assertToken(token);

  const res = await fetch(ENDPOINTS.rename, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      session: {
        UserId: userEmail,
        SessionId: sessionId,
        Title: title,
      },
    }),
  });

  if (!res.ok) throw new Error(await res.text().catch(() => "Rename failed"));
};

// ===============================
// DELETE CHAT
// ===============================
export const deleteChat = async (token, userEmail, sessionId) => {
  assertToken(token);

  const res = await fetch(ENDPOINTS.delete, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      session: {
        UserId: userEmail,
        SessionId: sessionId,
      },
    }),
  });

  if (!res.ok) throw new Error(await res.text().catch(() => "Delete failed"));
};

// ===============================
// ✅ FILE UPLOAD (PRESIGNED)
// ===============================
export const uploadFilePresigned = async ({ sessionId, userId, file }, token) => {
  assertToken(token);
  if (!file) throw new Error("File missing");

  debugLog("✅ upload flow starting:", file.name);

  const fileType = file.type || "application/octet-stream";

  const presignRes = await fetch(ENDPOINTS.kcFileUpload, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      session: {
        SessionId: sessionId,
        UserId: userId,
        fileName: file.name,
        fileType,
        fileSize: file.size,
      },
    }),
  });

  if (!presignRes.ok) throw new Error(await presignRes.text().catch(() => ""));
  const data = await presignRes.json();

  const uploadUrl = data.uploadUrl;
  const s3Key = data.s3Key;
  const resolvedSessionId = data.sessionId || sessionId;

  if (!uploadUrl || !s3Key) throw new Error("Missing uploadUrl or s3Key from backend");

  const putRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": fileType },
    body: file,
  });

  if (!putRes.ok) {
    const errText = await putRes.text().catch(() => "");
    throw new Error(`S3 PUT failed: ${putRes.status} ${errText}`);
  }

  return {
    sessionId: resolvedSessionId,
    s3Key,
    fileName: file.name,
    fileType,
    fileSize: file.size,
  };
};

// ===============================
// ✅ FR1: FILE CONFIRM
// Supports normal chat uploads and Supplier/FMD task uploads.
// ===============================
export const confirmFileUploadAndType = async (
  {
    sessionId,
    userId,
    s3Key,
    fileName,
    fileType,
    fileSize,
    docType,

    // ✅ supplier task upload metadata
    uploadType = "",
    taskId = "",
    requestId = "",
    supplierNote = "",
    supplierFileDescription = "",
  },
  token
) => {
  assertToken(token);
  if (!sessionId || !userId || !s3Key || !fileName) {
    throw new Error("Missing file confirm parameters");
  }

  const sessionPayload = {
    SessionId: sessionId,
    UserId: userId,
    s3Key,
    fileName,
    fileType: fileType || "application/octet-stream",
    fileSize: fileSize ?? 0,
    docType: docType || "OTHER",
  };

  if (uploadType) sessionPayload.uploadType = uploadType;
  if (taskId) sessionPayload.taskId = taskId;
  if (requestId) sessionPayload.requestId = requestId;
  if (supplierNote) sessionPayload.supplierNote = supplierNote;
  if (supplierFileDescription) {
    sessionPayload.supplierFileDescription = supplierFileDescription;
  }

  const res = await fetch(ENDPOINTS.fileConfirm, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      session: sessionPayload,
    }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(txt || `File confirm failed (${res.status})`);
  }

  return res.json().catch(() => ({}));
};

// ===============================
// ✅ SUPPLIER TASK FILE UPLOAD
// Reuses existing presigned S3 upload, then confirms as supplier task upload.
// ===============================
export const uploadSupplierTaskFile = async (
  {
    taskId,
    requestId,
    sessionId,
    userId,
    file,
    supplierNote = "",
    supplierFileDescription = "",
  },
  token
) => {
  assertToken(token);

  if (!taskId) throw new Error("taskId is required");
  if (!requestId) throw new Error("requestId is required");
  if (!sessionId) throw new Error("sessionId is required");
  if (!userId) throw new Error("userId is required");
  if (!file) throw new Error("file is required");

  const uploaded = await uploadFilePresigned(
    {
      sessionId,
      userId,
      file,
    },
    token
  );

  const confirmed = await confirmFileUploadAndType(
    {
      sessionId: uploaded.sessionId || sessionId,
      userId,
      s3Key: uploaded.s3Key,
      fileName: uploaded.fileName,
      fileType: uploaded.fileType,
      fileSize: uploaded.fileSize,
      docType: "SUPPLIER_FMD_DOCUMENT",
      uploadType: "SUPPLIER_FMD_DOCUMENT",
      taskId,
      requestId,
      supplierNote,
      supplierFileDescription,
    },
    token
  );

  return {
    ...uploaded,
    ...confirmed,
    taskId,
    requestId,
    supplierNote,
    supplierFileDescription,
    uploadType: "SUPPLIER_FMD_DOCUMENT",
  };
};

// ===============================
// ✅ SUBMIT SUPPLIER TASK FOR ENGINEERING REVIEW
// POST /supplier-task/submit-review
// ===============================
export const submitSupplierTaskForReview = async (
  {
    taskId,
    requestId,
    sessionId,
    userId,
    supplierAdditionalInformation = "",
    uploadedFiles = [],
  },
  token
) => {
  assertToken(token);

  if (!taskId) throw new Error("taskId is required");
  if (!requestId) throw new Error("requestId is required");
  if (!sessionId) throw new Error("sessionId is required");
  if (!userId) throw new Error("userId is required");

  const res = await fetch(ENDPOINTS.supplierTaskSubmitReview, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      session: {
        SessionId: sessionId,
        UserId: userId,
      },
      payload: {
        taskId,
        requestId,
        supplierAdditionalInformation,
        uploadedFiles,
        taskStatus: "REVIEW",
      },
    }),
  });

  const { text, data } = await parseJsonSafe(res);

  if (!res.ok) {
    throw new Error(
      data?.error ||
        data?.message ||
        text ||
        `Submit supplier task failed (${res.status})`
    );
  }

  return data;
};

// ===============================
// ✅ DOWNLOAD SUPPLIER TASK FILE
// Uses existing presigned download flow.
// ===============================
export const downloadSupplierTaskFile = async (
  { taskId, requestId, sessionId, userId, fileName, s3Key, fileType },
  token
) => {
  assertToken(token);

  if (!taskId) throw new Error("taskId is required");
  if (!requestId) throw new Error("requestId is required");
  if (!sessionId) throw new Error("sessionId is required");
  if (!userId) throw new Error("userId is required");
  if (!s3Key) throw new Error("s3Key is required");

  return downloadFilePresigned(
    {
      sessionId,
      userId,
      fileName,
      s3Key,
      fileType,
    },
    token
  );
};

// ===============================
// ✅ FILE DOWNLOAD (PRESIGNED)
// ===============================
export const kcFileDownload = async (
  { sessionId, userId, fileName, s3Key, fileType },
  token
) => {
  assertToken(token);

  const res = await fetch(ENDPOINTS.kcFileDownload, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      session: {
        SessionId: sessionId,
        UserId: userId,
        fileName,
        s3Key,
        fileType,
      },
    }),
  });

  if (!res.ok) throw new Error(await res.text().catch(() => ""));
  return res.json();
};

export const triggerBrowserDownload = (downloadUrl, fileName = "download") => {
  const a = document.createElement("a");
  a.href = downloadUrl;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
};

// Backward compat mapping
export const downloadFilePresigned = async (
  { userId, sessionId, fileName, s3Key, fileType },
  token
) => {
  assertToken(token);

  const res = await kcFileDownload(
    { sessionId, userId, fileName, s3Key, fileType },
    token
  );

  const url = res.downloadUrl;
  if (!url) throw new Error("Missing downloadUrl from backend");

  triggerBrowserDownload(url, res.fileName || fileName || "download");
  return res;
};

export const presignDownload = async (
  { userId, sessionId, fileName, s3Key, fileType },
  token
) => {
  return kcFileDownload({ sessionId, userId, fileName, s3Key, fileType }, token);
};

// ===============================
// ✅ SAVE GENERATED FORM
// POST /form
// ===============================
export const saveGeneratedForm = async (body, token) => {
  assertToken(token);

  const sessionId = body?.session?.SessionId || body?.session?.sessionId || null;
  const payload = body?.payload || null;

  if (!sessionId || !payload || typeof payload !== "object") {
    throw new Error("Missing SessionId/payload for form save");
  }

  const cleanedPayload = normalizeCustomerRequestPayload({
    ...payload,
    SessionId: payload.SessionId || payload.sessionId || sessionId,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);

  try {
    const res = await fetch(ENDPOINTS.formSave, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        session: {
          SessionId: sessionId,
        },
        payload: cleanedPayload,
      }),
      signal: controller.signal,
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const msg = data?.message || data?.error || `Save failed (${res.status})`;
      throw new Error(msg);
    }

    return data;
  } catch (e) {
    if (String(e?.name).includes("AbortError")) {
      throw new Error("REQUEST_TIMEOUT");
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
};

// ===============================
// ✅ COMPACT EMAIL BODY CLEANUP
// Removes excessive blank lines before sending/saving email.
// ===============================
export const compactCustomerEmailBody = (body = "") => {
  return String(body || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\s+|\s+$/g, "");
};

// ===============================
// ✅ SAVE EMAIL DRAFT
// POST /email/draft
// ===============================
export const saveEmailDraft = async (
  { sessionId, userId, to, subject, body, requestId = "" },
  token
) => {
  assertToken(token);

  if (!sessionId) throw new Error("sessionId is required");
  if (!userId) throw new Error("userId is required");

  const cleanBody = compactCustomerEmailBody(body);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_STANDARD);

  try {
    const res = await fetch(ENDPOINTS.saveEmailDraft, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        session: {
          SessionId: sessionId,
          UserId: userId,
        },
        payload: {
          to: to || "",
          subject: subject || "",
          body: cleanBody || "",
          requestId: requestId || "",
          RequestConfirmationEmail: cleanBody || "",
        },
      }),
      signal: controller.signal,
    });

    const { text, data } = await parseJsonSafe(res);

    if (!res.ok) {
      throw new Error(
        data?.error ||
          data?.message ||
          text ||
          `Save email draft failed (${res.status})`
      );
    }

    return data;
  } catch (e) {
    if (String(e?.name).includes("AbortError")) {
      throw new Error("REQUEST_TIMEOUT");
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
};

// ===============================
// ✅ SEND EMAIL
// POST /customer-request/send-email
// Also supports supplier_fmd_request when ChatWindow sends supplier draft.
// ===============================
export const sendCustomerEmail = async (
  {
    sessionId,
    userId,
    to,
    subject,
    body,
    requestId = "",
    from = "",
    emailKind = "",
    kind = "",
    isSupplierEmail = false,
    attachAssessmentPdf = false,
    reportS3Path = "",
    assessmentReportS3Path = "",
    attachmentFileName = "",
    attachments = [],
  },
  token
) => {
  assertToken(token);

  if (!sessionId) throw new Error("sessionId is required");
  if (!userId) throw new Error("userId is required");
  if (!to) throw new Error("Recipient email is required");
  if (!subject) throw new Error("Email subject is required");
  if (!body) throw new Error("Email body is required");

  const cleanBody = compactCustomerEmailBody(body);
  const resolvedEmailKind =
    emailKind || kind || (isSupplierEmail ? "supplier_fmd_request" : "");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_STANDARD);

  try {
    const res = await fetch(ENDPOINTS.sendEmail, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        session: {
          SessionId: sessionId,
          UserId: userId,
          to,
          from,
          subject,
          body: cleanBody,
          requestId: requestId || "",
          emailKind: resolvedEmailKind,
          kind: resolvedEmailKind,
          isSupplierEmail: Boolean(isSupplierEmail || resolvedEmailKind === "supplier_fmd_request"),
          attachAssessmentPdf: Boolean(attachAssessmentPdf),
          reportS3Path: reportS3Path || assessmentReportS3Path || "",
          assessmentReportS3Path: assessmentReportS3Path || reportS3Path || "",
          attachmentFileName: attachmentFileName || "",
          attachments: Array.isArray(attachments) ? attachments : [],
        },
        payload: {
          to,
          from,
          subject,
          body: cleanBody,
          requestId: requestId || "",
          RequestConfirmationEmail: cleanBody,
          emailKind: resolvedEmailKind,
          kind: resolvedEmailKind,
          isSupplierEmail: Boolean(isSupplierEmail || resolvedEmailKind === "supplier_fmd_request"),
          attachAssessmentPdf: Boolean(attachAssessmentPdf),
          reportS3Path: reportS3Path || assessmentReportS3Path || "",
          assessmentReportS3Path: assessmentReportS3Path || reportS3Path || "",
          attachmentFileName: attachmentFileName || "",
          attachments: Array.isArray(attachments) ? attachments : [],
        },
      }),
      signal: controller.signal,
    });

    const { text, data } = await parseJsonSafe(res);

    if (!res.ok) {
      throw new Error(
        data?.error ||
          data?.message ||
          text ||
          `Send email failed (${res.status})`
      );
    }

    return data;
  } catch (e) {
    if (String(e?.name).includes("AbortError")) {
      throw new Error("REQUEST_TIMEOUT");
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
};


// ===============================
// ✅ ASSESSMENT REPORT PDF PRESIGN
// POST /assessment/report/presign
// ===============================
export const presignAssessmentReportPdf = async (
  { sessionId = "", userId = "", requestId = "", reportS3Path = "" } = {},
  token
) => {
  assertToken(token);
  if (!sessionId) throw new Error("sessionId is required");
  if (!userId) throw new Error("userId is required");

  const res = await fetch(ENDPOINTS.assessmentReportPresign, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      session: {
        SessionId: sessionId,
        UserId: userId,
        requestId,
        reportS3Path,
        s3Path: reportS3Path,
      },
      payload: {
        requestId,
        reportS3Path,
        s3Path: reportS3Path,
      },
    }),
  });

  const { text, data } = await parseJsonSafe(res);
  if (!res.ok) {
    throw new Error(data?.error || data?.message || text || `PDF presign failed (${res.status})`);
  }
  return data;
};

// ===============================
// ✅ GENERATE CUSTOMER ASSESSMENT EMAIL DRAFT
// POST /assessment/email/generate
// ===============================
export const generateAssessmentCustomerEmail = async (
  { sessionId = "", userId = "", requestId = "" } = {},
  token
) => {
  assertToken(token);
  if (!sessionId) throw new Error("sessionId is required");
  if (!userId) throw new Error("userId is required");

  const res = await fetch(ENDPOINTS.assessmentEmailGenerate, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      session: {
        SessionId: sessionId,
        UserId: userId,
        requestId,
      },
      payload: { requestId },
    }),
  });

  const { text, data } = await parseJsonSafe(res);
  if (!res.ok) {
    throw new Error(data?.error || data?.message || text || `Generate assessment email failed (${res.status})`);
  }
  return data;
};

// ===============================
// ✅ PROCESS CUSTOMER REPLY
// POST /customer-request/process-reply
// ===============================
export const processCustomerReply = async (
  { sessionId, userId, requestId = "", emailSubject = "", emailBody = "" },
  token
) => {
  assertToken(token);

  if (!sessionId) throw new Error("sessionId is required");
  if (!userId) throw new Error("userId is required");
  if (!emailSubject && !emailBody) {
    throw new Error("emailSubject or emailBody is required");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_STANDARD);

  try {
    const res = await fetch(ENDPOINTS.processCustomerReply, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        session: {
          SessionId: sessionId,
          UserId: userId,
        },
        payload: {
          requestId: requestId || "",
          emailSubject: emailSubject || "",
          emailBody: emailBody || "",
        },
      }),
      signal: controller.signal,
    });

    const { text, data } = await parseJsonSafe(res);

    if (!res.ok) {
      throw new Error(
        data?.error ||
          data?.message ||
          text ||
          `Process customer reply failed (${res.status})`
      );
    }

    return data;
  } catch (e) {
    if (String(e?.name).includes("AbortError")) {
      throw new Error("REQUEST_TIMEOUT");
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
};

// ===============================
// ✅ REPORT DELIVERY PUBLIC CUSTOMER FLOW
// No Cognito token required.
// Customer opens /report-access?token=...
// ===============================
const reportDeliveryPost = async (url, payload = {}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_STANDARD);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const { text, data } = await parseJsonSafe(res);

    if (!res.ok) {
      throw new Error(
        data?.error ||
          data?.message ||
          text ||
          `Report delivery request failed (${res.status})`
      );
    }

    return data;
  } catch (e) {
    if (String(e?.name).includes("AbortError")) {
      throw new Error("REQUEST_TIMEOUT");
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
};

export const validateReportToken = async (token) => {
  if (!token) throw new Error("Report access token is missing");

  return reportDeliveryPost(ENDPOINTS.reportValidateToken, {
    token,
  });
};

export const sendReportOtp = async (token) => {
  if (!token) throw new Error("Report access token is missing");

  return reportDeliveryPost(ENDPOINTS.reportSendOtp, {
    token,
  });
};

export const verifyReportOtp = async (token, otp) => {
  if (!token) throw new Error("Report access token is missing");
  if (!otp) throw new Error("OTP is required");

  return reportDeliveryPost(ENDPOINTS.reportVerifyOtp, {
    token,
    otp,
  });
};

export const downloadCustomerReport = async (token) => {
  if (!token) throw new Error("Report access token is missing");

  return reportDeliveryPost(ENDPOINTS.reportDownload, {
    token,
  });
};

export const submitReportFeedback = async (token, rating, comment = "") => {
  if (!token) throw new Error("Report access token is missing");
  if (!rating) throw new Error("Rating is required");

  return reportDeliveryPost(ENDPOINTS.reportSubmitFeedback, {
    token,
    rating,
    comment,
  });
};

// ===============================
// CONFIG
// ===============================
export const fetchChatConfig = async (token) => {
  assertToken(token);

  const res = await fetch(ENDPOINTS.config, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) throw new Error("Failed to load chat config");
  return res.json();
};
