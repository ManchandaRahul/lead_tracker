import React, { useEffect, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { signOut } from "firebase/auth";
import { auth, db } from "../firebase/config";
import AppPageHeader from "../components/AppPageHeader";
import { Page } from "../navigation";
import { getAllowedLeadIds, getSessionUser, isRestrictedUser } from "../accessControl";
import { formatLocalDateKey, isMissedFollowUp, isTodayFollowUp } from "../utils/followUps";

type TimelineCategory = "note" | "call" | "meeting" | "deal" | "update";

type TimelineEntry = {
  id: string;
  category: TimelineCategory;
  title: string;
  description: string;
  date: string;
  time?: string;
  followUpDate?: string;
  followUpTime?: string;
  createdAt: string;
  createdBy?: string;
  assignedTo?: string;
};

type Lead = {
  id: string;
  leadId: string;
  accountName: string;
  handledBy?: string;
  status?: string;
  followUpDate?: string;
  followUpTime?: string;
  actions?: TimelineEntry[];
};

type Activity = {
  id: string;
  transactionId: string;
  leadId: string;
  accountName: string;
  activityName: string;
  stage: string;
  handledBy?: string;
  followUpDate?: string;
  followUpTime?: string;
  actions?: TimelineEntry[];
};

type FollowUpItem = {
  id: string;
  leadId: string;
  accountName: string;
  title: string;
  source: "Prospect" | "Prospect Action" | "Lead" | "Lead Action";
  statusOrStage: string;
  followUpDate: string;
  followUpTime: string;
  assignedTo: string;
  handledBy: string;
  note: string;
  routePage: Page;
  routeId: string;
};

function normalizeTimelineEntries(entries: any[] = []): TimelineEntry[] {
  return entries.map((entry, index) => {
    const createdAt = entry.createdAt || entry.timestamp || new Date().toISOString();
    return {
      id: entry.id || `${createdAt}_${index}`,
      category: (entry.category || entry.type?.toLowerCase?.() || "update") as TimelineCategory,
      title: entry.title || entry.type || "Update",
      description: String(entry.description || "").trim(),
      date: entry.date || createdAt.slice(0, 10),
      time: entry.time || "",
      followUpDate: entry.followUpDate || "",
      followUpTime: entry.followUpTime || "",
      createdAt,
      createdBy: entry.createdBy || entry.actionBy || "",
      assignedTo: entry.assignedTo || "",
    };
  });
}

export default function FollowUps({ onNavigate }: { onNavigate: (p: Page, leadId?: string) => void }) {
  const user = getSessionUser();
  const isAdmin = user.role === "admin";
  const restrictedLeadIds = getAllowedLeadIds(user);
  const restrictedLeadSet = new Set(restrictedLeadIds);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"next" | "today" | "missed">("next");

  useEffect(() => {
    const unsubLeads = onSnapshot(collection(db, "leads"), (snap) => {
      setLeads(snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() } as Lead)));
      setLoading(false);
    });
    const unsubActivities = onSnapshot(collection(db, "transactions"), (snap) => {
      setActivities(snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() } as Activity)));
    });
    return () => {
      unsubLeads();
      unsubActivities();
    };
  }, []);

  const visibleLeads = isRestrictedUser(user)
    ? leads.filter((lead) => restrictedLeadSet.has(lead.leadId))
    : leads;
  const visibleActivities = isRestrictedUser(user)
    ? activities.filter((activity) => restrictedLeadSet.has(activity.leadId))
    : activities;

  const followUpItems: FollowUpItem[] = [
    ...visibleLeads.flatMap((lead) => {
      const items: FollowUpItem[] = [];
      if (lead.followUpDate) {
        items.push({
          id: `prospect:${lead.id}`,
          leadId: lead.leadId,
          accountName: lead.accountName,
          title: "Prospect Follow-up",
          source: "Prospect",
          statusOrStage: lead.status || "-",
          followUpDate: lead.followUpDate,
          followUpTime: lead.followUpTime || "",
          assignedTo: "",
          handledBy: lead.handledBy || "",
          note: "",
          routePage: "leads",
          routeId: lead.leadId,
        });
      }
      normalizeTimelineEntries(lead.actions || []).forEach((entry) => {
        if (!entry.followUpDate) return;
        items.push({
          id: `prospect-action:${lead.id}:${entry.id}`,
          leadId: lead.leadId,
          accountName: lead.accountName,
          title: entry.title,
          source: "Prospect Action",
          statusOrStage: lead.status || "-",
          followUpDate: entry.followUpDate,
          followUpTime: entry.followUpTime || "",
          assignedTo: entry.assignedTo || "",
          handledBy: lead.handledBy || "",
          note: entry.description,
          routePage: "leads",
          routeId: lead.leadId,
        });
      });
      return items;
    }),
    ...visibleActivities.flatMap((activity) => {
      const items: FollowUpItem[] = [];
      if (activity.followUpDate) {
        items.push({
          id: `lead:${activity.id}`,
          leadId: activity.leadId,
          accountName: activity.accountName,
          title: activity.activityName,
          source: "Lead",
          statusOrStage: activity.stage || "-",
          followUpDate: activity.followUpDate,
          followUpTime: activity.followUpTime || "",
          assignedTo: "",
          handledBy: activity.handledBy || "",
          note: "",
          routePage: "activityDetail",
          routeId: activity.transactionId || activity.id,
        });
      }
      normalizeTimelineEntries(activity.actions || []).forEach((entry) => {
        if (!entry.followUpDate) return;
        items.push({
          id: `lead-action:${activity.id}:${entry.id}`,
          leadId: activity.leadId,
          accountName: activity.accountName,
          title: entry.title,
          source: "Lead Action",
          statusOrStage: activity.stage || "-",
          followUpDate: entry.followUpDate,
          followUpTime: entry.followUpTime || "",
          assignedTo: entry.assignedTo || "",
          handledBy: activity.handledBy || "",
          note: entry.description,
          routePage: "activityDetail",
          routeId: activity.transactionId || activity.id,
        });
      });
      return items;
    }),
  ].sort((a, b) => {
    const aKey = `${a.followUpDate}T${a.followUpTime || "23:59"}`;
    const bKey = `${b.followUpDate}T${b.followUpTime || "23:59"}`;
    return new Date(aKey).getTime() - new Date(bKey).getTime();
  });

  const todayCount = followUpItems.filter((item) => isTodayFollowUp(item.followUpDate)).length;
  const missedCount = followUpItems.filter((item) => isMissedFollowUp(item.followUpDate, item.followUpTime) && !isTodayFollowUp(item.followUpDate)).length;

  const filteredItems = followUpItems.filter((item) => {
    if (filter === "today" && !isTodayFollowUp(item.followUpDate)) return false;
    if (filter === "missed" && (!isMissedFollowUp(item.followUpDate, item.followUpTime) || isTodayFollowUp(item.followUpDate))) return false;
    if (filter === "next" && (isTodayFollowUp(item.followUpDate) || isMissedFollowUp(item.followUpDate, item.followUpTime))) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        item.accountName.toLowerCase().includes(q) ||
        item.leadId.toLowerCase().includes(q) ||
        item.title.toLowerCase().includes(q) ||
        item.note.toLowerCase().includes(q) ||
        item.assignedTo.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const logout = () => {
    signOut(auth);
    localStorage.removeItem("leadUser");
    window.location.reload();
  };

  if (loading) {
    return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8fafc" }}>Loading...</div>;
  }

  return (
    <div style={S.page}>
      <AppPageHeader
        current="followUps"
        onNavigate={onNavigate}
        isAdmin={isAdmin}
        onLogout={logout}
        bottomContent={
          <div style={S.headerControls}>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search follow ups..."
              style={S.searchInput}
            />
          </div>
        }
      />

      <div style={S.statsBar}>
        <button type="button" onClick={() => setFilter("today")} style={{ ...S.statCard, ...(filter === "today" ? S.statCardActive : {}) }}>
          <span style={S.statNumber}>{todayCount}</span>
          <span style={S.statLabel}>Today Follow Ups</span>
        </button>
        <button type="button" onClick={() => setFilter("missed")} style={{ ...S.statCard, ...(filter === "missed" ? S.statCardActive : {}) }}>
          <span style={S.statNumber}>{missedCount}</span>
          <span style={S.statLabel}>Missed Follow Ups</span>
        </button>
        <button type="button" onClick={() => setFilter("next")} style={{ ...S.statCard, ...(filter === "next" ? S.statCardActive : {}) }}>
          <span style={S.statNumber}>{followUpItems.filter((item) => item.followUpDate > formatLocalDateKey()).length}</span>
          <span style={S.statLabel}>Next Follow Ups</span>
        </button>
      </div>

      <div style={{ padding: "0 24px 40px" }}>
        <div style={S.tableWrap}>
          <table style={S.table}>
            <thead>
              <tr>
                {["Client Name", "Lead ID", "Source", "Title", "Follow-up Date", "Follow-up Time", "Assigned To", "Handled By", "Status / Stage", "Comment", "Open"].map((header) => (
                  <th key={header} style={S.th}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={11} style={S.emptyCell}>No follow-ups found for this filter.</td>
                </tr>
              ) : (
                filteredItems.map((item) => (
                  <tr key={item.id}>
                    <td style={S.td}>{item.accountName}</td>
                    <td style={S.td}>{item.leadId}</td>
                    <td style={S.td}>{item.source}</td>
                    <td style={S.td}>{item.title}</td>
                    <td style={S.td}>{item.followUpDate}</td>
                    <td style={S.td}>{item.followUpTime || "-"}</td>
                    <td style={S.td}>{item.assignedTo || "-"}</td>
                    <td style={S.td}>{item.handledBy || "-"}</td>
                    <td style={S.td}>{item.statusOrStage || "-"}</td>
                    <td style={{ ...S.td, whiteSpace: "pre-wrap", minWidth: 220 }}>{item.note || "-"}</td>
                    <td style={S.td}>
                      <button type="button" onClick={() => onNavigate(item.routePage, item.routeId)} style={S.openBtn}>
                        Open
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "#f8fafc",
    fontFamily: "'DM Sans','Segoe UI',sans-serif",
    color: "#0f172a",
  },
  headerControls: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
  },
  searchInput: {
    padding: "10px 14px",
    borderRadius: 12,
    border: "1px solid #d7dee8",
    fontSize: 13,
    background: "#ffffff",
    outline: "none",
    width: 260,
  },
  statsBar: {
    display: "flex",
    gap: 12,
    padding: "16px 24px",
    background: "#ffffff",
    borderBottom: "1px solid #e2e8f0",
    flexWrap: "wrap",
  },
  statCard: {
    border: "1px solid #dbe4f0",
    background: "#fff",
    borderRadius: 14,
    padding: "14px 18px",
    cursor: "pointer",
    display: "flex",
    flexDirection: "column",
    minWidth: 160,
  },
  statCardActive: {
    borderColor: "#93c5fd",
    background: "#eff6ff",
  },
  statNumber: {
    fontSize: 24,
    fontWeight: 800,
    color: "#0f172a",
  },
  statLabel: {
    fontSize: 12,
    color: "#64748b",
    marginTop: 4,
  },
  tableWrap: {
    overflowX: "auto",
    borderRadius: 12,
    border: "1px solid #cfd9e8",
    background: "#fff",
    boxShadow: "0 4px 18px rgba(15,23,42,0.06)",
    marginTop: 20,
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 13,
  },
  th: {
    padding: "13px 14px",
    textAlign: "left",
    background: "#edf4ff",
    color: "#1e3a5f",
    fontWeight: 800,
    fontSize: 12,
    whiteSpace: "nowrap",
    borderBottom: "2px solid #cbdcf6",
  },
  td: {
    padding: "12px 14px",
    color: "#334155",
    verticalAlign: "top",
    fontSize: 13,
    borderBottom: "1px solid #eef2f7",
  },
  emptyCell: {
    textAlign: "center",
    padding: "48px 0",
    color: "#94a3b8",
    fontSize: 14,
  },
  openBtn: {
    padding: "6px 12px",
    background: "#eff6ff",
    color: "#2563eb",
    border: "none",
    borderRadius: 8,
    cursor: "pointer",
    fontWeight: 700,
    fontSize: 12,
  },
};
