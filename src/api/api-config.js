// src/api/api-config.js

// ===============================
// API CONFIG FOR AWS API GATEWAY
// ===============================
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

console.log("✅ LOADED api-config.js FROM:", import.meta.url, "TIME:", Date.now());
console.log("✅ api-config UPDATED VERSION 1023 - CUSTOMER FLOW CLEANUP + COMPACT EMAIL");

export const ENDPOINTS = {
  chat: `${API_BASE_URL}/chat`,
  agentcoreChat: `${API_BASE_URL}/agentcore-chat`,

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

  // ✅ FORM SAVE
  formSave: `${API_BASE_URL}/form`,

  // ✅ RDS MASTER DATA
  customerMaster: `${API_BASE_URL}/customer-master`,
  productMaster: `${API_BASE_URL}/product-master`,

  // ✅ EMAIL FLOW
  saveEmailDraft: `${API_BASE_URL}/email/draft`,
  sendEmail: `${API_BASE_URL}/customer-request/send-email`,
  processCustomerReply: `${API_BASE_URL}/customer-request/process-reply`,

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
  const requestorContent = asString(
    payload.RequestorContent || requestDetail.RequestorContent || requestDescription
  ) || requestDescription;
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
// Kept as markdown/plain text because backend/email Lambda currently sends body text.
// This avoids large Gmail spacing caused by heading-heavy markdown and extra blank lines.
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
    .join("");
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
    ...(Array.isArray(data?.requests) ? data.requests : []),
    ...(Array.isArray(data?.results) ? data.results : []),
    ...(Array.isArray(data?.sessions) ? data.sessions : []),
    ...(Array.isArray(data?.data) ? data.data : []),
  ];

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
    data?.request ||
    null;

  const rawStatus = asString(
    matched?.RequestStatus ||
      matched?.requestStatus ||
      matched?.Status ||
      matched?.status ||
      matched?.rawRequestStatus ||
      matched?.RawRequestStatus ||
      data?.RequestStatus ||
      data?.requestStatus ||
      data?.status ||
      ""
  );

  return {
    requestStatus: rawStatus,
    rawRequestStatus: rawStatus,
    requestId: asString(
      matched?.RequestId ||
        matched?.requestId ||
        data?.RequestId ||
        data?.requestId ||
        shortRequestId ||
        query
    ),
    sessionId: asString(
      matched?.SessionId ||
        matched?.sessionId ||
        data?.SessionId ||
        data?.sessionId ||
        query
    ),
    item: matched,
    response: data,
  };
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

  return response.json();
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
// ===============================
export const confirmFileUploadAndType = async (
  { sessionId, userId, s3Key, fileName, fileType, fileSize, docType },
  token
) => {
  assertToken(token);
  if (!sessionId || !userId || !s3Key || !fileName) {
    throw new Error("Missing file confirm parameters");
  }

  const res = await fetch(ENDPOINTS.fileConfirm, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      session: {
        SessionId: sessionId,
        UserId: userId,
        s3Key,
        fileName,
        fileType: fileType || "application/octet-stream",
        fileSize: fileSize ?? 0,
        docType: docType || "OTHER",
      },
    }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(txt || `File confirm failed (${res.status})`);
  }

  return res.json().catch(() => ({}));
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
// ===============================
export const sendCustomerEmail = async (
  { sessionId, userId, to, subject, body, requestId = "", from = "" },
  token
) => {
  assertToken(token);

  if (!sessionId) throw new Error("sessionId is required");
  if (!userId) throw new Error("userId is required");
  if (!to) throw new Error("Recipient email is required");
  if (!subject) throw new Error("Email subject is required");
  if (!body) throw new Error("Email body is required");

  const cleanBody = compactCustomerEmailBody(body);

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
        },
        payload: {
          to,
          from,
          subject,
          body: cleanBody,
          requestId: requestId || "",
          RequestConfirmationEmail: cleanBody,
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
