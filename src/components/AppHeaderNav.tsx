import { useEffect, useRef, useState } from "react";
import { Page } from "../navigation";

type MenuKey = "reporting" | null;

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
      <button
        type="button"
        onClick={() => navigateTo("leads")}
        style={{ ...S.navTab, ...(current === "leads" ? S.navTabActive : {}) }}
      >
        Leads
      </button>

      <button
        type="button"
        onClick={() => navigateTo("transactions")}
        style={{ ...S.navTab, ...(actActive ? S.navTabActive : {}) }}
      >
        Act
      </button>

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

      {isAdmin && (
        <>
          <button
            type="button"
            onClick={() => navigateTo("activity")}
            style={{ ...S.navTab, ...(current === "activity" ? S.navTabActive : {}) }}
          >
            Activity Log
          </button>
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
