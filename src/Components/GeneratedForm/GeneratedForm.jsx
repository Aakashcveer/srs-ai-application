import React, { useEffect, useMemo, useState } from "react";
import "./GeneratedForm.css";

/**
 * KC UI:
 * Left side fixed labels, right side editable inputs
 * Button: Update & Save
 *
 * Props:
 * - sessionId
 * - userEmail
 * - initialFormState: { title, schema, values }
 * - onSave(values) optional
 * - onSubmitSave(payload) -> async (calls API)
 */
const defaultSchema = [
  { key: "projectName", label: "Project Name", type: "text" },
  { key: "owner", label: "Owner", type: "text" },
  { key: "dueDate", label: "Due Date", type: "date" },
  { key: "priority", label: "Priority", type: "select", options: ["Low", "Medium", "High"] },
  { key: "notes", label: "Notes", type: "textarea" },
];

export default function GeneratedForm({
  sessionId,
  userEmail,
  initialFormState,
  onSubmitSave,
  savingLabel = "Update & Save",
}) {
  const schema = useMemo(() => {
    const s = initialFormState?.schema;
    if (Array.isArray(s) && s.length) return s;
    if (s && Array.isArray(s.fields) && s.fields.length) return s.fields;
    return defaultSchema;
  }, [initialFormState]);

  const [title, setTitle] = useState(initialFormState?.title || "Generated Form");
  const [values, setValues] = useState(() => initialFormState?.values || {});
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");

  useEffect(() => {
    // when formState changes (session switch), refresh UI
    setTitle(initialFormState?.title || "Generated Form");
    setValues(initialFormState?.values || {});
    setSavedMsg("");
  }, [initialFormState]);

  const setField = (key, val) => {
    setValues((prev) => ({ ...prev, [key]: val }));
    setSavedMsg("");
  };

  const handleSave = async () => {
    if (!onSubmitSave) return;

    setSaving(true);
    setSavedMsg("");
    try {
      const payload = {
        session: { UserId: userEmail, SessionId: sessionId },
        formTitle: title,
        schema,     // store schema (so it can render again after refresh)
        values,     // store values user edited
      };

      await onSubmitSave(payload);
      setSavedMsg("✅ Saved");
    } catch (e) {
      console.error("Form save failed:", e);
      setSavedMsg(`❌ Save failed: ${e?.message || "Unknown error"}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="gf-card">
      <div className="gf-header">
        <div className="gf-title">{title}</div>
        <div className="gf-sub">
          {userEmail ? `User: ${userEmail}` : ""} {sessionId ? `• Session: ${sessionId}` : ""}
        </div>
      </div>

      <div className="gf-grid">
        {schema.map((f) => {
          const v = values?.[f.key] ?? "";
          return (
            <div className="gf-row" key={f.key}>
              <div className="gf-left">
                <div className="gf-label">{f.label}</div>
              </div>

              <div className="gf-right">
                {f.type === "textarea" ? (
                  <textarea
                    className="gf-input gf-textarea"
                    value={v}
                    onChange={(e) => setField(f.key, e.target.value)}
                    placeholder={f.placeholder || ""}
                    rows={3}
                  />
                ) : f.type === "select" ? (
                  <select
                    className="gf-input"
                    value={v}
                    onChange={(e) => setField(f.key, e.target.value)}
                  >
                    <option value="" disabled>
                      Select...
                    </option>
                    {(f.options || []).map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    className="gf-input"
                    type={f.type || "text"}
                    value={v}
                    onChange={(e) => setField(f.key, e.target.value)}
                    placeholder={f.placeholder || ""}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="gf-footer">
        <button className="gf-save" onClick={handleSave} disabled={saving || !onSubmitSave}>
          {saving ? "Saving..." : savingLabel}
        </button>
        <div className="gf-status">{savedMsg}</div>
      </div>
    </div>
  );
}