import { useEffect, useState } from "react";
import { db } from "../firebase/config";
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc } from "firebase/firestore";
import { logActivity } from "../firebase/activityLog";
import { signOut } from "firebase/auth";
import { auth } from "../firebase/config";
import * as XLSX from "xlsx";
import DeleteModal from "../components/DeleteModal";

type Page = "leads" | "transactions" | "activity";

const STAGES = ["Initial Call", "Kickoff", "In Progress", "On Hold", "Review", "Completed"];

const STAGE_COLORS: Record<string, { bg: string; color: string }> = {
  "Initial Call": { bg: "#f0fdf4", color: "#15803d" },
  "Kickoff":     { bg: "#dbeafe", color: "#1d4ed8" },
  "In Progress": { bg: "#fef9c3", color: "#b45309" },
  "On Hold":     { bg: "#f3f4f6", color: "#374151" },
  "Review":      { bg: "#ede9fe", color: "#7c3aed" },
  "Completed":   { bg: "#dcfce7", color: "#16a34a" },
};

const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED", "SGD"];

const EMPTY_ACTIVITY = {
  transactionId: "",   // kept internally for Firebase linking
  leadId: "",
  accountName: "",
  activityName: "",
  activityDate: "",
  stage: "Kickoff",
  handledBy: "",
  notes: "",
  // ── Deal fields (only used when isDeal = true) ──
  isDeal: false,
  dealValue: "",
  dealCurrency: "INR",
  dueDate: "",
  probability: "",
};

type Activity = typeof EMPTY_ACTIVITY & { id: string; createdAt?: string };
type Lead = { id: string; leadId: string; accountName: string };

function generateActivityId() {
  const d = new Date();
  return `ACT_${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"00")}${String(d.getDate()).padStart(2,"00")}_${Math.floor(Math.random()*9000+1000)}`;
}

export default function Transactions({ onNavigate, filterLeadId }: { onNavigate: (p: Page, leadId?: string) => void; filterLeadId?: string | null }) {
  const user    = JSON.parse(localStorage.getItem("leadUser")!);
  const isAdmin = user.role === "admin";
  const logout  = () => { signOut(auth); localStorage.removeItem("leadUser"); window.location.reload(); };

  const [activities, setActivities] = useState<Activity[]>([]);
  const [leads, setLeads]           = useState<Lead[]>([]);
  const [loading, setLoading]       = useState(true);
  const [showForm, setShowForm]     = useState(false);
  const [formData, setFormData]     = useState({ ...EMPTY_ACTIVITY });
  const [editingId, setEditingId]   = useState<string | null>(null);
  const [search, setSearch]         = useState(filterLeadId || "");
  const [stageFilter, setStageFilter] = useState("All");
  const [deleteModal, setDeleteModal] = useState<{ activity: Activity } | null>(null);
  const [showColModal, setShowColModal] = useState(false);
  const [visibleCols, setVisibleCols] = useState<Record<string, boolean>>({
    "Account Name": true,
    "Activity Name": true,
    "Date": true,
    "Stage": true,
    "Handled By": true,
    "Notes": true,
  });

  useEffect(() => {
    const u1 = onSnapshot(collection(db, "transactions"), (snap) => {
      setActivities(snap.docs.map(d => ({ id: d.id, ...d.data() } as Activity)));
      setLoading(false);
    });
    const u2 = onSnapshot(collection(db, "leads"), (snap) => {
      setLeads(snap.docs.map(d => ({ id: d.id, ...d.data() } as Lead)));
    });
    return () => { u1(); u2(); };
  }, []);

  const handleLeadSelect = (leadId: string) => {
    const lead = leads.find(l => l.leadId === leadId);
    setFormData(f => ({ ...f, leadId, accountName: lead?.accountName || "" }));
  };

  const filtered = activities
    .filter(a => {
      if (stageFilter !== "All" && a.stage !== stageFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return a.activityName?.toLowerCase().includes(q) ||
          a.accountName?.toLowerCase().includes(q) ||
          a.leadId?.toLowerCase().includes(q) ||
          a.handledBy?.toLowerCase().includes(q);
      }
      return true;
    })
    .sort((a, b) => new Date(b.createdAt||0).getTime() - new Date(a.createdAt||0).getTime());

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      ...formData,
      transactionId: formData.transactionId || generateActivityId(),
      activityDate: formData.activityDate || new Date().toISOString().slice(0, 10),
      updatedAt: new Date().toISOString(),
    };
    if (editingId) {
      await updateDoc(doc(db, "transactions", editingId), payload);
      await logActivity(payload.transactionId, payload.accountName, "transactions", {
        actionType: "TXN_EDITED",
        description: `Activity "${payload.activityName}" for "${payload.accountName}" was edited`,
        actionBy: user.username, timestamp: new Date().toISOString(),
      });
    } else {
      await addDoc(collection(db, "transactions"), { ...payload, createdAt: new Date().toISOString() });
      await logActivity(payload.transactionId, payload.accountName, "transactions", {
        actionType: "TXN_ADDED",
        description: `New activity "${payload.activityName}" added for "${payload.accountName}"`,
        actionBy: user.username, timestamp: new Date().toISOString(),
      });
    }
    resetForm();
  };

  const resetForm = () => { setFormData({ ...EMPTY_ACTIVITY }); setEditingId(null); setShowForm(false); };

  const startEdit = (a: Activity) => {
    setFormData({ ...a }); setEditingId(a.id); setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const deleteActivity = (a: Activity) => setDeleteModal({ activity: a });

  const confirmDelete = async (reason: string) => {
    if (!deleteModal) return;
    const { activity } = deleteModal;
    await logActivity(activity.transactionId, activity.accountName, "transactions", {
      actionType: "TXN_DELETED",
      description: `Activity "${activity.activityName}" for "${activity.accountName}" was deleted. Reason: ${reason}`,
      actionBy: user.username, timestamp: new Date().toISOString(),
    });
    await deleteDoc(doc(db, "transactions", activity.id));
    setDeleteModal(null);
  };

  const downloadExcel = () => {
    const allCols: Record<string, (a: Activity) => any> = {
      "Account Name":  (a) => a.accountName,
      "Activity Name": (a) => a.activityName,
      "Date":          (a) => a.activityDate,
      "Stage":         (a) => a.stage,
      "Handled By":    (a) => a.handledBy,
      "Notes":         (a) => a.notes,
    };
    const visibleKeys = Object.keys(allCols).filter(k => visibleCols[k]);
    const rows = filtered.map((a) =>
      Object.fromEntries(visibleKeys.map(k => [k, allCols[k](a)]))
    );
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Activities");
    XLSX.writeFile(wb, `Activities_${new Date().toISOString().slice(0,10)}.xlsx`);
  };

  const stats = STAGES.map(s => ({
    stage: s,
    count: activities.filter(a => a.stage === s).length,
  }));

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Sans', sans-serif", background: "#f8fafc" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>🔥</div>
          <div style={{ fontSize: 15, color: "#64748b" }}>Loading activities…</div>
        </div>
      </div>
    );
  }

  return (
    <div style={S.page}>
      {/* ── Header ── */}
      <div style={S.header}>
        <div style={S.headerLeft}>
          <img src="/k1.svg" alt="Karuyaki Logo" style={{ height: 36 }} />
          <h1 style={S.headerTitle}>Lead Tracker</h1>
        </div>
        <div style={S.navTabs}>
          <button onClick={() => onNavigate("leads")} style={S.navTab}>Leads</button>
          <button onClick={() => onNavigate("transactions")} style={{ ...S.navTab, ...S.navTabActive }}>Activities</button>
          {isAdmin && <button onClick={() => onNavigate("activity")} style={S.navTab}>Activity Log</button>}
        </div>
        <div style={S.headerRight}>
          <input
            placeholder="Search activities…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={S.searchInput}
          />
          <select value={stageFilter} onChange={e => setStageFilter(e.target.value)} style={S.select}>
            <option value="All">All Stages</option>
            {STAGES.map(s => <option key={s}>{s}</option>)}
          </select>
          <button onClick={downloadExcel} style={S.btnDark}>Export Excel</button>
          {/* ── Column selector ── */}
          <button onClick={() => setShowColModal(true)} style={S.btnOutline}>Columns</button>
          <button onClick={() => { setShowForm(true); setEditingId(null); setFormData({...EMPTY_ACTIVITY}); }} style={S.btnPrimary}>
            + Add Activity
          </button>
        </div>
        <button onClick={logout} style={S.btnLogout}>Logout</button>
      </div>

      {/* ── Active lead filter banner ── */}
      {filterLeadId && (
        <div style={{ padding: "8px 24px", background: "#eff6ff", borderBottom: "1px solid #bfdbfe", fontSize: 13, color: "#1d4ed8", display: "flex", alignItems: "center", gap: 10 }}>
          Showing activities for lead: <b>{filterLeadId}</b>
          <button onClick={() => setSearch("")} style={{ marginLeft: 8, background: "none", border: "none", cursor: "pointer", color: "#dc2626", fontWeight: 700, fontSize: 13 }}>
            ✕ Show all
          </button>
        </div>
      )}

      {/* ── Stats bar ── */}
      <div style={S.statsBar}>
        <div style={S.statTotal}>
          <span style={S.statNum}>{activities.length}</span>
          <span style={S.statLabel}>Total Activities</span>
        </div>
        {stats.map(({ stage, count }) => (
          <div key={stage} onClick={() => setStageFilter(stageFilter === stage ? "All" : stage)}
            style={{ ...S.statChip, background: STAGE_COLORS[stage]?.bg, color: STAGE_COLORS[stage]?.color, outline: stageFilter === stage ? "2px solid currentColor" : "none", cursor: "pointer" }}>
            <span style={{ fontWeight: 700, fontSize: 16 }}>{count}</span>
            <span style={{ fontSize: 11, marginTop: 2 }}>{stage}</span>
          </div>
        ))}
      </div>

      {/* ── Add/Edit Form ── */}
      {showForm && (
        <div style={S.formCard}>
          <div style={S.formHeader}>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>{editingId ? "Edit Activity" : "Add New Activity"}</h2>
            <button onClick={resetForm} style={S.closeBtn}>✕</button>
          </div>
          <form onSubmit={handleSubmit}>
            <div style={S.formGrid}>
              {/* Lead selector */}
              <div style={S.formField}>
                <label style={S.fLabel}>Link to Lead *</label>
                <select style={S.fInput} value={formData.leadId} required
                  onChange={e => handleLeadSelect(e.target.value)}>
                  <option value="">Select a Lead</option>
                  {leads.map(l => <option key={l.leadId} value={l.leadId}>{l.leadId} — {l.accountName}</option>)}
                </select>
              </div>
              {/* Account Name - read only */}
              <div style={S.formField}>
                <label style={S.fLabel}>Account Name</label>
                <input style={{ ...S.fInput, background: "#f1f5f9" }} value={formData.accountName} readOnly />
              </div>
              {/* Activity Name */}
              <div style={S.formField}>
                <label style={S.fLabel}>Activity Name *</label>
                <input style={S.fInput} required placeholder="e.g. Discovery Call, Proposal Sent…"
                  value={formData.activityName}
                  onChange={e => setFormData({ ...formData, activityName: e.target.value })} />
              </div>
              {/* Date */}
              <div style={S.formField}>
                <label style={S.fLabel}>Date</label>
                <input type="date" style={S.fInput}
                  value={formData.activityDate || new Date().toISOString().slice(0, 10)}
                  onChange={e => setFormData({ ...formData, activityDate: e.target.value })} />
              </div>
              {/* Stage */}
              <div style={S.formField}>
                <label style={S.fLabel}>Stage</label>
                <select style={S.fInput} value={formData.stage}
                  onChange={e => setFormData({ ...formData, stage: e.target.value })}>
                  {STAGES.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
              {/* Handled By */}
              <div style={S.formField}>
                <label style={S.fLabel}>Handled By</label>
                <input style={S.fInput} value={formData.handledBy}
                  onChange={e => setFormData({ ...formData, handledBy: e.target.value })} />
              </div>
            </div>
            {/* Notes */}
            <div style={{ padding: "0 24px 20px" }}>
              <label style={S.fLabel}>Notes</label>
              <textarea rows={3} style={{ ...S.fInput, resize: "vertical" }} value={formData.notes}
                onChange={e => setFormData({ ...formData, notes: e.target.value })} />
            </div>

            {/* ── Deal Toggle ── */}
            <div style={{ padding: "0 24px 16px" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", userSelect: "none" }}>
                <div
                  onClick={() => setFormData({ ...formData, isDeal: !(formData as any).isDeal })}
                  style={{
                    width: 40, height: 22, borderRadius: 11, cursor: "pointer", transition: "background 0.2s",
                    background: (formData as any).isDeal ? "#0f172a" : "#e2e8f0",
                    position: "relative", flexShrink: 0,
                  }}
                >
                  <div style={{
                    position: "absolute", top: 3, left: (formData as any).isDeal ? 21 : 3,
                    width: 16, height: 16, borderRadius: "50%", background: "#fff",
                    transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                  }} />
                </div>
                <span style={{ fontSize: 13, fontWeight: 600, color: "#334155" }}>
                  This activity is a Deal
                </span>
                {(formData as any).isDeal && (
                  <span style={{ fontSize: 11, background: "#ede9fe", color: "#7c3aed", padding: "2px 8px", borderRadius: 20, fontWeight: 600 }}>
                    Deal Mode ON
                  </span>
                )}
              </label>
            </div>

            {/* ── Deal Fields (visible only when isDeal = true) ── */}
            {(formData as any).isDeal && (
              <div style={{ margin: "0 24px 20px", padding: "16px 20px", background: "#f8faff", borderRadius: 10, border: "1.5px solid #e0e7ff" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#7c3aed", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 14 }}>
                  Deal Details
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "16px 20px" }}>
                  {/* Deal Value + Currency */}
                  <div style={S.formField}>
                    <label style={S.fLabel}>Deal Value</label>
                    <div style={{ display: "flex", gap: 6 }}>
                      <select
                        style={{ ...S.fInput, width: 80, flexShrink: 0 }}
                        value={(formData as any).dealCurrency || "INR"}
                        onChange={e => setFormData({ ...formData, dealCurrency: e.target.value } as any)}
                      >
                        {CURRENCIES.map(c => <option key={c}>{c}</option>)}
                      </select>
                      <input
                        type="number"
                        style={{ ...S.fInput, flex: 1 }}
                        placeholder="0.00"
                        value={(formData as any).dealValue || ""}
                        onChange={e => setFormData({ ...formData, dealValue: e.target.value } as any)}
                      />
                    </div>
                  </div>
                  {/* Due Date */}
                  <div style={S.formField}>
                    <label style={S.fLabel}>Due Date</label>
                    <input
                      type="date"
                      style={S.fInput}
                      value={(formData as any).dueDate || ""}
                      onChange={e => setFormData({ ...formData, dueDate: e.target.value } as any)}
                    />
                  </div>
                  {/* Probability */}
                  <div style={S.formField}>
                    <label style={S.fLabel}>Probability (%)</label>
                    <input
                      type="number"
                      min="0" max="100"
                      style={S.fInput}
                      placeholder="e.g. 75"
                      value={(formData as any).probability || ""}
                      onChange={e => setFormData({ ...formData, probability: e.target.value } as any)}
                    />
                  </div>
                </div>
              </div>
            )}

            <div style={{ padding: "0 24px 24px", display: "flex", gap: 10 }}>
              <button type="submit" style={S.btnPrimary}>{editingId ? "Save Changes" : "Add Activity"}</button>
              <button type="button" onClick={resetForm} style={S.btnOutline}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* ── Table ── */}
      <div style={{ padding: "0 24px 40px" }}>
        <div style={S.tableWrap}>
          <table style={S.table}>
            <thead>
              <tr>
                {(["Account Name", "Activity Name", "Date", "Stage", "Handled By", "Notes"] as string[]).filter(h => visibleCols[h]).concat(["Actions"]).map(h => (
                  <th key={h} style={h === "Actions" ? S.thSticky : S.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={Object.values(visibleCols).filter(Boolean).length + 1} style={{ textAlign: "center", padding: "48px 0", color: "#94a3b8", fontSize: 14 }}>
                  No activities yet. Add one to get started.
                </td></tr>
              )}
              {filtered.map(a => (
                <tr key={a.id} style={S.tr}
                  onMouseEnter={e => (e.currentTarget.style.background = "#f8fafc")}
                  onMouseLeave={e => (e.currentTarget.style.background = "")}>
                  {visibleCols["Account Name"] && <td style={{ ...S.td, fontWeight: 600, minWidth: 140 }}>{a.accountName}</td>}
                  {visibleCols["Activity Name"] && <td style={{ ...S.td, fontWeight: 600, minWidth: 160 }}>{a.activityName}</td>}
                  {visibleCols["Date"] && <td style={{ ...S.td, whiteSpace: "nowrap", color: "#64748b" }}>{a.activityDate || "-"}</td>}
                  {visibleCols["Stage"] && <td style={S.td}>
                    <span style={{ padding: "4px 10px", borderRadius: 20, fontWeight: 600, fontSize: 12, background: STAGE_COLORS[a.stage]?.bg, color: STAGE_COLORS[a.stage]?.color, whiteSpace: "nowrap" }}>
                      {a.stage}
                    </span>
                  </td>}
                  {visibleCols["Handled By"] && <td style={S.td}>{a.handledBy || "-"}</td>}
                  {visibleCols["Notes"] && <td style={{ ...S.td, minWidth: 200, maxWidth: 260, whiteSpace: "pre-wrap", color: "#64748b", fontSize: 12 }}>
                    {a.notes || <span style={{ color: "#cbd5e1", fontStyle: "italic" }}>No notes</span>}
                  </td>}
                  {visibleCols["Deal Value"] && <td style={S.td}>
                    {(a as any).isDeal && (a as any).dealValue
                      ? <span style={{ fontWeight: 600, color: "#7c3aed" }}>{(a as any).dealCurrency || "INR"} {parseFloat((a as any).dealValue).toLocaleString("en-IN")}</span>
                      : <span style={{ color: "#cbd5e1", fontStyle: "italic" }}>-</span>}
                  </td>}
                  {visibleCols["Due Date"] && <td style={{ ...S.td, whiteSpace: "nowrap", color: "#64748b" }}>
                    {(a as any).isDeal && (a as any).dueDate ? (a as any).dueDate : "-"}
                  </td>}
                  {visibleCols["Probability"] && <td style={{ ...S.td, textAlign: "center" }}>
                    {(a as any).isDeal && (a as any).probability
                      ? <span style={{ fontWeight: 600, color: "#0f172a" }}>{(a as any).probability}%</span>
                      : "-"}
                  </td>}
                  <td style={S.tdSticky}>
                    <div style={{ display: "flex", gap: 6, flexDirection: "column" }}>
                      <button onClick={() => startEdit(a)} style={S.editBtn}>Edit</button>
                      <button onClick={() => deleteActivity(a)} style={S.deleteBtn}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 12, fontSize: 12, color: "#94a3b8" }}>
          Showing {filtered.length} of {activities.length} activities · <span style={{ color: "#16a34a" }}>🔥 Firebase connected</span>
        </div>
      </div>

      {/* ── Column Selector Modal ── */}
      {showColModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, backdropFilter: "blur(2px)" }}>
          <div style={{ background: "#fff", borderRadius: 16, padding: "28px 32px", width: "100%", maxWidth: 460, boxShadow: "0 24px 60px rgba(0,0,0,0.2)", fontFamily: "'DM Sans', sans-serif" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#0f172a" }}>Select Columns</h2>
              <button onClick={() => setShowColModal(false)} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "#64748b" }}>✕</button>
            </div>

            {[
              { title: "Activity Info", cols: ["Client Name", "Activity Name", "Date", "Stage", "Handled By", "Notes"] },
              { title: "Deal Info (shown when Deal Mode is ON)", cols: ["Deal Value", "Due Date", "Probability"] },
            ].map(({ title, cols }) => (
              <div key={title} style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 10, paddingBottom: 6, borderBottom: "1px solid #f1f5f9" }}>
                  {title}
                  <button onClick={() => {
                    const allOn = cols.every(c => visibleCols[c]);
                    setVisibleCols(p => ({ ...p, ...Object.fromEntries(cols.map(c => [c, !allOn])) }));
                  }} style={{ marginLeft: 10, fontSize: 11, color: "#2563eb", background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}>
                    {cols.every(c => visibleCols[c]) ? "Hide all" : "Show all"}
                  </button>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 16px" }}>
                  {cols.map(col => (
                    <label key={col} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#334155", cursor: "pointer", padding: "4px 0" }}>
                      <input type="checkbox" checked={visibleCols[col]}
                        onChange={() => setVisibleCols(p => ({ ...p, [col]: !p[col] }))}
                        style={{ cursor: "pointer" }} />
                      {col}
                    </label>
                  ))}
                </div>
              </div>
            ))}

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
              <button onClick={() => setVisibleCols(Object.fromEntries(Object.keys(visibleCols).map(k => [k, true])))}
                style={{ padding: "8px 16px", background: "#f1f5f9", color: "#475569", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                Reset All
              </button>
              <button onClick={() => setShowColModal(false)}
                style={{ padding: "8px 20px", background: "#0f172a", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Modal ── */}
      {deleteModal && (
        <DeleteModal
          title="Delete Activity"
          itemName={`${deleteModal.activity.activityName} — ${deleteModal.activity.accountName}`}
          onConfirm={confirmDelete}
          onCancel={() => setDeleteModal(null)}
        />
      )}
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", background: "#f8fafc", fontFamily: "'DM Sans','Segoe UI',sans-serif", color: "#0f172a" },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 24px", background: "#ffffff", borderBottom: "1px solid #e2e8f0", position: "sticky", top: 0, zIndex: 100, gap: 12, flexWrap: "wrap" as "wrap" },
  headerLeft: { display: "flex", alignItems: "center", gap: 10 },
  headerTitle: { fontSize: 20, fontWeight: 700, margin: 0, letterSpacing: "-0.4px" },
  navTabs: { display: "flex", alignItems: "center", gap: 4 },
  navTab: { padding: "6px 14px", background: "transparent", color: "#64748b", border: "1.5px solid #e2e8f0", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" },
  navTabActive: { background: "#0f172a", color: "#fff", border: "1.5px solid #0f172a" },
  headerRight: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" as "wrap" },
  searchInput: { padding: "8px 12px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 13, background: "#f8fafc", outline: "none", width: 220 },
  select: { padding: "8px 10px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 13, background: "#f8fafc", outline: "none", cursor: "pointer" },
  btnPrimary: { padding: "8px 16px", background: "#0f172a", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" },
  btnDark: { padding: "8px 14px", background: "#1e293b", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" },
  btnOutline: { padding: "8px 14px", background: "#fff", color: "#0f172a", border: "1.5px solid #e2e8f0", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", display: "inline-flex", alignItems: "center" },
  btnLogout: { padding: "8px 14px", background: "#fff", color: "#ef4444", border: "1.5px solid #fecaca", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" },
  statsBar: { display: "flex", gap: 12, padding: "14px 24px", background: "#ffffff", borderBottom: "1px solid #e2e8f0", flexWrap: "wrap", alignItems: "center" },
  statTotal: { display: "flex", flexDirection: "column", alignItems: "center", padding: "8px 20px", background: "#f1f5f9", borderRadius: 10, marginRight: 4 },
  statNum: { fontSize: 22, fontWeight: 800, color: "#0f172a" },
  statLabel: { fontSize: 11, color: "#64748b", marginTop: 2 },
  statChip: { display: "flex", flexDirection: "column", alignItems: "center", padding: "8px 16px", borderRadius: 10, minWidth: 72, transition: "transform 0.1s" },
  formCard: { margin: "20px 24px", background: "#ffffff", borderRadius: 16, border: "1px solid #e2e8f0", boxShadow: "0 4px 20px rgba(0,0,0,0.06)", overflow: "hidden" },
  formHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 24px", borderBottom: "1px solid #f1f5f9", background: "#f8fafc" },
  closeBtn: { background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "#64748b", padding: "4px 8px" },
  formGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: "16px 20px", padding: "20px 24px 8px" },
  formField: { display: "flex", flexDirection: "column" },
  fLabel: { fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 5 },
  fInput: { padding: "9px 12px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 13, background: "#f8fafc", outline: "none", color: "#0f172a", width: "100%", boxSizing: "border-box" },
  tableWrap: { overflowX: "auto", borderRadius: 12, border: "1px solid #e2e8f0", background: "#fff", boxShadow: "0 2px 12px rgba(0,0,0,0.04)" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: { padding: "12px 14px", textAlign: "left", background: "#f8fafc", color: "#475569", fontWeight: 700, fontSize: 12, whiteSpace: "nowrap", borderBottom: "1px solid #e2e8f0", position: "sticky", top: 0 },
  thSticky: { padding: "12px 14px", textAlign: "left", background: "#f8fafc", color: "#475569", fontWeight: 700, fontSize: 12, whiteSpace: "nowrap", borderBottom: "1px solid #e2e8f0", position: "sticky", top: 0, right: 0, zIndex: 3, boxShadow: "-2px 0 6px rgba(0,0,0,0.06)" },
  tdSticky: { padding: "11px 14px", color: "#334155", verticalAlign: "top", fontSize: 13, position: "sticky", right: 0, background: "#ffffff", zIndex: 1, boxShadow: "-2px 0 6px rgba(0,0,0,0.06)" },
  tr: { borderBottom: "1px solid #f1f5f9", transition: "background 0.15s" },
  td: { padding: "11px 14px", color: "#334155", verticalAlign: "top", fontSize: 13 },
  editBtn: { padding: "5px 10px", background: "#eff6ff", color: "#2563eb", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 12 },
  deleteBtn: { padding: "5px 10px", background: "#fef2f2", color: "#dc2626", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 12 },
};