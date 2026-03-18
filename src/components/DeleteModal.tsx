import { useState } from "react";

interface DeleteModalProps {
  title: string;
  itemName: string;
  warning?: string;        // optional warning e.g. "This lead has 2 transactions"
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}

export default function DeleteModal({ title, itemName, warning, onConfirm, onCancel }: DeleteModalProps) {
  const [reason, setReason] = useState("");
  const [error, setError]   = useState("");

  const handleConfirm = () => {
    if (!reason.trim()) {
      setError("Please enter a reason for deletion.");
      return;
    }
    onConfirm(reason.trim());
  };

  return (
    <div style={S.overlay}>
      <div style={S.modal}>
        {/* Header */}
        <div style={S.header}>
          <span style={S.icon}>🗑️</span>
          <h2 style={S.title}>{title}</h2>
        </div>

        {/* Item name */}
        <p style={S.itemName}>
          You are about to delete: <strong>{itemName}</strong>
        </p>

        {/* Warning if lead has transactions */}
        {warning && (
          <div style={S.warning}>
            ⚠️ {warning}
          </div>
        )}

        {/* Reason input */}
        <div style={S.field}>
          <label style={S.label}>Reason for deletion <span style={{ color: "#ef4444" }}>*</span></label>
          <textarea
            rows={3}
            placeholder="Enter reason for deleting this record…"
            value={reason}
            onChange={e => { setReason(e.target.value); setError(""); }}
            style={S.textarea}
            autoFocus
          />
          {error && <span style={S.error}>{error}</span>}
        </div>

        {/* Actions */}
        <div style={S.actions}>
          <button onClick={onCancel} style={S.cancelBtn}>Cancel</button>
          <button onClick={handleConfirm} style={S.deleteBtn} disabled={!!warning}>
            {warning ? "Cannot Delete" : "Confirm Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(15,23,42,0.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
    backdropFilter: "blur(2px)",
  },
  modal: {
    background: "#fff",
    borderRadius: 16,
    padding: "32px",
    width: "100%",
    maxWidth: 460,
    boxShadow: "0 24px 60px rgba(0,0,0,0.2)",
    fontFamily: "'DM Sans', sans-serif",
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 12,
  },
  icon:  { fontSize: 22 },
  title: { fontSize: 18, fontWeight: 700, margin: 0, color: "#0f172a" },
  itemName: {
    fontSize: 14,
    color: "#475569",
    margin: "0 0 16px",
    padding: "10px 14px",
    background: "#f8fafc",
    borderRadius: 8,
    border: "1px solid #e2e8f0",
  },
  warning: {
    fontSize: 13,
    color: "#b45309",
    background: "#fef9c3",
    border: "1px solid #fde68a",
    borderRadius: 8,
    padding: "10px 14px",
    marginBottom: 16,
  },
  field:    { marginBottom: 20 },
  label:    { display: "block", fontSize: 13, fontWeight: 600, color: "#334155", marginBottom: 6 },
  textarea: {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 8,
    border: "1.5px solid #e2e8f0",
    fontSize: 13,
    color: "#0f172a",
    background: "#f8fafc",
    outline: "none",
    resize: "vertical",
    boxSizing: "border-box",
    fontFamily: "'DM Sans', sans-serif",
  },
  error:  { display: "block", color: "#ef4444", fontSize: 12, marginTop: 4 },
  actions: { display: "flex", gap: 10, justifyContent: "flex-end" },
  cancelBtn: {
    padding: "9px 20px",
    background: "#fff",
    color: "#64748b",
    border: "1.5px solid #e2e8f0",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },
  deleteBtn: {
    padding: "9px 20px",
    background: "#dc2626",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },
};