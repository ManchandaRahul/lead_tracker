import { useEffect, useState } from "react";
import { signOut } from "firebase/auth";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { auth, db } from "../firebase/config";
import { logActivity } from "../firebase/activityLog";
import AppPageHeader from "../components/AppPageHeader";
import ChangePasswordModal from "../components/ChangePasswordModal";
import { Page } from "../navigation";
import { getSessionUser } from "../accessControl";

type AppUser = {
  id: string;
  uid?: string;
  username: string;
  email: string;
  displayName?: string;
  role: "admin" | "user" | "restricted_user";
  status?: "active" | "inactive";
  allowedLeadIds?: string[];
  createdAt?: any;
  updatedAt?: any;
};

type LeadOption = {
  id: string;
  leadId: string;
  accountName: string;
};

const EMPTY_USER_FORM = {
  username: "",
  email: "",
  displayName: "",
  role: "user" as "admin" | "user" | "restricted_user",
  status: "active" as "active" | "inactive",
  temporaryPassword: "",
  allowedLeadIds: [] as string[],
};

export default function Users({ onNavigate }: { onNavigate: (p: Page, leadId?: string) => void }) {
  const sessionUser = getSessionUser();
  const isAdmin = sessionUser.role === "admin";
  const isRootPasswordAdmin =
    sessionUser.username === "admin" &&
    sessionUser.email === "admin@leadtracker.app";
  const logout = () => { signOut(auth); localStorage.removeItem("leadUser"); window.location.reload(); };

  const [users, setUsers] = useState<AppUser[]>([]);
  const [leads, setLeads] = useState<LeadOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [formData, setFormData] = useState({ ...EMPTY_USER_FORM });
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [passwordTarget, setPasswordTarget] = useState<AppUser | null>(null);
  const [leadAccessTarget, setLeadAccessTarget] = useState<AppUser | null>(null);
  const [leadAccessDraft, setLeadAccessDraft] = useState<string[]>([]);

  useEffect(() => {
    if (!isAdmin) return;

    const usersQuery = query(collection(db, "users"), orderBy("username"));
    const unsubscribe = onSnapshot(
      usersQuery,
      (snap) => {
        setUsers(snap.docs.map((d) => ({ id: d.id, ...d.data() } as AppUser)));
        setLoading(false);
      },
      (error) => {
        console.error("Users snapshot error:", error);
        setMessage({ type: "error", text: "Unable to load users. Please check Firestore permissions." });
        setLoading(false);
      }
    );

    const leadsQuery = query(collection(db, "leads"), orderBy("accountName"));
    const unsubscribeLeads = onSnapshot(leadsQuery, (snap) => {
      setLeads(
        snap.docs.map((d) => {
          const data = d.data() as LeadOption;
          return {
            id: d.id,
            leadId: data.leadId,
            accountName: data.accountName,
          };
        })
      );
    });

    return () => {
      unsubscribe();
      unsubscribeLeads();
    };
  }, [isAdmin]);

  if (!isAdmin) return null;

  const resetForm = () => {
    setFormData({ ...EMPTY_USER_FORM });
    setShowCreateForm(false);
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    try {
      if (!auth.currentUser) {
        throw new Error("Your auth session is not ready yet. Please refresh and try again.");
      }

      const response = await fetch("/api/create-user", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${await auth.currentUser.getIdToken()}`,
        },
        body: JSON.stringify({
          username: formData.username.trim(),
          email: formData.email.trim(),
          displayName: formData.displayName.trim(),
          role: formData.role,
          status: formData.status,
          temporaryPassword: formData.temporaryPassword,
          allowedLeadIds: formData.role === "restricted_user" ? formData.allowedLeadIds : [],
          createdBy: sessionUser.username,
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
        throw new Error(payload?.error || "Failed to create user.");
      }

      await logActivity(payload.uid, formData.displayName.trim() || formData.username.trim(), "users", {
        actionType: "USER_CREATED",
        description: `User "${formData.username.trim()}" was created with role "${formData.role}"`,
        actionBy: sessionUser.username,
        timestamp: new Date().toISOString(),
      });

      setMessage({ type: "success", text: `User "${formData.username.trim()}" created successfully.` });
      resetForm();
    } catch (err: any) {
      console.error("Create user error:", err);
      setMessage({ type: "error", text: err.message || "Failed to create user." });
    } finally {
      setSaving(false);
    }
  };

  const handleFieldChange = (key: keyof typeof EMPTY_USER_FORM, value: string) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  const toggleFormLead = (leadId: string) => {
    setFormData((prev) => ({
      ...prev,
      allowedLeadIds: prev.allowedLeadIds.includes(leadId)
        ? prev.allowedLeadIds.filter((id) => id !== leadId)
        : [...prev.allowedLeadIds, leadId],
    }));
  };

  const updateUser = async (user: AppUser, updates: Partial<AppUser>) => {
    try {
      if (!auth.currentUser) {
        throw new Error("Your auth session is not ready yet. Please refresh and try again.");
      }

      const response = await fetch("/api/update-user", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${await auth.currentUser.getIdToken()}`,
        },
        body: JSON.stringify({
          uid: user.uid || user.id,
          role: updates.role || user.role,
          status: updates.status || user.status || "active",
          allowedLeadIds:
            (updates.role || user.role) === "restricted_user"
              ? updates.allowedLeadIds ?? user.allowedLeadIds ?? []
              : [],
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
        throw new Error(payload?.error || "Failed to update user.");
      }

      if (updates.role && updates.role !== user.role) {
        await logActivity(user.uid || user.id, user.displayName || user.username, "users", {
          actionType: "USER_ROLE_CHANGED",
          description: `User "${user.username}" role changed from "${user.role}" to "${updates.role}".`,
          previousValue: user.role,
          newValue: updates.role,
          actionBy: sessionUser.username,
          timestamp: new Date().toISOString(),
        });
      }

      if (updates.status && updates.status !== (user.status || "active")) {
        await logActivity(user.uid || user.id, user.displayName || user.username, "users", {
          actionType: "USER_STATUS_CHANGED",
          description: `User "${user.username}" status changed from "${user.status || "active"}" to "${updates.status}".`,
          previousValue: user.status || "active",
          newValue: updates.status,
          actionBy: sessionUser.username,
          timestamp: new Date().toISOString(),
        });
      }

      if (updates.allowedLeadIds) {
        await logActivity(user.uid || user.id, user.displayName || user.username, "users", {
          actionType: "USER_LEAD_ACCESS_CHANGED",
          description: `Lead access updated for "${user.username}". ${updates.allowedLeadIds.length} lead(s) assigned.`,
          actionBy: sessionUser.username,
          timestamp: new Date().toISOString(),
        });
      }

      setMessage({ type: "success", text: `User "${user.username}" updated successfully.` });
    } catch (err: any) {
      console.error("Update user error:", err);
      setMessage({ type: "error", text: err.message || `Failed to update "${user.username}".` });
    }
  };

  return (
    <div style={S.page}>
      <AppPageHeader
        current="users"
        onNavigate={onNavigate}
        isAdmin={isAdmin}
        onLogout={logout}
        showAdminBadge
        bottomContent={
          <div style={S.headerRight}>
            <button onClick={() => { setMessage(null); setShowCreateForm((prev) => !prev); }} style={S.btnPrimary}>
              {showCreateForm ? "Close Form" : "+ Add User"}
            </button>
          </div>
        }
      />

      {message && (
        <div style={{
          padding: "10px 24px",
          background: message.type === "success" ? "#f0fdf4" : "#fef2f2",
          color: message.type === "success" ? "#16a34a" : "#dc2626",
          fontSize: 13,
          borderBottom: "1px solid #e2e8f0",
        }}>
          {message.text}
        </div>
      )}

      {showCreateForm && (
        <div style={S.formCard}>
          <div style={S.formHeader}>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Create User</h2>
            <button onClick={resetForm} style={S.closeBtn}>X</button>
          </div>
          <form onSubmit={handleCreateUser}>
            <div style={S.formGrid}>
              <div style={S.formField}>
                <label style={S.fLabel}>Username</label>
                <input required style={S.fInput} value={formData.username} onChange={(e) => handleFieldChange("username", e.target.value)} />
              </div>
              <div style={S.formField}>
                <label style={S.fLabel}>Email</label>
                <input required type="email" style={S.fInput} value={formData.email} onChange={(e) => handleFieldChange("email", e.target.value)} />
              </div>
              <div style={S.formField}>
                <label style={S.fLabel}>Display Name</label>
                <input required style={S.fInput} value={formData.displayName} onChange={(e) => handleFieldChange("displayName", e.target.value)} />
              </div>
              <div style={S.formField}>
                <label style={S.fLabel}>Role</label>
                <select style={S.fInput} value={formData.role} onChange={(e) => handleFieldChange("role", e.target.value)}>
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                  <option value="restricted_user">Restricted User</option>
                </select>
              </div>
              <div style={S.formField}>
                <label style={S.fLabel}>Status</label>
                <select style={S.fInput} value={formData.status} onChange={(e) => handleFieldChange("status", e.target.value)}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
              <div style={S.formField}>
                <label style={S.fLabel}>Temporary Password</label>
                <input required type="password" style={S.fInput} value={formData.temporaryPassword} onChange={(e) => handleFieldChange("temporaryPassword", e.target.value)} />
              </div>
            </div>

            {formData.role === "restricted_user" && (
              <div style={S.leadPickerWrap}>
                <div style={S.leadPickerHeader}>
                  <div style={S.fLabel}>Select Allowed Leads</div>
                  <div style={S.leadPickerHint}>{formData.allowedLeadIds.length} selected</div>
                </div>
                <div style={S.leadPickerGrid}>
                  {leads.map((lead) => (
                    <label key={lead.id} style={S.leadPickerItem}>
                      <input
                        type="checkbox"
                        checked={formData.allowedLeadIds.includes(lead.leadId)}
                        onChange={() => toggleFormLead(lead.leadId)}
                      />
                      <span>{lead.leadId} — {lead.accountName}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div style={{ padding: "0 24px 24px", display: "flex", gap: 10 }}>
              <button type="submit" style={S.btnPrimary} disabled={saving}>
                {saving ? "Creating..." : "Create User"}
              </button>
              <button type="button" onClick={resetForm} style={S.btnOutline}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div style={{ padding: "20px 24px 40px" }}>
        <div style={S.tableWrap}>
          <table style={S.table}>
            <thead>
              <tr>
                {["Username", "Display Name", "Email", "Role", "Status", "Actions"].map((h) => (
                  <th key={h} style={h === "Actions" ? S.thSticky : S.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={6} style={{ textAlign: "center", padding: "48px 0", color: "#94a3b8", fontSize: 14 }}>
                    Loading users...
                  </td>
                </tr>
              )}
              {!loading && users.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ textAlign: "center", padding: "48px 0", color: "#94a3b8", fontSize: 14 }}>
                    No users found yet.
                  </td>
                </tr>
              )}
              {!loading && users.map((user) => (
                <tr key={user.id} style={S.tr}>
                  <td style={{ ...S.td, fontWeight: 700 }}>{user.username}</td>
                  <td style={S.td}>{user.displayName || "-"}</td>
                  <td style={{ ...S.td, color: "#2563eb" }}>{user.email || "-"}</td>
                  <td style={S.td}>
                    <select
                      value={user.role}
                      onChange={(e) => updateUser(user, { role: e.target.value as "admin" | "user" | "restricted_user" })}
                      style={S.inlineSelect}
                    >
                      <option value="user">User</option>
                      <option value="admin">Admin</option>
                      <option value="restricted_user">Restricted User</option>
                    </select>
                  </td>
                  <td style={S.td}>
                    <select
                      value={user.status || "active"}
                      onChange={(e) => updateUser(user, { status: e.target.value as "active" | "inactive" })}
                      style={S.inlineSelect}
                    >
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                    </select>
                  </td>
                  <td style={S.tdSticky}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {user.role === "restricted_user" && (
                        <button
                          onClick={() => {
                            setLeadAccessTarget(user);
                            setLeadAccessDraft(user.allowedLeadIds || []);
                          }}
                          style={S.accessBtn}
                        >
                          Manage Leads
                        </button>
                      )}
                      {isRootPasswordAdmin && (
                        <button onClick={() => setPasswordTarget(user)} style={S.passwordBtn}>
                          Change Password
                        </button>
                      )}
                      <span style={{ fontSize: 12, color: "#64748b" }}>
                        UID: {user.uid || user.id}
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {passwordTarget && (
        <ChangePasswordModal
          open={!!passwordTarget}
          onClose={() => setPasswordTarget(null)}
          targetUid={passwordTarget.uid || passwordTarget.id}
          targetLabel={passwordTarget.displayName || passwordTarget.username}
          actorName={sessionUser.username}
          isSelf={(passwordTarget.uid || passwordTarget.id) === (sessionUser.uid || "")}
        />
      )}

      {leadAccessTarget && (
        <div style={S.modalBackdrop}>
          <div style={S.modalCard}>
            <div style={S.modalHeader}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "#0f172a" }}>
                Select Leads for {leadAccessTarget.username}
              </h2>
              <button
                type="button"
                onClick={() => {
                  setLeadAccessTarget(null);
                  setLeadAccessDraft([]);
                }}
                style={S.closeBtn}
              >
                X
              </button>
            </div>
            <div style={S.leadPickerGridModal}>
              {leads.map((lead) => (
                <label key={lead.id} style={S.leadPickerItem}>
                  <input
                    type="checkbox"
                    checked={leadAccessDraft.includes(lead.leadId)}
                    onChange={() =>
                      setLeadAccessDraft((prev) =>
                        prev.includes(lead.leadId)
                          ? prev.filter((id) => id !== lead.leadId)
                          : [...prev, lead.leadId]
                      )
                    }
                  />
                  <span>{lead.leadId} — {lead.accountName}</span>
                </label>
              ))}
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 20 }}>
              <button
                type="button"
                onClick={() => {
                  setLeadAccessTarget(null);
                  setLeadAccessDraft([]);
                }}
                style={S.btnOutline}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (!leadAccessTarget) return;
                  await updateUser(leadAccessTarget, { allowedLeadIds: leadAccessDraft });
                  setLeadAccessTarget(null);
                  setLeadAccessDraft([]);
                }}
                style={S.btnPrimary}
              >
                Save Lead Access
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", background: "#f8fafc", fontFamily: "'DM Sans', 'Segoe UI', sans-serif", color: "#0f172a" },
  header: { display: "grid", padding: "18px 24px 14px", background: "#ffffff", borderBottom: "1px solid #e9eef5", boxShadow: "0 8px 24px rgba(15,23,42,0.06)", position: "sticky", top: 0, zIndex: 100, gap: 14 },
  headerTop: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" as "wrap" },
  headerBottom: { display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" as "wrap" },
  headerLeft: { display: "flex", alignItems: "center", gap: 12 },
  headerTitle: { fontSize: 22, fontWeight: 800, margin: 0, letterSpacing: "-0.5px", color: "#0f172a" },
  adminBadge: { fontSize: 11, fontWeight: 600, padding: "3px 8px", background: "#ede9fe", color: "#7c3aed", borderRadius: 6, border: "1px solid #ddd6fe" },
  navTabs: { display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap", width: "100%", order: 3 },
  navTab: { padding: "6px 14px", background: "transparent", color: "#64748b", border: "1.5px solid #e2e8f0", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" },
  navTabActive: { background: "#0f172a", color: "#fff", border: "1.5px solid #0f172a" },
  headerRight: { display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10, flexWrap: "wrap" as "wrap", flex: "1 1 280px" },
  btnPrimary: { padding: "10px 16px", background: "#0f172a", color: "#fff", border: "none", borderRadius: 12, fontSize: 13, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", boxShadow: "0 10px 22px rgba(15,23,42,0.16)" },
  btnOutline: { padding: "10px 14px", background: "#fff", color: "#0f172a", border: "1px solid #d7dee8", borderRadius: 12, fontSize: 13, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", boxShadow: "0 1px 2px rgba(15,23,42,0.04)" },
  btnLogout: { padding: "10px 14px", background: "#fff", color: "#ef4444", border: "1px solid #fecaca", borderRadius: 12, fontSize: 13, fontWeight: 700, cursor: "pointer" },
  formCard: { margin: "20px 24px", background: "#ffffff", borderRadius: 16, border: "1px solid #e2e8f0", boxShadow: "0 4px 20px rgba(0,0,0,0.06)", overflow: "hidden" },
  formHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 24px", borderBottom: "1px solid #f1f5f9", background: "#f8fafc" },
  closeBtn: { background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "#64748b", padding: "4px 8px" },
  formGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: "16px 20px", padding: "20px 24px 24px" },
  formField: { display: "flex", flexDirection: "column" },
  fLabel: { fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 5 },
  fInput: { padding: "9px 12px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 13, background: "#f8fafc", outline: "none", color: "#0f172a", width: "100%", boxSizing: "border-box" },
  leadPickerWrap: { padding: "0 24px 24px" },
  leadPickerHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 10 },
  leadPickerHint: { fontSize: 12, color: "#64748b", fontWeight: 600 },
  leadPickerGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: 10, maxHeight: 220, overflowY: "auto", padding: 2 },
  leadPickerGridModal: { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: 10, maxHeight: 320, overflowY: "auto", paddingRight: 4 },
  leadPickerItem: { display: "flex", alignItems: "flex-start", gap: 8, padding: "10px 12px", border: "1px solid #e2e8f0", borderRadius: 10, background: "#f8fafc", fontSize: 13, color: "#334155", cursor: "pointer" },
  tableWrap: { overflowX: "auto", borderRadius: 12, border: "1px solid #e2e8f0", background: "#fff", boxShadow: "0 2px 12px rgba(0,0,0,0.04)" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: { padding: "12px 14px", textAlign: "left", background: "#f8fafc", color: "#475569", fontWeight: 700, fontSize: 12, whiteSpace: "nowrap", borderBottom: "1px solid #e2e8f0", position: "sticky", top: 0 },
  thSticky: { padding: "12px 14px", textAlign: "left", background: "#f8fafc", color: "#475569", fontWeight: 700, fontSize: 12, whiteSpace: "nowrap", borderBottom: "1px solid #e2e8f0", position: "sticky", top: 0, right: 0, zIndex: 3, boxShadow: "-2px 0 6px rgba(0,0,0,0.06)" },
  tr: { borderBottom: "1px solid #f1f5f9" },
  td: { padding: "11px 14px", color: "#334155", verticalAlign: "middle", fontSize: 13 },
  tdSticky: { padding: "11px 14px", color: "#334155", verticalAlign: "middle", fontSize: 13, position: "sticky", right: 0, background: "#ffffff", zIndex: 1, boxShadow: "-2px 0 6px rgba(0,0,0,0.06)" },
  inlineSelect: { padding: "7px 10px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 13, background: "#f8fafc", outline: "none", color: "#0f172a" },
  passwordBtn: { padding: "6px 10px", background: "#eff6ff", color: "#2563eb", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 12, textAlign: "left" },
  accessBtn: { padding: "6px 10px", background: "#f8fafc", color: "#0f172a", border: "1px solid #d7dee8", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 12, textAlign: "left" },
  modalBackdrop: { position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20 },
  modalCard: { background: "#ffffff", borderRadius: 16, padding: 24, width: "100%", maxWidth: 760, boxShadow: "0 24px 60px rgba(0,0,0,0.2)" },
  modalHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 18 },
};
