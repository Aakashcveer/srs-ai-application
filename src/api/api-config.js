// src/api/api-config.js

// ===============================
// API CONFIG FOR AWS API GATEWAY
// ===============================
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

console.log("✅ LOADED api-config.js FROM:", import.meta.url, "TIME:", Date.now());
console.log("✅ api-config UPDATED VERSION 1018");

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
  const text = await res.text().catch(() => "");
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch (e) {
    data = {};
  }
  return { text, data };
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

  const res = await kcFileDownload({ sessionId, userId, fileName, s3Key, fileType }, token);

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
        payload,
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
          body: body || "",
          requestId: requestId || "",
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
  { sessionId, userId, to, subject, body, requestId = "" },
  token
) => {
  assertToken(token);

  if (!sessionId) throw new Error("sessionId is required");
  if (!userId) throw new Error("userId is required");
  if (!to) throw new Error("Recipient email is required");
  if (!subject) throw new Error("Email subject is required");
  if (!body) throw new Error("Email body is required");

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
        },
        payload: {
          toEmail: to,
          subject,
          body,
          requestId: requestId || "",
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