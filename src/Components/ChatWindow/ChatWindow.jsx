// src/Components/ChatWindow/ChatWindow.jsx
import React, { useEffect, useRef, useState } from "react";
import "./ChatWindow.css";
import { UploadIcon, SendIcon } from "./InputIcons";
import MarkdownRenderer from "./MarkdownRenderer";
import {
  sendChatMessage,
  uploadFilePresigned,
  presignDownload,
} from "../../api/api-config";
import { getAccessToken } from "../../AWS/auth";

const ChatWindow = ({
  chat,
  updateMessages,
  user,
  onFirstMessage,
  adoptServerSessionId,
  showIdleWarning,
  idleSecondsLeft,
}) => {
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState([]);
  const [uploading, setUploading] = useState(false);

  const scrollRef = useRef(null);
  const textareaRef = useRef(null);

  // ✅ REQUIRED: keep latest chat id (avoids stale chat.id during async upload)
  const chatIdRef = useRef(chat?.id);
  useEffect(() => {
    chatIdRef.current = chat?.id;
  }, [chat?.id]);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [chat?.messages, isTyping]);

  // ===============================
  // MESSAGE NORMALIZER
  // ===============================
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
      };
    });

  // ===============================
  // ATTACHMENT DOWNLOAD ROW
  // ===============================
  const AttachmentRow = ({ att }) => {
    const name = att.fileName || att.name || "file";
    const s3Key = att.s3Key;
    const fileType = att.fileType || att.mimeType || "unknown";
    const fileSize = att.fileSize ?? att.size ?? 0;

    const onDownload = async () => {
      try {
        const token = await getAccessToken();
        const data = await presignDownload({ userId: user?.email, s3Key }, token);

        if (!data?.downloadUrl) {
          throw new Error("No download URL returned");
        }

        window.open(data.downloadUrl, "_blank");
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

  // ===============================
  // FILE UPLOAD
  // ===============================
  const handleFileSelect = async (file) => {
    if (!file || !chatIdRef.current || !user) return;

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

      // ✅ use latest chat id from ref (prevents "first attempt" mismatch)
      const currentChatId = chatIdRef.current;

      const res = await uploadFilePresigned(
        { sessionId: currentChatId, userId: user.email, file },
        token
      );

      // ✅ adopt server sessionId FIRST
      if (res?.sessionId && res.sessionId !== currentChatId) {
        adoptServerSessionId?.(res.sessionId);
        chatIdRef.current = res.sessionId; // ✅ keep ref in sync immediately
      }

      // ✅ replace temp with real item
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

  // ===============================
  // SEND MESSAGE
  // ===============================
  const handleSend = async () => {
    const typedText = input.trim();

    const promptText =
      typedText ||
      (pendingAttachments.length ? "Please analyze the attached file." : "");

    if (pendingAttachments.some((a) => a.uploading)) return;
    if (!promptText && pendingAttachments.length === 0) return;

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

      // ✅ use latest session id (important after upload adoption)
      const currentChatId = chatIdRef.current || chat.id;

      const res = await sendChatMessage(
        currentChatId,
        promptText,
        user.email,
        token,
        pendingAttachments
      );

      if (res?.sessionId && res.sessionId !== currentChatId) {
        adoptServerSessionId?.(res.sessionId);
        chatIdRef.current = res.sessionId;
      }

      addMessage({
        sender: "bot",
        role: "assistant",
        text: res?.reply || "No response",
      });

      setPendingAttachments([]);
    } catch (err) {
      console.error("Chat error:", err);
      addMessage({
        sender: "bot",
        role: "assistant",
        text: "❌ Something went wrong. Please try again.",
      });
    } finally {
      setIsTyping(false);
    }
  };

  const hasUploading = pendingAttachments.some((a) => a.uploading);

  return (
    <main className="chat-main chat-layout">
      {showIdleWarning && (
        <div className="idle-warning-banner">
          ⚠️ You’ll be logged out in <strong>{idleSecondsLeft}</strong> seconds
        </div>
      )}

      <div
        className={`messages ${
          !chat?.messages || chat.messages.length === 0 ? "messages-empty" : ""
        }`}
        ref={scrollRef}
      >
        {(!chat?.messages || chat.messages.length === 0) && (
          <div className="welcome-screen">
            <h1 className="welcome-title">What are you working on?</h1>
          </div>
        )}

        {normalize(chat?.messages || []).map((m, index) => (
          <div key={m.id || index} className={`msg-row ${m.sender}`}>
            <div className="msg-bubble">
              <MarkdownRenderer text={m.text || ""} />
              {renderAttachments(m.attachments)}
            </div>
          </div>
        ))}

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
