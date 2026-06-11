import { useEffect, useRef, useState } from "react";
import { Page } from "../navigation";

type MenuKey = "reporting" | null;

const TAB_HELP: Partial<Record<Page, string>> = {
  leads: "View and manage all client leads.\nTrack lead details and current status.",
  transactions: "Open activities for follow-ups and actions.\nManage notes, calls, meetings, and deals.",
  deals: "Review the deal pipeline and reporting.\nTrack stage-wise progress, wins, and losses.",
  activity: "Review the admin audit history.\nSee what changed, who changed it, and when.",
};

function NavHelpButton({
  helpText,
  children,
}: {
  helpText?: string;
  children: React.ReactNode;
}) {
  const [showHelp, setShowHelp] = useState(false);

  return (
    <div
      style={S.helpWrap}
      onMouseEnter={() => setShowHelp(!!helpText)}
      onMouseLeave={() => setShowHelp(false)}
    >
      {children}
      {showHelp && helpText && <div style={S.helpBubble}>{helpText}</div>}
    </div>
  );
}

export default function AppHeaderNav({
  current,
  onNavigate,
  isAdmin,
}: {
  current: Page;
  onNavigate: (p: Page, leadId?: string) => void;
  isAdmin: boolean;
}) {
  const [openMenu, setOpenMenu] = useState<MenuKey>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpenMenu(null);
      }
    };

    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  const toggleMenu = (menu: Exclude<MenuKey, null>) => {
    setOpenMenu((prev) => (prev === menu ? null : menu));
  };

  const navigateTo = (page: Page) => {
    setOpenMenu(null);
    onNavigate(page);
  };

  const actActive = current === "transactions";
  const reportingActive = current === "deals";

  return (
    <div style={S.navTabs} ref={menuRef}>
      <NavHelpButton helpText={TAB_HELP.leads}>
        <button
          type="button"
          onClick={() => navigateTo("leads")}
          style={{ ...S.navTab, ...(current === "leads" ? S.navTabActive : {}) }}
        >
          Leads
        </button>
      </NavHelpButton>

      <NavHelpButton helpText={TAB_HELP.transactions}>
        <button
          type="button"
          onClick={() => navigateTo("transactions")}
          style={{ ...S.navTab, ...(actActive ? S.navTabActive : {}) }}
        >
          Act
        </button>
      </NavHelpButton>

      <NavHelpButton helpText={TAB_HELP.deals}>
        <div style={S.menuWrap}>
          <button
            type="button"
            onClick={() => toggleMenu("reporting")}
            style={{ ...S.navTab, ...(reportingActive ? S.navTabActive : {}) }}
          >
            Reporting
            <span style={S.caret}>▼</span>
          </button>
          {openMenu === "reporting" && (
            <div style={S.menu}>
              <button
                type="button"
                onClick={() => navigateTo("deals")}
                style={{ ...S.menuItem, ...(current === "deals" ? S.menuItemActive : {}) }}
              >
                Deals
              </button>
            </div>
          )}
        </div>
      </NavHelpButton>

      {isAdmin && (
        <>
          <NavHelpButton helpText={TAB_HELP.activity}>
            <button
              type="button"
              onClick={() => navigateTo("activity")}
              style={{ ...S.navTab, ...(current === "activity" ? S.navTabActive : {}) }}
            >
              Activity Log
            </button>
          </NavHelpButton>
          <button
            type="button"
            onClick={() => navigateTo("users")}
            style={{ ...S.navTab, ...(current === "users" ? S.navTabActive : {}) }}
          >
            Users
          </button>
        </>
      )}
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  navTabs: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
    width: "100%",
    order: 3,
    position: "relative",
    paddingTop: 6,
  },
  navTab: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "9px 16px",
    borderRadius: 12,
    border: "1px solid #e2e8f0",
    background: "#ffffff",
    color: "#334155",
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
    whiteSpace: "nowrap",
    boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
  },
  navTabActive: {
    background: "#eff6ff",
    border: "1px solid #93c5fd",
    color: "#2563eb",
    boxShadow: "0 6px 16px rgba(37,99,235,0.08)",
  },
  menuWrap: {
    position: "relative",
  },
  helpWrap: {
    position: "relative",
    display: "inline-flex",
  },
  helpBubble: {
    position: "absolute",
    top: "calc(100% + 8px)",
    left: "50%",
    transform: "translateX(-50%)",
    minWidth: 220,
    maxWidth: 260,
    padding: "10px 12px",
    borderRadius: 12,
    background: "#0f172a",
    color: "#ffffff",
    fontSize: 12,
    lineHeight: 1.45,
    whiteSpace: "pre-line",
    textAlign: "left",
    boxShadow: "0 14px 30px rgba(15,23,42,0.24)",
    zIndex: 80,
    pointerEvents: "none",
  },
  menu: {
    position: "absolute",
    top: "calc(100% + 8px)",
    left: 0,
    minWidth: 190,
    display: "grid",
    gap: 6,
    padding: 10,
    background: "#ffffff",
    border: "1px solid #dbe4f0",
    borderRadius: 16,
    boxShadow: "0 20px 44px rgba(15,23,42,0.14)",
    zIndex: 50,
  },
  menuItem: {
    padding: "10px 12px",
    borderRadius: 10,
    border: "none",
    background: "transparent",
    color: "#334155",
    fontSize: 13,
    fontWeight: 600,
    textAlign: "left",
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  menuItemActive: {
    background: "#eff6ff",
    color: "#2563eb",
  },
  caret: {
    fontSize: 10,
    lineHeight: 1,
    color: "inherit",
  },
};
