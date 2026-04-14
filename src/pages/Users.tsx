import { useEffect, useState } from "react";
import { signOut } from "firebase/auth";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { auth, db } from "../firebase/config";
import { logActivity } from "../firebase/activityLog";

type Page = "leads" | "transactions" | "activity" | "users";

type AppUser = {
  id: string;
  uid?: string;
  username: string;
  email: string;
  displayName?: string;
  role: "admin" | "user";
  status?: "active" | "inactive";
  createdAt?: any;
  updatedAt?: any;
};

const EMPTY_USER_FORM = {
  username: "",
  email: "",
  displayName: "",
  role: "user" as "admin" | "user",
  status: "active" as "active" | "inactive",
  temporaryPassword: "",
};

export default function Users({ onNavigate }: { onNavigate: (p: Page, leadId?: string) => void }) {
  const sessionUser = JSON.parse(localStorage.getItem("leadUser")!);
  const isAdmin = sessionUser.role === "admin";
  const logout = () => { signOut(auth); localStorage.removeItem("leadUser"); window.location.reload(); };

  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [formData, setFormData] = useState({ ...EMPTY_USER_FORM });
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

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

    return () => unsubscribe();
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
          createdBy: sessionUser.username,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to create user.");
      }

      await logActivity(payload.uid, formData.displayName.trim() || formData.username.trim(), "leads", {
        actionType: "LEAD_EDITED",
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
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to update user.");
      }

      setMessage({ type: "success", text: `User "${user.username}" updated successfully.` });
    } catch (err: any) {
      console.error("Update user error:", err);
      setMessage({ type: "error", text: err.message || `Failed to update "${user.username}".` });
    }
  };

  return (
    <div style={S.page}>
      <div style={S.header}>
        <div style={S.headerLeft}>
          <img src="/k1.svg" alt="Karuyaki Logo" style={{ height: 36 }} />
          <h1 style={S.headerTitle}>Lead Tracker</h1>
          <span style={S.adminBadge}>Admin Only</span>
        </div>
        <div style={S.navTabs}>
          <button onClick={() => onNavigate("leads")} style={S.navTab}>Leads</button>
          <button onClick={() => onNavigate("transactions")} style={S.navTab}>Activities</button>
          <button onClick={() => onNavigate("activity")} style={S.navTab}>Activity Log</button>
          <button onClick={() => onNavigate("users")} style={{ ...S.navTab, ...S.navTabActive }}>Users</button>
        </div>
        <div style={S.headerRight}>
          <button onClick={() => { setMessage(null); setShowCreateForm((prev) => !prev); }} style={S.btnPrimary}>
            {showCreateForm ? "Close Form" : "+ Add User"}
          </button>
          <button onClick={logout} style={S.btnLogout}>Logout</button>
        </div>
      </div>

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
                      onChange={(e) => updateUser(user, { role: e.target.value as "admin" | "user" })}
                      style={S.inlineSelect}
                    >
                      <option value="user">User</option>
                      <option value="admin">Admin</option>
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
                    <span style={{ fontSize: 12, color: "#64748b" }}>
                      UID: {user.uid || user.id}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", background: "#f8fafc", fontFamily: "'DM Sans', 'Segoe UI', sans-serif", color: "#0f172a" },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 24px", background: "#ffffff", borderBottom: "1px solid #e2e8f0", position: "sticky", top: 0, zIndex: 100, gap: 12, flexWrap: "wrap" as "wrap" },
  headerLeft: { display: "flex", alignItems: "center", gap: 10 },
  headerTitle: { fontSize: 20, fontWeight: 700, margin: 0, letterSpacing: "-0.4px" },
  adminBadge: { fontSize: 11, fontWeight: 600, padding: "3px 8px", background: "#ede9fe", color: "#7c3aed", borderRadius: 6, border: "1px solid #ddd6fe" },
  navTabs: { display: "flex", alignItems: "center", gap: 4 },
  navTab: { padding: "6px 14px", background: "transparent", color: "#64748b", border: "1.5px solid #e2e8f0", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" },
  navTabActive: { background: "#0f172a", color: "#fff", border: "1.5px solid #0f172a" },
  headerRight: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" as "wrap" },
  btnPrimary: { padding: "8px 16px", background: "#0f172a", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" },
  btnOutline: { padding: "8px 14px", background: "#fff", color: "#0f172a", border: "1.5px solid #e2e8f0", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", display: "inline-flex", alignItems: "center" },
  btnLogout: { padding: "8px 14px", background: "#fff", color: "#ef4444", border: "1.5px solid #fecaca", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" },
  formCard: { margin: "20px 24px", background: "#ffffff", borderRadius: 16, border: "1px solid #e2e8f0", boxShadow: "0 4px 20px rgba(0,0,0,0.06)", overflow: "hidden" },
  formHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 24px", borderBottom: "1px solid #f1f5f9", background: "#f8fafc" },
  closeBtn: { background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "#64748b", padding: "4px 8px" },
  formGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: "16px 20px", padding: "20px 24px 24px" },
  formField: { display: "flex", flexDirection: "column" },
  fLabel: { fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 5 },
  fInput: { padding: "9px 12px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 13, background: "#f8fafc", outline: "none", color: "#0f172a", width: "100%", boxSizing: "border-box" },
  tableWrap: { overflowX: "auto", borderRadius: 12, border: "1px solid #e2e8f0", background: "#fff", boxShadow: "0 2px 12px rgba(0,0,0,0.04)" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: { padding: "12px 14px", textAlign: "left", background: "#f8fafc", color: "#475569", fontWeight: 700, fontSize: 12, whiteSpace: "nowrap", borderBottom: "1px solid #e2e8f0", position: "sticky", top: 0 },
  thSticky: { padding: "12px 14px", textAlign: "left", background: "#f8fafc", color: "#475569", fontWeight: 700, fontSize: 12, whiteSpace: "nowrap", borderBottom: "1px solid #e2e8f0", position: "sticky", top: 0, right: 0, zIndex: 3, boxShadow: "-2px 0 6px rgba(0,0,0,0.06)" },
  tr: { borderBottom: "1px solid #f1f5f9" },
  td: { padding: "11px 14px", color: "#334155", verticalAlign: "middle", fontSize: 13 },
  tdSticky: { padding: "11px 14px", color: "#334155", verticalAlign: "middle", fontSize: 13, position: "sticky", right: 0, background: "#ffffff", zIndex: 1, boxShadow: "-2px 0 6px rgba(0,0,0,0.06)" },
  inlineSelect: { padding: "7px 10px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 13, background: "#f8fafc", outline: "none", color: "#0f172a" },
};
