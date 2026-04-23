import { ReactNode } from "react";
import AppHeaderNav from "./AppHeaderNav";
import { Page } from "../navigation";

export default function AppPageHeader({
  current,
  onNavigate,
  isAdmin,
  onLogout,
  showAdminBadge = false,
  bottomContent,
}: {
  current: Page;
  onNavigate: (p: Page, leadId?: string) => void;
  isAdmin: boolean;
  onLogout: () => void;
  showAdminBadge?: boolean;
  bottomContent?: ReactNode;
}) {
  return (
    <div style={S.header}>
      <div style={S.headerTop}>
        <div style={S.headerBrandGroup}>
          <div style={S.headerLeft}>
            <img src="/k1.svg" alt="Karuyaki Logo" style={{ height: 36 }} />
            <h1 style={S.headerTitle}>Lead Tracker</h1>
            {showAdminBadge && <span style={S.adminBadge}>Admin Only</span>}
          </div>
          <AppHeaderNav current={current} onNavigate={onNavigate} isAdmin={isAdmin} />
        </div>
        <button onClick={onLogout} style={S.btnLogout}>Logout</button>
      </div>
      {bottomContent ? <div style={S.headerBottom}>{bottomContent}</div> : null}
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  header: {
    display: "grid",
    padding: "18px 24px 14px",
    background: "#ffffff",
    borderBottom: "1px solid #e9eef5",
    boxShadow: "0 8px 24px rgba(15,23,42,0.06)",
    position: "sticky",
    top: 0,
    zIndex: 100,
    gap: 14,
  },
  headerTop: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "nowrap",
  },
  headerBottom: {
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 16,
    flexWrap: "wrap",
  },
  headerBrandGroup: {
    display: "flex",
    alignItems: "center",
    gap: 20,
    minWidth: 0,
    flex: 1,
  },
  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: 12,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: 800,
    margin: 0,
    letterSpacing: "-0.5px",
    color: "#0f172a",
  },
  adminBadge: {
    fontSize: 11,
    fontWeight: 600,
    padding: "3px 8px",
    background: "#ede9fe",
    color: "#7c3aed",
    borderRadius: 6,
    border: "1px solid #ddd6fe",
    whiteSpace: "nowrap",
  },
  btnLogout: {
    padding: "10px 14px",
    background: "#fff",
    color: "#ef4444",
    border: "1px solid #fecaca",
    borderRadius: 12,
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
};
