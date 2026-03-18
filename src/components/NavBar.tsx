type Page = "leads" | "transactions" | "activity";

interface NavBarProps {
  current: Page;
  onNavigate: (page: Page) => void;
  isAdmin: boolean;
  username: string;
  onLogout: () => void;
}

export default function NavBar({ current, onNavigate, isAdmin, username, onLogout }: NavBarProps) {
  return (
    <div style={S.nav}>
      <div style={S.left}>
        <img src="/k1.svg" alt="Logo" style={{ height: 32 }} onError={(e) => (e.currentTarget.style.display = "none")} />
        <span style={S.brand}>Lead Tracker</span>
        {isAdmin && <span style={S.adminBadge}>Admin</span>}
      </div>

      <div style={S.tabs}>
        {(["leads", "transactions"] as Page[]).map((page) => (
          <button
            key={page}
            onClick={() => onNavigate(page)}
            style={{ ...S.tab, ...(current === page ? S.tabActive : {}) }}
          >
            {page === "leads" ? "Leads" : "Transactions"}
          </button>
        ))}
        {isAdmin && (
          <button
            onClick={() => onNavigate("activity")}
            style={{ ...S.tab, ...(current === "activity" ? S.tabActive : {}) }}
          >
            Activity Log
          </button>
        )}
      </div>

      <div style={S.right}>
        <span style={S.user}>👤 {username}</span>
        <button onClick={onLogout} style={S.logoutBtn}>Logout</button>
      </div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  nav: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0 24px",
    background: "#0f172a",
    color: "#fff",
    height: 56,
    position: "sticky",
    top: 0,
    zIndex: 200,
    gap: 16,
    flexWrap: "wrap",
  },
  left:  { display: "flex", alignItems: "center", gap: 10 },
  brand: { fontSize: 16, fontWeight: 700, color: "#fff", letterSpacing: "-0.3px" },
  adminBadge: { fontSize: 10, fontWeight: 700, padding: "2px 7px", background: "#38bdf8", color: "#0f172a", borderRadius: 4 },
  tabs:  { display: "flex", alignItems: "center", gap: 4 },
  tab: {
    padding: "6px 16px",
    background: "transparent",
    color: "#94a3b8",
    border: "none",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    transition: "all 0.15s",
  },
  tabActive: { background: "#1e293b", color: "#fff" },
  right: { display: "flex", alignItems: "center", gap: 10 },
  user:  { fontSize: 13, color: "#94a3b8" },
  logoutBtn: { padding: "6px 14px", background: "transparent", color: "#f87171", border: "1px solid #7f1d1d", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" },
};