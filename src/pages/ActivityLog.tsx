import { useEffect, useState } from "react";
import { db } from "../firebase/config";
import { collection, onSnapshot } from "firebase/firestore";
import { signOut } from "firebase/auth";
import { auth } from "../firebase/config";
import { ActivityDocument, HistoryEntry } from "../firebase/activityLog";

type Page = "leads" | "transactions" | "activity";
type LogDoc = ActivityDocument & { id: string };

const ACTION_META: Record<string, { label: string; bg: string; color: string }> = {
  LEAD_ADDED:          { label: "Lead Added",      bg: "#dcfce7", color: "#16a34a" },
  LEAD_EDITED:         { label: "Lead Edited",      bg: "#dbeafe", color: "#1d4ed8" },
  LEAD_STATUS_CHANGED: { label: "Status Changed",   bg: "#ede9fe", color: "#7c3aed" },
  LEAD_DELETED:        { label: "Lead Deleted",     bg: "#fee2e2", color: "#dc2626" },
  TXN_ADDED:           { label: "Txn Added",        bg: "#fef9c3", color: "#b45309" },
  TXN_EDITED:          { label: "Txn Edited",       bg: "#dbeafe", color: "#1d4ed8" },
  TXN_DELETED:         { label: "Txn Deleted",      bg: "#fee2e2", color: "#dc2626" },
};

export default function ActivityLog({ onNavigate }: { onNavigate: (p: Page, leadId?: string) => void }) {
  const user   = JSON.parse(localStorage.getItem("leadUser")!);
  const logout = () => { localStorage.removeItem("leadUser"); window.location.reload(); };

  const [logs, setLogs]         = useState<LogDoc[]>([]);
  const [loading, setLoading]   = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // ── Filters ──
  const [moduleFilter, setModuleFilter]   = useState("All");
  const [actionFilter, setActionFilter]   = useState("All");
  const [userFilter, setUserFilter]       = useState("All");
  const [fromDate, setFromDate]           = useState("");
  const [toDate, setToDate]               = useState("");
  const [search, setSearch]               = useState("");

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "activityLog"),
      (snap) => {
        const docs = snap.docs.map(d => ({ id: d.id, ...d.data() } as LogDoc));
        docs.sort((a, b) => new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime());
        setLogs(docs);
        setLoading(false);
      },
      (error) => {
        // Firestore error (e.g. permission denied, missing collection) — stop spinner
        console.error("ActivityLog snapshot error:", error);
        setLoading(false);
      }
    );
    return () => unsub();
  }, []);

  // ── All unique users across all history entries ──
  const allUsers = Array.from(
    new Set(logs.flatMap(l => (l.history || []).map(h => h.actionBy)))
  ).sort();

  // ── Filter logs ──
  const filtered = logs.filter(l => {
    if (moduleFilter !== "All" && l.module !== moduleFilter) return false;
    if (userFilter !== "All" && l.lastActionBy !== userFilter) return false;
    if (actionFilter !== "All") {
      const hasAction = (l.history || []).some(h => h.actionType === actionFilter);
      if (!hasAction) return false;
    }
    if (fromDate && l.lastUpdated < fromDate) return false;
    if (toDate && l.lastUpdated > toDate + "T23:59:59") return false;
    if (search) {
      const q = search.toLowerCase();
      return l.referenceId?.toLowerCase().includes(q) ||
        l.referenceName?.toLowerCase().includes(q);
    }
    return true;
  });

  const toggleExpand = (id: string) =>
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }));

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Sans', sans-serif", background: "#f8fafc" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>📋</div>
          <div style={{ fontSize: 15, color: "#64748b" }}>Loading activity log…</div>
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
          <span style={S.adminBadge}>Admin Only</span>
        </div>
        <div style={S.navTabs}>
          <button onClick={() => onNavigate("leads")} style={S.navTab}>Leads</button>
          <button onClick={() => onNavigate("transactions")} style={S.navTab}>Activities</button>
          <button onClick={() => onNavigate("activity")} style={{ ...S.navTab, ...S.navTabActive }}>Activity Log</button>
        </div>
        <div style={S.headerRight}>
          <input
            placeholder="Search by Lead ID or Name…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={S.searchInput}
          />
          <select value={moduleFilter} onChange={e => setModuleFilter(e.target.value)} style={S.select}>
            <option value="All">All Modules</option>
            <option value="leads">Leads</option>
            <option value="transactions">Transactions</option>
          </select>
          <select value={actionFilter} onChange={e => setActionFilter(e.target.value)} style={S.select}>
            <option value="All">All Actions</option>
            {Object.entries(ACTION_META).map(([key, val]) => (
              <option key={key} value={key}>{val.label}</option>
            ))}
          </select>
        </div>
        <button onClick={logout} style={S.btnLogout}>Logout</button>
      </div>

      {/* ── Secondary filters ── */}
      <div style={S.subHeader}>
        <select value={userFilter} onChange={e => setUserFilter(e.target.value)} style={S.select}>
          <option value="All">All Users</option>
          {allUsers.map(u => <option key={u}>{u}</option>)}
        </select>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <small style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>From</small>
          <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} style={S.select} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <small style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>To</small>
          <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} style={S.select} />
        </div>
        {(moduleFilter !== "All" || actionFilter !== "All" || userFilter !== "All" || fromDate || toDate || search) && (
          <button onClick={() => { setModuleFilter("All"); setActionFilter("All"); setUserFilter("All"); setFromDate(""); setToDate(""); setSearch(""); }}
            style={S.clearBtn}>
            ✕ Clear
          </button>
        )}
        <span style={{ marginLeft: "auto", fontSize: 12, color: "#94a3b8" }}>
          {filtered.length} of {logs.length} records
        </span>
      </div>

      {/* ── Stats bar ── */}
      <div style={S.statsBar}>
        <div style={S.statTotal}>
          <span style={S.statNum}>{logs.length}</span>
          <span style={S.statLabel}>Total Records</span>
        </div>
        <div style={S.statTotal}>
          <span style={{ ...S.statNum, fontSize: 16 }}>{filtered.length}</span>
          <span style={S.statLabel}>Filtered</span>
        </div>
        {Object.entries(ACTION_META).map(([key, val]) => {
          const count = logs.filter(l => (l.history || []).some(h => h.actionType === key)).length;
          if (count === 0) return null;
          return (
            <div key={key}
              onClick={() => setActionFilter(actionFilter === key ? "All" : key)}
              style={{ ...S.statChip, background: val.bg, color: val.color, outline: actionFilter === key ? "2px solid currentColor" : "none", cursor: "pointer" }}>
              <span style={{ fontWeight: 700, fontSize: 16 }}>{count}</span>
              <span style={{ fontSize: 11, marginTop: 2 }}>{val.label}</span>
            </div>
          );
        })}
      </div>

      {/* ── Table ── */}
      <div style={{ padding: "0 24px 40px" }}>
        <div style={S.tableWrap}>
          <table style={S.table}>
            <thead>
              <tr>
                {["", "Reference ID", "Name", "Module", "Events", "Last Action", "Last Updated By", "Last Updated At"].map((h, i) => (
                  <th key={`header-${i}`} style={S.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ textAlign: "center", padding: "48px 0", color: "#94a3b8", fontSize: 14 }}>
                    No activity records found.
                  </td>
                </tr>
              )}
              {filtered.map((log) => {
                const isOpen = expanded[log.id] || false;
                const lastEntry = (log.history || [])[( log.history || []).length - 1];
                const lastMeta = ACTION_META[lastEntry?.actionType];

                return (
                  <>
                    {/* ── Main row ── */}
                    <tr key={log.id} style={{ ...S.tr, background: isOpen ? "#f8fafc" : "" }}
                      onMouseEnter={e => { if (!isOpen) e.currentTarget.style.background = "#f8fafc"; }}
                      onMouseLeave={e => { if (!isOpen) e.currentTarget.style.background = ""; }}>

                      {/* Expand toggle */}
                      <td style={{ ...S.td, width: 40, textAlign: "center" }}>
                        <button onClick={() => toggleExpand(log.id)} style={S.expandBtn}>
                          {isOpen ? "▲" : "▼"}
                        </button>
                      </td>

                      <td style={{ ...S.td, fontWeight: 600, whiteSpace: "nowrap", color: "#0f172a" }}>{log.referenceId}</td>
                      <td style={{ ...S.td, fontWeight: 600, minWidth: 160 }}>{log.referenceName}</td>
                      <td style={S.td}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: log.module === "leads" ? "#2563eb" : "#b45309" }}>
                          {log.module === "leads" ? "Leads" : "Transactions"}
                        </span>
                      </td>
                      <td style={{ ...S.td, textAlign: "center" }}>
                        <span style={{ padding: "3px 10px", borderRadius: 20, background: "#f1f5f9", fontWeight: 700, fontSize: 13, color: "#0f172a" }}>
                          {(log.history || []).length}
                        </span>
                      </td>
                      <td style={S.td}>
                        {lastMeta && (
                          <span style={{ padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600, background: lastMeta.bg, color: lastMeta.color, whiteSpace: "nowrap" }}>
                            {lastMeta.label}
                          </span>
                        )}
                      </td>
                      <td style={{ ...S.td, fontWeight: 600 }}>
                        {log.lastActionBy === "admin"
                          ? <span style={{ color: "#7c3aed" }}>👑 {log.lastActionBy}</span>
                          : <span>👤 {log.lastActionBy}</span>}
                      </td>
                      <td style={{ ...S.td, color: "#64748b", fontSize: 12, whiteSpace: "nowrap" }}>
                        {new Date(log.lastUpdated).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </td>
                    </tr>

                    {/* ── Expanded history timeline ── */}
                    {isOpen && (
                      <tr key={`${log.id}-history`}>
                        <td colSpan={8} style={{ padding: "0 24px 16px 56px", background: "#f8fafc", borderBottom: "2px solid #e2e8f0" }}>
                          <div style={{ paddingTop: 12 }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 12 }}>
                              History — {(log.history || []).length} event{log.history.length !== 1 ? "s" : ""}
                            </div>
                            <div style={{ position: "relative", paddingLeft: 20 }}>
                              {/* vertical line */}
                              <div style={{ position: "absolute", left: 6, top: 0, bottom: 0, width: 2, background: "#e2e8f0", borderRadius: 2 }} />

                              {[...(log.history || [])].reverse().map((h: HistoryEntry, idx: number) => {
                                const meta = ACTION_META[h.actionType];
                                return (
                                  <div key={idx} style={{ position: "relative", marginBottom: 14, paddingLeft: 20 }}>
                                    {/* dot */}
                                    <div style={{ position: "absolute", left: -8, top: 4, width: 10, height: 10, borderRadius: "50%", background: meta?.color || "#94a3b8", border: "2px solid #fff", boxShadow: "0 0 0 2px " + (meta?.color || "#94a3b8") }} />

                                    <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
                                      <span style={{ padding: "2px 8px", borderRadius: 20, fontSize: 11, fontWeight: 700, background: meta?.bg || "#f3f4f6", color: meta?.color || "#374151", whiteSpace: "nowrap" }}>
                                        {meta?.label || h.actionType}
                                      </span>
                                      <span style={{ fontSize: 13, color: "#334155", flex: 1 }}>{h.description}</span>
                                    </div>

                                    {(h.previousValue || h.newValue) && (
                                      <div style={{ marginTop: 4, fontSize: 12, color: "#64748b", display: "flex", gap: 8, alignItems: "center" }}>
                                        {h.previousValue && <span style={{ color: "#dc2626", background: "#fef2f2", padding: "1px 6px", borderRadius: 4 }}>Before: {h.previousValue}</span>}
                                        {h.previousValue && h.newValue && <span>→</span>}
                                        {h.newValue && <span style={{ color: "#16a34a", background: "#f0fdf4", padding: "1px 6px", borderRadius: 4 }}>After: {h.newValue}</span>}
                                      </div>
                                    )}

                                    <div style={{ marginTop: 3, fontSize: 11, color: "#94a3b8" }}>
                                      {h.actionBy === "admin"
                                        ? <span style={{ color: "#7c3aed" }}>👑 {h.actionBy}</span>
                                        : <span>👤 {h.actionBy}</span>}
                                      &nbsp;·&nbsp;
                                      {new Date(h.timestamp).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 12, fontSize: 12, color: "#94a3b8" }}>
          Showing {filtered.length} of {logs.length} records · Admin: <b>{user.username}</b>
          &nbsp;·&nbsp;<span style={{ color: "#16a34a" }}>🔥 Connected to Firebase</span>
        </div>
      </div>
    </div>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
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
  btnLogout: { padding: "8px 14px", background: "#fff", color: "#ef4444", border: "1.5px solid #fecaca", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" },
  searchInput: { padding: "8px 12px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 13, background: "#f8fafc", outline: "none", width: 200 },
  select: { padding: "8px 10px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 13, background: "#f8fafc", outline: "none", cursor: "pointer" },
  clearBtn: { padding: "6px 12px", background: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" },
  subHeader: { display: "flex", alignItems: "center", gap: 8, padding: "10px 24px", background: "#fff", borderBottom: "1px solid #e2e8f0", flexWrap: "wrap" as "wrap" },
  statsBar: { display: "flex", gap: 12, padding: "14px 24px", background: "#ffffff", borderBottom: "1px solid #e2e8f0", flexWrap: "wrap", alignItems: "center" },
  statTotal: { display: "flex", flexDirection: "column", alignItems: "center", padding: "8px 20px", background: "#f1f5f9", borderRadius: 10, marginRight: 4 },
  statNum: { fontSize: 22, fontWeight: 800, color: "#0f172a" },
  statLabel: { fontSize: 11, color: "#64748b", marginTop: 2 },
  statChip: { display: "flex", flexDirection: "column", alignItems: "center", padding: "8px 16px", borderRadius: 10, minWidth: 72, transition: "transform 0.1s" },
  tableWrap: { overflowX: "auto", borderRadius: 12, border: "1px solid #e2e8f0", background: "#fff", boxShadow: "0 2px 12px rgba(0,0,0,0.04)" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: { padding: "12px 14px", textAlign: "left", background: "#f8fafc", color: "#475569", fontWeight: 700, fontSize: 12, whiteSpace: "nowrap", borderBottom: "1px solid #e2e8f0", position: "sticky", top: 0 },
  tr: { borderBottom: "1px solid #f1f5f9", transition: "background 0.15s" },
  td: { padding: "11px 14px", color: "#334155", verticalAlign: "middle", fontSize: 13 },
  expandBtn: { background: "#f1f5f9", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 11, color: "#64748b", padding: "4px 8px", fontWeight: 700 },
};