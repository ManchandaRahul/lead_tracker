import { useEffect, useState } from "react";
import { updatePassword } from "firebase/auth";
import { auth } from "../firebase/config";
import { logActivity } from "../firebase/activityLog";

export default function ChangePasswordModal({
  open,
  onClose,
  targetUid,
  targetLabel,
  actorName,
  isSelf,
}: {
  open: boolean;
  onClose: () => void;
  targetUid: string;
  targetLabel: string;
  actorName: string;
  isSelf: boolean;
}) {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (!open) {
      setNewPassword("");
      setConfirmPassword("");
      setSaving(false);
      setMessage(null);
    }
  }, [open]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

    if (newPassword.length < 6) {
      setMessage({ type: "error", text: "Password must be at least 6 characters long." });
      return;
    }

    if (newPassword !== confirmPassword) {
      setMessage({ type: "error", text: "Passwords do not match." });
      return;
    }

    if (!auth.currentUser) {
      setMessage({ type: "error", text: "Your auth session is not ready yet. Please refresh and try again." });
      return;
    }

    setSaving(true);

    try {
      if (isSelf) {
        await updatePassword(auth.currentUser, newPassword);
      } else {
        const response = await fetch("/api/change-password", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${await auth.currentUser.getIdToken()}`,
          },
          body: JSON.stringify({
            uid: targetUid,
            newPassword,
          }),
        });

        const rawResponse = await response.text();
        let payload: any = {};
        if (rawResponse) {
          try {
            payload = JSON.parse(rawResponse);
          } catch {
            payload = { error: rawResponse };
          }
        }
        if (!response.ok) {
          throw new Error(payload?.error || "Failed to update password.");
        }
      }

      await logActivity(targetUid, targetLabel, "users", {
        actionType: "USER_PASSWORD_CHANGED",
        description: isSelf
          ? `Password was changed for "${targetLabel}".`
          : `Password was reset for "${targetLabel}".`,
        actionBy: actorName,
        timestamp: new Date().toISOString(),
      });

      setMessage({ type: "success", text: "Password updated successfully." });
      setTimeout(() => onClose(), 500);
    } catch (error: any) {
      setMessage({ type: "error", text: error?.message || "Failed to update password." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={S.backdrop}>
      <div style={S.card}>
        <div style={S.header}>
          <div>
            <h2 style={S.title}>{isSelf ? "Change Password" : `Change Password for ${targetLabel}`}</h2>
            <div style={S.subtitle}>
              {isSelf
                ? "Only your password will be updated."
                : "This will update the selected user password only."}
            </div>
          </div>
          <button onClick={onClose} style={S.closeBtn}>×</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={S.field}>
            <label style={S.label}>New Password</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              style={S.input}
              autoComplete="new-password"
            />
          </div>
          <div style={S.field}>
            <label style={S.label}>Confirm Password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              style={S.input}
              autoComplete="new-password"
            />
          </div>

          {message && (
            <div
              style={{
                ...S.message,
                background: message.type === "success" ? "#f0fdf4" : "#fef2f2",
                color: message.type === "success" ? "#16a34a" : "#dc2626",
                borderColor: message.type === "success" ? "#bbf7d0" : "#fecaca",
              }}
            >
              {message.text}
            </div>
          )}

          <div style={S.actions}>
            <button type="submit" style={S.primaryBtn} disabled={saving}>
              {saving ? "Saving..." : "Save Password"}
            </button>
            <button type="button" onClick={onClose} style={S.secondaryBtn}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  backdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(15,23,42,0.55)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
    padding: 20,
  },
  card: {
    width: "100%",
    maxWidth: 460,
    background: "#ffffff",
    borderRadius: 18,
    border: "1px solid #e2e8f0",
    boxShadow: "0 24px 60px rgba(15,23,42,0.22)",
    padding: 24,
    fontFamily: "'DM Sans', 'Segoe UI', sans-serif",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 20,
  },
  title: {
    margin: 0,
    fontSize: 18,
    fontWeight: 800,
    color: "#0f172a",
  },
  subtitle: {
    marginTop: 6,
    fontSize: 12,
    color: "#64748b",
    lineHeight: 1.45,
  },
  closeBtn: {
    border: "none",
    background: "transparent",
    color: "#64748b",
    fontSize: 24,
    cursor: "pointer",
    lineHeight: 1,
  },
  field: {
    display: "grid",
    gap: 6,
    marginBottom: 14,
  },
  label: {
    fontSize: 12,
    fontWeight: 700,
    color: "#475569",
  },
  input: {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 10,
    border: "1.5px solid #e2e8f0",
    fontSize: 13,
    background: "#f8fafc",
    outline: "none",
    color: "#0f172a",
    boxSizing: "border-box",
  },
  message: {
    marginTop: 4,
    marginBottom: 14,
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid",
    fontSize: 12,
    fontWeight: 600,
  },
  actions: {
    display: "flex",
    gap: 10,
    marginTop: 18,
  },
  primaryBtn: {
    padding: "10px 16px",
    background: "#0f172a",
    color: "#fff",
    border: "none",
    borderRadius: 12,
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
    whiteSpace: "nowrap",
    boxShadow: "0 10px 22px rgba(15,23,42,0.16)",
  },
  secondaryBtn: {
    padding: "10px 14px",
    background: "#fff",
    color: "#0f172a",
    border: "1px solid #d7dee8",
    borderRadius: 12,
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
};
