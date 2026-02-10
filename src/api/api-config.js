// src/api/api-config.js

// ===============================
// API CONFIG FOR AWS API GATEWAY
// ===============================

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

console.log("✅ LOADED api-config.js FROM:", import.meta.url, "TIME:", Date.now());
console.log("✅ api-config UPDATED VERSION 1002"); // bump to confirm new file is running

export const ENDPOINTS = {
  chat: `${API_BASE_URL}/chat`,
  initialise: `${API_BASE_URL}/initialise`,
  rename: `${API_BASE_URL}/rename`,
  delete: `${API_BASE_URL}/delete`,

  // ✅ FILE UPLOAD (NEW FLOW - presigned)
  presignUpload: `${API_BASE_URL}/file/presign-upload`,
  confirmUpload: `${API_BASE_URL}/file/confirm`,

  // ✅ FILE DOWNLOAD (NEW FLOW - presigned)
  presignDownload: `${API_BASE_URL}/file/presign-download`,

  // 🔥 CONFIG
  config: `${API_BASE_URL}/config`,
};

// ===============================
// ⏱️ REQUEST TIMEOUT (30s)
// ===============================
const REQUEST_TIMEOUT = 30000;

const debugLog = (...args) => console.log("[api-config]", ...args);

const assertToken = (token) => {
  if (!token) throw new Error("No token provided");
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
    }));
};

// ===============================
// SEND CHAT MESSAGE (supports attachments)
// ===============================
export const sendChatMessage = async (
  chatId,
  text,
  userEmail,
  token,
  attachments = []
) => {
  assertToken(token);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const normalized = normalizeAttachments(attachments);

    const response = await fetch(ENDPOINTS.chat, {
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
      const errText = await response.text();
      throw new Error(errText || "Chat API failed");
    }

    return await response.json();
  } catch (err) {
    if (err.name === "AbortError") throw new Error("REQUEST_TIMEOUT");
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
    const errText = await response.text();
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

  if (!res.ok) throw new Error("Rename failed");
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

  if (!res.ok) throw new Error("Delete failed");
};

// ===============================
// ✅ PRESIGNED UPLOAD (ONLY FLOW)
// ===============================
export const presignUpload = async (
  { sessionId, userId, fileName, fileType },
  token
) => {
  assertToken(token);

  const res = await fetch(ENDPOINTS.presignUpload, {
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
        fileType,
      },
    }),
  });

  if (!res.ok) throw new Error(await res.text());
  return res.json();
};

export const confirmUpload = async (
  { sessionId, userId, s3Key, fileName, fileType, fileSize },
  token
) => {
  assertToken(token);

  const res = await fetch(ENDPOINTS.confirmUpload, {
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
        fileType,
        fileSize,
      },
    }),
  });

  if (!res.ok) throw new Error(await res.text());
  return res.json();
};

// ✅ Full helper: presign -> PUT to S3 -> confirm
export const uploadFilePresigned = async ({ sessionId, userId, file }, token) => {
  assertToken(token);
  if (!file) throw new Error("File missing");

  debugLog("✅ PRESIGNED upload flow starting:", file.name);

  const fileType = file.type || "application/octet-stream";

  // 1) presign
  // ✅ REQUIRED FIX: capture returned sessionId (backend may upgrade default-chat/temp-* to real)
  const presignRes = await presignUpload(
    { sessionId, userId, fileName: file.name, fileType },
    token
  );

  const uploadUrl = presignRes.uploadUrl;
  const s3Key = presignRes.s3Key;
  const resolvedSessionId = presignRes.sessionId || sessionId;

  // 2) PUT to S3 (NO Authorization header)
  const putRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": fileType },
    body: file,
  });

  if (!putRes.ok) {
    const errText = await putRes.text().catch(() => "");
    throw new Error(`S3 PUT failed: ${putRes.status} ${errText}`);
  }

  // 3) confirm upload -> save metadata in DynamoDB
  // ✅ REQUIRED FIX: confirm using resolvedSessionId (NOT the old default-chat)
  const confirmRes = await confirmUpload(
    {
      sessionId: resolvedSessionId,
      userId,
      s3Key,
      fileName: file.name,
      fileType,
      fileSize: file.size,
    },
    token
  );

  // ✅ return sessionId to UI so it can adopt
  return { ...confirmRes, s3Key, sessionId: resolvedSessionId };
};

// ===============================
// ✅ PRESIGNED DOWNLOAD
// ===============================
export const presignDownload = async (
  {
    userId,
    s3Key,
    sessionId = null,
    fileName = null,
    fileType = null, // ✅ ADDED (optional)
  },
  token
) => {
  assertToken(token);

  const res = await fetch(ENDPOINTS.presignDownload, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      session: {
        UserId: userId,
        SessionId: sessionId,
        s3Key,
        fileName,
        fileType, // ✅ ADDED
      },
    }),
  });

  if (!res.ok) throw new Error(await res.text());
  return res.json();
};

// ✅ helper to trigger download without opening new tab
export const triggerBrowserDownload = (downloadUrl, fileName = "download") => {
  const a = document.createElement("a");
  a.href = downloadUrl;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
};

// ✅ Full helper: presign-download -> trigger browser download
export const downloadFilePresigned = async (
  { userId, s3Key, sessionId = null, fileName = null, fileType = null },
  token
) => {
  assertToken(token);

  const res = await presignDownload(
    { userId, s3Key, sessionId, fileName, fileType },
    token
  );

  const url = res.downloadUrl;
  const resolvedName = res.fileName || fileName || "download";

  if (!url) throw new Error("Missing downloadUrl from backend");

  triggerBrowserDownload(url, resolvedName);

  // return response in case UI wants it
  return res;
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
