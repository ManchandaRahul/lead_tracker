import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { signOut } from "firebase/auth";
import { auth, db } from "../firebase/config";
import AppPageHeader from "../components/AppPageHeader";
import { Page } from "../navigation";

type DealActivity = {
  id: string;
  transactionId?: string;
  leadId?: string;
  accountName?: string;
  activityName?: string;
  handledBy?: string;
  isDeal?: boolean;
  dealName?: string;
  dealValue?: string;
  dealCurrency?: string;
  probability?: string;
  dueDate?: string;
  dealItems?: Array<{ itemName?: string; description?: string; cost?: string; price?: string }>;
  createdAt?: string;
  updatedAt?: string;
};

const DEAL_STAGE_ORDER = [
  { id: "10", label: "Qualified" },
  { id: "20", label: "Meeting arranged" },
  { id: "40", label: "Needs defined" },
  { id: "60", label: "Proposal sent" },
  { id: "80", label: "Negotiation" },
  { id: "100", label: "Won" },
];

const DEAL_STAGE_COLORS: Record<string, { accent: string; soft: string }> = {
  "10": { accent: "#e11d48", soft: "#fff1f2" },
  "20": { accent: "#f97316", soft: "#fff7ed" },
  "40": { accent: "#f59e0b", soft: "#fffbeb" },
  "60": { accent: "#2563eb", soft: "#eff6ff" },
  "80": { accent: "#7c3aed", soft: "#f5f3ff" },
  "100": { accent: "#16a34a", soft: "#f0fdf4" },
};

function getDealStage(deal: DealActivity) {
  return deal.probability && DEAL_STAGE_COLORS[deal.probability] ? deal.probability : "10";
}

function formatAmount(value?: string, currency?: string) {
  const numeric = Number(value || 0);
  return `${currency || "INR"} ${numeric.toLocaleString("en-IN")}`;
}

function formatWeightedAmount(value?: string, probability?: string, currency?: string) {
  const weighted = Number(value || 0) * (Number(probability || 0) / 100);
  return `${currency || "INR"} ${weighted.toLocaleString("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

export default function Deals({ onNavigate }: { onNavigate: (p: Page, leadId?: string) => void }) {
  const rawUser = localStorage.getItem("leadUser");
  const user = rawUser ? JSON.parse(rawUser) : null;
  const isAdmin = user?.role === "admin";
  const logout = () => {
    signOut(auth);
    localStorage.removeItem("leadUser");
    window.location.reload();
  };

  const [deals, setDeals] = useState<DealActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [ownerFilter, setOwnerFilter] = useState("All team members");
  const [search, setSearch] = useState("");

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, "transactions"), (snap) => {
      const nextDeals = snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as DealActivity))
        .filter((deal) => deal.isDeal);
      setDeals(nextDeals);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const teamMembers = useMemo(() => {
    return Array.from(new Set(deals.map((deal) => deal.handledBy).filter(Boolean))) as string[];
  }, [deals]);

  const filteredDeals = useMemo(() => {
    return deals.filter((deal) => {
      if (ownerFilter !== "All team members" && deal.handledBy !== ownerFilter) return false;
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        deal.accountName?.toLowerCase().includes(q) ||
        deal.dealName?.toLowerCase().includes(q) ||
        deal.activityName?.toLowerCase().includes(q) ||
        deal.transactionId?.toLowerCase().includes(q)
      );
    });
  }, [deals, ownerFilter, search]);

  const groupedDeals = useMemo(() => {
    return DEAL_STAGE_ORDER.map((stage) => {
      const items = filteredDeals.filter((deal) => getDealStage(deal) === stage.id);
      const total = items.reduce((sum, deal) => sum + Number(deal.dealValue || 0), 0);
      return { ...stage, items, total };
    });
  }, [filteredDeals]);

  const totalWeighted = filteredDeals.reduce(
    (sum, deal) => sum + Number(deal.dealValue || 0) * (Number(deal.probability || 0) / 100),
    0
  );

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Sans', sans-serif", background: "#f8fafc" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>Deals</div>
          <div style={{ fontSize: 15, color: "#64748b" }}>Loading deals...</div>
        </div>
      </div>
    );
  }

  return (
    <div style={S.page}>
      <AppPageHeader
        current="deals"
        onNavigate={onNavigate}
        isAdmin={isAdmin}
        onLogout={logout}
        bottomContent={
          <div style={S.headerRight}>
            <button onClick={() => onNavigate("transactions")} style={S.btnPrimary}>Add Deal</button>
          </div>
        }
      />

      <div style={S.toolbar}>
        <div style={S.toolbarTitle}>Sales</div>
        <div style={S.toolbarControls}>
          <select value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)} style={S.select}>
            <option>All team members</option>
            {teamMembers.map((member) => <option key={member}>{member}</option>)}
          </select>
          <input
            placeholder="Search deals..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={S.searchInput}
          />
          <div style={S.weightedCard}>
            <span style={{ fontSize: 11, color: "#64748b", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>Weighted Pipeline</span>
            <strong style={{ fontSize: 18, color: "#0f172a" }}>INR {totalWeighted.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</strong>
          </div>
        </div>
      </div>

      <div style={S.board}>
        {groupedDeals.map((stage) => {
          const colors = DEAL_STAGE_COLORS[stage.id];
          return (
            <div key={stage.id} style={S.column}>
              <div style={{ ...S.columnHeader, background: colors.soft, borderColor: colors.accent }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: "#0f172a" }}>{stage.label}</div>
                  <div style={{ fontSize: 12, color: "#64748b" }}>
                    {stage.id}% | INR {stage.total.toLocaleString("en-IN")} ({stage.items.length})
                  </div>
                </div>
              </div>

              <div style={S.columnBody}>
                {stage.items.length === 0 ? (
                  <div style={S.emptyState}>No deals in this stage yet.</div>
                ) : (
                  stage.items.map((deal) => (
                    <div key={deal.id} style={S.dealCard}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                        <div>
                          <div style={{ fontSize: 16, fontWeight: 800, color: "#0f172a" }}>
                            {deal.dealName || deal.activityName || "Untitled deal"}
                          </div>
                          <div style={{ fontSize: 13, color: "#475569", marginTop: 2 }}>
                            {deal.accountName || "No account name"}
                          </div>
                        </div>
                        <span style={{ ...S.stagePill, background: colors.soft, color: colors.accent }}>
                          {stage.id}%
                        </span>
                      </div>

                      <div style={{ display: "grid", gap: 8, marginTop: 14 }}>
                        <div style={S.metaRow}>
                          <span style={S.metaLabel}>Amount</span>
                          <strong>{formatAmount(deal.dealValue, deal.dealCurrency)}</strong>
                        </div>
                        <div style={S.metaRow}>
                          <span style={S.metaLabel}>Weighted</span>
                          <strong>{formatWeightedAmount(deal.dealValue, deal.probability, deal.dealCurrency)}</strong>
                        </div>
                        <div style={S.metaRow}>
                          <span style={S.metaLabel}>Close Date</span>
                          <span>{deal.dueDate || "-"}</span>
                        </div>
                        <div style={S.metaRow}>
                          <span style={S.metaLabel}>Owner</span>
                          <span>{deal.handledBy || "-"}</span>
                        </div>
                        <div style={S.metaRow}>
                          <span style={S.metaLabel}>Items</span>
                          <span>{deal.dealItems?.length || 0}</span>
                        </div>
                      </div>

                      <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                        <span style={{ fontSize: 12, color: "#94a3b8" }}>{deal.transactionId || deal.id}</span>
                        <button type="button" onClick={() => onNavigate("activityDetail", deal.transactionId || deal.id)} style={S.openBtn}>
                          Open Activity
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
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
  navTabs: { display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap", width: "100%", order: 3 },
  navTab: { padding: "6px 14px", background: "transparent", color: "#64748b", border: "1.5px solid #e2e8f0", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" },
  navTabActive: { background: "#0f172a", color: "#fff", border: "1.5px solid #0f172a" },
  headerRight: { display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10, flexWrap: "wrap" as "wrap", flex: "1 1 280px" },
  btnPrimary: { padding: "10px 18px", background: "#f59e0b", color: "#fff", border: "none", borderRadius: 9999, fontSize: 13, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", boxShadow: "0 12px 24px rgba(245,158,11,0.22)" },
  btnLogout: { padding: "10px 14px", background: "#fff", color: "#ef4444", border: "1px solid #fecaca", borderRadius: 12, fontSize: 13, fontWeight: 700, cursor: "pointer" },
  toolbar: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 18, padding: "22px 24px 14px", flexWrap: "wrap" as "wrap" },
  toolbarTitle: { fontSize: 22, fontWeight: 800, color: "#0f172a" },
  toolbarControls: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" as "wrap" },
  select: { padding: "10px 14px", borderRadius: 12, border: "1px solid #d7dee8", fontSize: 14, background: "#fff", outline: "none", cursor: "pointer", minWidth: 200, boxShadow: "0 1px 2px rgba(15,23,42,0.04)" },
  searchInput: { padding: "10px 14px", borderRadius: 12, border: "1px solid #d7dee8", fontSize: 14, background: "#fff", outline: "none", width: 220, boxShadow: "0 1px 2px rgba(15,23,42,0.04)" },
  weightedCard: { display: "flex", flexDirection: "column", gap: 4, padding: "10px 14px", background: "#fff", border: "1.5px solid #d7dee8", borderRadius: 10, minWidth: 190 },
  board: {
    display: "grid",
    gridTemplateColumns: "repeat(6, minmax(0, 1fr))",
    gap: 12,
    padding: "0 24px 32px",
  },
  column: { display: "flex", flexDirection: "column", gap: 10, minHeight: 320, minWidth: 0 },
  columnHeader: { border: "1.5px solid", borderRadius: 16, padding: "12px 14px" },
  columnBody: { display: "grid", gap: 12, alignContent: "start" },
  emptyState: { padding: "20px 14px", borderRadius: 16, border: "1.5px dashed #cbd5e1", background: "#fff", color: "#94a3b8", fontSize: 12, textAlign: "center" as "center" },
  dealCard: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 16, padding: "14px", boxShadow: "0 4px 16px rgba(15,23,42,0.05)", minWidth: 0 },
  stagePill: { padding: "5px 10px", borderRadius: 9999, fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" as "nowrap" },
  metaRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: 12, color: "#334155" },
  metaLabel: { color: "#64748b", fontWeight: 600 },
  openBtn: { padding: "7px 12px", borderRadius: 9999, border: "1px solid #cbd5e1", background: "#fff", color: "#2563eb", fontSize: 12, fontWeight: 700, cursor: "pointer" },
};
