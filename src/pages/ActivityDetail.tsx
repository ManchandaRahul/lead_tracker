import { Fragment, useEffect, useMemo, useState } from "react";
import { collection, deleteDoc, doc, onSnapshot, updateDoc } from "firebase/firestore";
import { signOut } from "firebase/auth";
import { auth, db } from "../firebase/config";
import { logActivity } from "../firebase/activityLog";
import DeleteModal from "../components/DeleteModal";
import AppPageHeader from "../components/AppPageHeader";
import { Page } from "../navigation";

const STAGES = ["Initial Call", "Kickoff", "In Progress", "On Hold", "Review", "Completed"];
const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED", "SGD"];

const DEAL_PIPELINE_STAGES = [
  { id: "10", label: "Qualified", percent: "10%" },
  { id: "20", label: "Meeting ar...", percent: "20%" },
  { id: "40", label: "Needs defi...", percent: "40%" },
  { id: "60", label: "Proposal s...", percent: "60%" },
  { id: "80", label: "Negotiation", percent: "80%" },
  { id: "100", label: "Won", percent: "100%" },
];

const DEAL_PIPELINE_STAGE_FULL_LABELS: Record<string, string> = {
  "10": "Qualified",
  "20": "Meeting arranged",
  "40": "Needs defined",
  "60": "Proposal sent",
  "80": "Negotiation",
  "100": "Won",
};

type DealItem = {
  itemName: string;
  description: string;
  cost: string;
  price: string;
};

type TimelineCategory = "note" | "call" | "meeting" | "deal" | "update";

type TimelineEntry = {
  id: string;
  category: TimelineCategory;
  title: string;
  description: string;
  date: string;
  time?: string;
  place?: string;
  createdAt: string;
  createdBy?: string;
  amount?: string;
};

type DealTimelineFilter = "all" | "inprogress" | "won" | "lost";

const TIMELINE_FILTERS: { key: "all" | TimelineCategory; label: string }[] = [
  { key: "all", label: "All" },
  { key: "note", label: "Notes" },
  { key: "call", label: "Calls" },
  { key: "meeting", label: "Meetings" },
  { key: "deal", label: "Deals" },
];

const TIMELINE_META: Record<TimelineCategory, { label: string; bg: string; color: string }> = {
  note: { label: "Note", bg: "#eff6ff", color: "#2563eb" },
  call: { label: "Call", bg: "#fef3c7", color: "#b45309" },
  meeting: { label: "Meeting", bg: "#ede9fe", color: "#7c3aed" },
  deal: { label: "Deal", bg: "#ffe4e6", color: "#be123c" },
  update: { label: "Update", bg: "#f1f5f9", color: "#475569" },
};

const createEmptyDealItem = (): DealItem => ({
  itemName: "",
  description: "",
  cost: "",
  price: "",
});

const EMPTY_ACTIVITY = {
  transactionId: "",
  leadId: "",
  accountName: "",
  activityName: "",
  activityDate: "",
  stage: "Kickoff",
  handledBy: "",
  notes: "",
  isDeal: false,
  dealName: "",
  dealValue: "",
  dealCurrency: "INR",
  dealDurationMonths: "12",
  commissionPercent: "10",
  isMultiMonth: true,
  hasCommission: true,
  hasCost: false,
  dealItems: [createEmptyDealItem()],
  dueDate: "",
  probability: "",
  dealStatus: "open",
  outcomeStageId: "",
  outcomeStageLabel: "",
  wonDate: "",
  wonTime: "",
  actions: [] as TimelineEntry[],
};

type Activity = typeof EMPTY_ACTIVITY & { id: string; createdAt?: string };
type Lead = {
  id: string;
  leadId: string;
  accountName: string;
  programName?: string;
  projectId?: string;
  engagementName?: string;
  engagementType?: string;
  clientSpoc?: string;
  clientSpocPosition?: string;
  clientEmail?: string;
  clientPhone?: string;
  partnerSpoc?: string;
  partnerSpocPosition?: string;
  partnerEmail?: string;
  partnerPhone?: string;
  status?: string;
  remarks?: string;
};

function generateTimelineId() {
  return `TL_${Date.now()}_${Math.floor(Math.random() * 9000 + 1000)}`;
}

function expandDealStageText(value: string) {
  return value
    .replace(/Meeting ar\.\.\./g, "Meeting arranged")
    .replace(/Needs defi\.\.\./g, "Needs defined")
    .replace(/Proposal s\.\.\.\./g, "Proposal sent")
    .replace(/Proposal s\.\.\./g, "Proposal sent");
}

function formatDisplayDate(value?: string) {
  if (!value) return "";
  const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return `${isoMatch[3]}-${isoMatch[2]}-${isoMatch[1]}`;
  }
  return value;
}

function normalizeTimelineEntries(entries: any[] = []): TimelineEntry[] {
  return entries.map((entry, index) => {
    const category = (entry.category || entry.type?.toLowerCase?.() || "update") as TimelineCategory;
    const createdAt = entry.createdAt || entry.timestamp || new Date().toISOString();
    return {
      id: entry.id || `${createdAt}_${index}`,
      category,
      title: expandDealStageText(entry.title || entry.type || TIMELINE_META[category]?.label || "Update"),
      description: expandDealStageText(entry.description || ""),
      date: entry.date || createdAt.slice(0, 10),
      time: entry.time || "",
      place: expandDealStageText(entry.place || ""),
      createdAt,
      createdBy: entry.createdBy || entry.actionBy || "",
      amount: entry.amount || "",
    };
  });
}

function createTimelineEntry(
  userName: string,
  category: TimelineCategory,
  title: string,
  description: string,
  overrides: Partial<TimelineEntry> = {}
): TimelineEntry {
  return {
    id: generateTimelineId(),
    category,
    title,
    description,
    date: overrides.date || new Date().toISOString().slice(0, 10),
    time: overrides.time || "",
    place: overrides.place || "",
    createdAt: overrides.createdAt || new Date().toISOString(),
    createdBy: overrides.createdBy || userName,
    amount: overrides.amount || "",
  };
}

function getEffectiveAmountFromActivity(activity: Partial<Activity>) {
  const rawAmount = parseFloat(String(activity.dealValue || "0")) || 0;
  const rawMonths = parseFloat(String(activity.dealDurationMonths || "0")) || 0;
  return activity.isMultiMonth ? rawAmount * Math.max(rawMonths, 1) : rawAmount;
}

function formatDealAmount(activity: Partial<Activity>) {
  return `${activity.dealCurrency || "INR"} ${getEffectiveAmountFromActivity(activity).toLocaleString("en-IN")}`;
}

function getStageLabel(probability?: string) {
  const id = probability || "10";
  const match = DEAL_PIPELINE_STAGES.find((stage) => stage.id === id);
  const fullLabel = DEAL_PIPELINE_STAGE_FULL_LABELS[id];
  return match && fullLabel ? `${match.percent} ${fullLabel}` : `${probability || "0"}%`;
}

function getValidStageId(probability?: string) {
  return DEAL_PIPELINE_STAGES.some((stage) => stage.id === (probability || "")) ? (probability as string) : "10";
}

function buildActivityDraft(activity: Activity) {
  return {
    ...EMPTY_ACTIVITY,
    ...activity,
    dealItems:
      Array.isArray((activity as any).dealItems) && (activity as any).dealItems.length > 0
        ? (activity as any).dealItems
        : [createEmptyDealItem()],
  };
}

export default function ActivityDetail({
  onNavigate,
  routeActivityId,
}: {
  onNavigate: (p: Page, leadId?: string) => void;
  routeActivityId?: string | null;
}) {
  const user = JSON.parse(localStorage.getItem("leadUser")!);
  const isAdmin = user.role === "admin";
  const logout = () => {
    signOut(auth);
    localStorage.removeItem("leadUser");
    window.location.reload();
  };

  const [activities, setActivities] = useState<Activity[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState({ ...EMPTY_ACTIVITY });
  const [showEdit, setShowEdit] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [showLostModal, setShowLostModal] = useState(false);
  const [selectedLostReason, setSelectedLostReason] = useState("");
  const [actionDeleteModal, setActionDeleteModal] = useState<{ index: number; action: TimelineEntry } | null>(null);
  const [deletedActionLogs, setDeletedActionLogs] = useState<{ action: any; reason: string; deletedAt: string }[]>([]);
  const [activeAction, setActiveAction] = useState<"Note" | "Call" | "Meeting" | null>(null);
  const [showDealEditor, setShowDealEditor] = useState(false);
  const [actionTime, setActionTime] = useState("11:31");
  const [meetingMode, setMeetingMode] = useState<"offline" | "online">("offline");
  const [meetingPlace, setMeetingPlace] = useState("");
  const [meetingUrl, setMeetingUrl] = useState("");
  const [actionDescription, setActionDescription] = useState("");
  const [actionDate, setActionDate] = useState(new Date().toISOString().slice(0, 10));
  const [timelineFilter, setTimelineFilter] = useState<"all" | TimelineCategory>("all");
  const [dealTimelineFilter, setDealTimelineFilter] = useState<DealTimelineFilter>("all");

  useEffect(() => {
    const u1 = onSnapshot(collection(db, "transactions"), (snap) => {
      setActivities(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Activity)));
      setLoading(false);
    });
    const u2 = onSnapshot(collection(db, "leads"), (snap) => {
      setLeads(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Lead)));
    });
    return () => {
      u1();
      u2();
    };
  }, []);

  const selectedActivity = useMemo(
    () =>
      activities.find(
        (activity) => activity.transactionId === routeActivityId || activity.id === routeActivityId
      ) || null,
    [activities, routeActivityId]
  );

  const selectedLead = useMemo(
    () => (selectedActivity ? leads.find((lead) => lead.leadId === selectedActivity.leadId) || null : null),
    [leads, selectedActivity]
  );

  useEffect(() => {
    if (selectedActivity) {
      setDraft(buildActivityDraft(selectedActivity));
      setDeletedActionLogs([]);
      setActiveAction(null);
      setShowDealEditor(!!selectedActivity.isDeal);
      setActionDescription("");
      setMeetingMode("offline");
      setMeetingPlace("");
      setMeetingUrl("");
      setTimelineFilter("all");
      setDealTimelineFilter("all");
      setSaveFeedback(null);
    }
  }, [selectedActivity]);

  const timelineEntries = normalizeTimelineEntries(draft.actions || []).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  const filteredTimelineEntries = useMemo(() => {
    const primaryFiltered =
      timelineFilter === "all" ? timelineEntries : timelineEntries.filter((entry) => entry.category === timelineFilter);

    if (timelineFilter !== "deal") {
      return primaryFiltered;
    }

    if (dealTimelineFilter === "all") return primaryFiltered;
    if (dealTimelineFilter === "won") {
      return primaryFiltered.filter((entry) => entry.title === "Deal Won" || entry.title === "Deal Won Date Updated");
    }
    if (dealTimelineFilter === "lost") {
      return primaryFiltered.filter((entry) => entry.title === "Deal Lost");
    }
    return primaryFiltered.filter(
      (entry) => !["Deal Won", "Deal Won Date Updated", "Deal Lost"].includes(entry.title)
    );
  }, [timelineEntries, timelineFilter, dealTimelineFilter]);

  const effectiveDealAmount = getEffectiveAmountFromActivity(draft);
  const commissionValue =
    effectiveDealAmount * ((parseFloat(draft.commissionPercent || "0") || 0) / 100);
  const weightedDealAmount =
    effectiveDealAmount * ((parseFloat(draft.probability || "0") || 0) / 100);
  const dealItemTemplateColumns = ["1.15fr", "1.55fr", draft.hasCost ? "0.7fr" : null, "0.7fr", "48px"]
    .filter(Boolean)
    .join(" ");

  const getDealTimelineEntries = (previousActivity: Activity | null, nextActivity: typeof EMPTY_ACTIVITY) => {
    const entries: TimelineEntry[] = [];
    const currentAmount = formatDealAmount(nextActivity);

    if (!previousActivity && nextActivity.isDeal) {
      entries.push(
        createTimelineEntry(
          user.username,
          "deal",
          "Deal Created",
          `Deal "${nextActivity.dealName || nextActivity.activityName}" was created at ${nextActivity.dealCurrency} ${getEffectiveAmountFromActivity(nextActivity).toLocaleString("en-IN")} in ${getStageLabel(nextActivity.probability)}.`,
          { amount: currentAmount }
        )
      );
      return entries;
    }

    if (!previousActivity) return entries;
    const wasDeal = !!previousActivity.isDeal;
    const isDeal = !!nextActivity.isDeal;

    if (!wasDeal && isDeal) {
      entries.push(
        createTimelineEntry(
          user.username,
          "deal",
          "Deal Added",
          `Deal was added to this activity at ${nextActivity.dealCurrency} ${getEffectiveAmountFromActivity(nextActivity).toLocaleString("en-IN")}.`,
          { amount: currentAmount }
        )
      );
      return entries;
    }

    if (wasDeal && !isDeal) {
      entries.push(createTimelineEntry(user.username, "deal", "Deal Removed", "Deal tracking was removed from this activity."));
      return entries;
    }

    if (!wasDeal || !isDeal) return entries;

    if ((previousActivity.dealName || "") !== (nextActivity.dealName || "")) {
      entries.push(
        createTimelineEntry(
          user.username,
          "deal",
          "Deal Name Updated",
          `Deal name changed from "${previousActivity.dealName || "Untitled Deal"}" to "${nextActivity.dealName || "Untitled Deal"}".`,
          { amount: currentAmount }
        )
      );
    }

    const previousAmount = getEffectiveAmountFromActivity(previousActivity);
    const nextAmount = getEffectiveAmountFromActivity(nextActivity);
    if (
      previousAmount !== nextAmount ||
      (previousActivity.dealCurrency || "INR") !== (nextActivity.dealCurrency || "INR")
    ) {
      entries.push(
        createTimelineEntry(
          user.username,
          "deal",
          "Deal Amount Updated",
          `Deal amount changed from ${(previousActivity.dealCurrency || "INR")} ${previousAmount.toLocaleString("en-IN")} to ${(nextActivity.dealCurrency || "INR")} ${nextAmount.toLocaleString("en-IN")}.`,
          { amount: currentAmount }
        )
      );
    }

    const previousStageId = getValidStageId(previousActivity.probability);
    const nextStageId = getValidStageId(nextActivity.probability);

    if ((previousActivity.probability || "10") !== (nextActivity.probability || "10")) {
      entries.push(
        createTimelineEntry(
          user.username,
          "deal",
          "Deal Stage Updated",
          `Deal stage changed from ${getStageLabel(previousActivity.probability)} to ${getStageLabel(nextActivity.probability)}.`,
          { amount: currentAmount }
        )
      );
    }

    if ((previousActivity.dealStatus || "open") !== "won" && nextActivity.dealStatus === "won") {
      entries.push(
        createTimelineEntry(
          user.username,
          "deal",
          "Deal Won",
          `Deal was won from ${getStageLabel(previousStageId)}.`,
          { amount: currentAmount }
        )
      );
    }

    if (!!previousActivity.isMultiMonth !== !!nextActivity.isMultiMonth) {
      entries.push(
        createTimelineEntry(
          user.username,
          "deal",
          "Multi-month Updated",
          `Multi-month was turned ${nextActivity.isMultiMonth ? "on" : "off"}.`,
          { amount: currentAmount }
        )
      );
    }

    if (!!previousActivity.hasCommission !== !!nextActivity.hasCommission) {
      entries.push(
        createTimelineEntry(
          user.username,
          "deal",
          "Commission Updated",
          `Commission was turned ${nextActivity.hasCommission ? "on" : "off"}.`,
          { amount: currentAmount }
        )
      );
    }

    if (
      nextActivity.hasCommission &&
      (previousActivity.commissionPercent || "0") !== (nextActivity.commissionPercent || "0")
    ) {
      entries.push(
        createTimelineEntry(
          user.username,
          "deal",
          "Commission Percentage Updated",
          `Commission changed from ${previousActivity.commissionPercent || "0"}% to ${nextActivity.commissionPercent || "0"}%.`,
          { amount: currentAmount }
        )
      );
    }

    if (!!previousActivity.hasCost !== !!nextActivity.hasCost) {
      entries.push(
        createTimelineEntry(
          user.username,
          "deal",
          "Cost Tracking Updated",
          `Cost tracking was turned ${nextActivity.hasCost ? "on" : "off"}.`,
          { amount: currentAmount }
        )
      );
    }

    if ((previousActivity.dueDate || "") !== (nextActivity.dueDate || "")) {
      entries.push(
        createTimelineEntry(
          user.username,
          "deal",
          "Expected Close Date Updated",
          `Expected close date changed from ${previousActivity.dueDate || "not set"} to ${nextActivity.dueDate || "not set"}.`,
          { amount: currentAmount }
        )
      );
    }

    if ((previousActivity.wonDate || "") !== (nextActivity.wonDate || "") && nextActivity.wonDate) {
      entries.push(
        createTimelineEntry(
          user.username,
          "deal",
          "Deal Won Date Updated",
          `Won date changed to ${nextActivity.wonDate}${nextActivity.wonTime ? ` at ${nextActivity.wonTime}` : ""}.`,
          { amount: currentAmount }
        )
      );
    }

    if (JSON.stringify(previousActivity.dealItems || []) !== JSON.stringify(nextActivity.dealItems || [])) {
      entries.push(createTimelineEntry(user.username, "deal", "Deal Items Updated", "Deal items were updated.", { amount: currentAmount }));
    }

    return entries;
  };

  const persistActivity = async (sourceData: typeof EMPTY_ACTIVITY) => {
    if (!selectedActivity) return null;
    const previousActivity = selectedActivity;
    const basePayload = {
      ...sourceData,
      actions: normalizeTimelineEntries(sourceData.actions || []),
      transactionId: sourceData.transactionId || previousActivity.transactionId,
      activityDate: sourceData.activityDate || new Date().toISOString().slice(0, 10),
      updatedAt: new Date().toISOString(),
    };
    const dealTimelineEntries = getDealTimelineEntries(previousActivity, basePayload);
    const payload = {
      ...basePayload,
      actions: [...basePayload.actions, ...dealTimelineEntries],
    };

    await updateDoc(doc(db, "transactions", previousActivity.id), payload);
    await logActivity(payload.transactionId, payload.accountName, "transactions", {
      actionType: "TXN_EDITED",
      description: `Activity "${payload.activityName}" for "${payload.accountName}" was edited`,
      actionBy: user.username,
      timestamp: new Date().toISOString(),
    });
    for (const dealEntry of dealTimelineEntries) {
      await logActivity(payload.transactionId, payload.accountName, "transactions", {
        actionType: "TXN_EDITED",
        description: dealEntry.description,
        actionBy: user.username,
        timestamp: dealEntry.createdAt,
      });
    }
    for (const deletedAction of deletedActionLogs) {
      const actionLabel = [
        deletedAction.action.title || deletedAction.action.type || deletedAction.action.category,
        deletedAction.action.date,
        deletedAction.action.time ? `at ${deletedAction.action.time}` : "",
      ]
        .filter(Boolean)
        .join(" ");
      await logActivity(payload.transactionId, payload.accountName, "transactions", {
        actionType: "TXN_EDITED",
        description: `Action "${actionLabel}" was deleted from activity "${payload.activityName}". Reason: ${deletedAction.reason}`,
        actionBy: user.username,
        timestamp: deletedAction.deletedAt,
      });
    }

    setDraft((prev) => ({ ...prev, ...payload }));
    setDeletedActionLogs([]);
    return payload;
  };

  const handleSaveChanges = async () => {
    try {
      setSavingEdit(true);
      setSaveFeedback(null);
      const payload = await persistActivity(draft);
      if (!payload) {
        setSaveFeedback({ type: "error", message: "Unable to save this activity." });
        return;
      }
      setShowEdit(false);
      setSaveFeedback({ type: "success", message: "Activity updated successfully." });
    } catch (error) {
      setSaveFeedback({ type: "error", message: "Failed to save changes. Please try again." });
    } finally {
      setSavingEdit(false);
    }
  };

  const saveAction = async () => {
    if (!activeAction) return;
    const category = activeAction.toLowerCase() as TimelineCategory;
    const meetingContext =
      activeAction === "Meeting"
        ? meetingMode === "online"
          ? `Online - ${meetingUrl.trim()}`
          : meetingPlace.trim()
        : "";
    const newAction = createTimelineEntry(user.username, category, activeAction, actionDescription || "", {
      date: actionDate,
      time: actionTime,
      place: meetingContext,
    });
    const nextDraft = {
      ...draft,
      actions: [...normalizeTimelineEntries(draft.actions || []), newAction],
    };
    setDraft(nextDraft);
    try {
      await persistActivity(nextDraft);
      setSaveFeedback({ type: "success", message: `${activeAction} saved successfully.` });
    } catch (error) {
      setSaveFeedback({ type: "error", message: `Failed to save ${activeAction.toLowerCase()}. Please try again.` });
      return;
    }
    setActiveAction(null);
    setActionDescription("");
    setMeetingMode("offline");
    setMeetingPlace("");
    setMeetingUrl("");
  };

  const saveDeal = async () => {
    try {
      await persistActivity(draft);
      setShowDealEditor(false);
      setSaveFeedback({ type: "success", message: "Deal saved successfully." });
    } catch (error) {
      setSaveFeedback({ type: "error", message: "Failed to save deal. Please try again." });
    }
  };

  const handleSaveLostReason = async () => {
    if (!selectedLostReason) return;
    const currentStageId = getValidStageId(draft.probability);
    const currentStageLabel = getStageLabel(currentStageId);
    const reasonText = `Deal was lost at ${currentStageLabel}. Reason: ${selectedLostReason}`;
    const nextDraft = {
      ...draft,
      probability: "0",
      dealStatus: "lost",
      outcomeStageId: currentStageId,
      outcomeStageLabel: currentStageLabel,
      actions: [...normalizeTimelineEntries(draft.actions || []), createTimelineEntry(user.username, "deal", "Deal Lost", reasonText)],
    };
    setDraft(nextDraft);
    try {
      await persistActivity(nextDraft);
      setSaveFeedback({ type: "success", message: "Deal loss updated successfully." });
    } catch (error) {
      setSaveFeedback({ type: "error", message: "Failed to save lost deal state. Please try again." });
      return;
    }
    setShowLostModal(false);
    setSelectedLostReason("");
  };

  const confirmDeleteAction = async (reason: string) => {
    if (!actionDeleteModal) return;
    const updated = [...normalizeTimelineEntries(draft.actions || [])];
    updated.splice(actionDeleteModal.index, 1);
    const nextDeletedActionLogs = [
      ...deletedActionLogs,
      {
        action: actionDeleteModal.action,
        reason,
        deletedAt: new Date().toISOString(),
      },
    ];
    const nextDraft = { ...draft, actions: updated };
    setDraft(nextDraft);
    setDeletedActionLogs(nextDeletedActionLogs);
    try {
      await persistActivity(nextDraft);
      setSaveFeedback({ type: "success", message: "Timeline item deleted successfully." });
    } catch (error) {
      setSaveFeedback({ type: "error", message: "Failed to delete timeline item. Please try again." });
      return;
    }
    setActionDeleteModal(null);
  };

  const confirmDeleteActivity = async (reason: string) => {
    if (!selectedActivity) return;
    await logActivity(selectedActivity.transactionId, selectedActivity.accountName, "transactions", {
      actionType: "TXN_DELETED",
      description: `Activity "${selectedActivity.activityName}" for "${selectedActivity.accountName}" was deleted. Reason: ${reason}`,
      actionBy: user.username,
      timestamp: new Date().toISOString(),
    });
    await deleteDoc(doc(db, "transactions", selectedActivity.id));
    if (selectedActivity.leadId) onNavigate("transactions", selectedActivity.leadId);
    else onNavigate("transactions");
  };

  if (loading) {
    return (
      <div style={S.loadingPage}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>🔥</div>
          <div style={{ fontSize: 15, color: "#64748b" }}>Loading…</div>
        </div>
      </div>
    );
  }

  if (!selectedActivity) {
    return (
      <div style={S.page}>
        <AppPageHeader current="transactions" onNavigate={onNavigate} isAdmin={isAdmin} onLogout={logout} />
        <div style={S.notFoundCard}>
          <h2 style={{ margin: 0, fontSize: 22, color: "#0f172a" }}>Activity not found</h2>
          <p style={{ margin: 0, color: "#64748b", lineHeight: 1.6 }}>
            No activity could be found for <strong>{routeActivityId}</strong>.
          </p>
          <button type="button" onClick={() => onNavigate("transactions")} style={S.btnPrimary}>
            Back to Activities
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={S.page}>
      <AppPageHeader current="transactions" onNavigate={onNavigate} isAdmin={isAdmin} onLogout={logout} />

      <div style={S.content}>
        <div style={S.breadcrumbRow}>
          <div style={S.breadcrumbs}>
            <button type="button" onClick={() => onNavigate("transactions")} style={S.breadcrumbBtn}>Activities</button>
            <span style={S.breadcrumbSlash}>/</span>
            <span style={S.breadcrumbCurrent}>{draft.transactionId}</span>
          </div>
          <div style={S.breadcrumbActions}>
            <button
              type="button"
              onClick={() => (draft.leadId ? onNavigate("transactions", draft.leadId) : onNavigate("transactions"))}
              style={S.btnOutline}
            >
              Back
            </button>
            <button type="button" onClick={() => setShowEdit((prev) => !prev)} style={S.btnOutline}>
              {showEdit ? "Close Edit" : "Edit Activity"}
            </button>
            <button type="button" onClick={() => setDeleteModalOpen(true)} style={S.deleteActionBtn}>
              Delete
            </button>
          </div>
        </div>

        {saveFeedback && (
          <div
            style={{
              padding: "12px 16px",
              borderRadius: 12,
              border: `1px solid ${saveFeedback.type === "success" ? "#bbf7d0" : "#fecaca"}`,
              background: saveFeedback.type === "success" ? "#f0fdf4" : "#fef2f2",
              color: saveFeedback.type === "success" ? "#15803d" : "#b91c1c",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {saveFeedback.message}
          </div>
        )}

        {showEdit && (
          <div style={S.editCard}>
            <h3 style={S.cardTitle}>Edit Activity</h3>
            <div style={S.formGrid}>
              <div style={S.formField}>
                <label style={S.fLabel}>Account Name</label>
                <input style={S.fInput} value={draft.accountName} onChange={(e) => setDraft({ ...draft, accountName: e.target.value })} />
              </div>
              <div style={S.formField}>
                <label style={S.fLabel}>Activity Name</label>
                <input style={S.fInput} value={draft.activityName} onChange={(e) => setDraft({ ...draft, activityName: e.target.value })} />
              </div>
              <div style={S.formField}>
                <label style={S.fLabel}>Date</label>
                <input type="date" style={S.fInput} value={draft.activityDate} onChange={(e) => setDraft({ ...draft, activityDate: e.target.value })} />
              </div>
              <div style={S.formField}>
                <label style={S.fLabel}>Stage</label>
                <select style={S.fInput} value={draft.stage} onChange={(e) => setDraft({ ...draft, stage: e.target.value })}>
                  {STAGES.map((stage) => <option key={stage}>{stage}</option>)}
                </select>
              </div>
              <div style={S.formField}>
                <label style={S.fLabel}>Handled By</label>
                <input style={S.fInput} value={draft.handledBy} onChange={(e) => setDraft({ ...draft, handledBy: e.target.value })} />
              </div>
            </div>
            <div style={{ padding: "0 0 20px" }}>
              <label style={S.fLabel}>Notes</label>
              <textarea rows={3} style={{ ...S.fInput, resize: "vertical" }} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button type="button" onClick={handleSaveChanges} style={S.btnPrimary} disabled={savingEdit}>
                {savingEdit ? "Saving..." : "Save Changes"}
              </button>
              <button type="button" onClick={() => { setDraft(buildActivityDraft(selectedActivity)); setShowEdit(false); }} style={S.btnOutline}>Cancel</button>
            </div>
          </div>
        )}

        {selectedLead && (
          <div style={S.summaryCard}>
            <h2 style={S.cardTitle}>Lead Information</h2>
            <div style={S.summaryGrid}>
              {[
                ["Client Name", selectedLead.accountName],
                ["Program Name", selectedLead.programName],
                ["Project Name", selectedLead.projectId],
                ["Engagement Name", selectedLead.engagementName],
                ["Engagement Type", selectedLead.engagementType],
                ["Client SPOC", selectedLead.clientSpoc],
                ["Client Designation", selectedLead.clientSpocPosition],
                ["Client Email", selectedLead.clientEmail],
                ["Client Phone", selectedLead.clientPhone],
                ["Partner SPOC", selectedLead.partnerSpoc],
                ["Partner Designation", selectedLead.partnerSpocPosition],
                ["Partner Email", selectedLead.partnerEmail],
                ["Partner Phone", selectedLead.partnerPhone],
                ["Status", selectedLead.status],
                ["Remarks", selectedLead.remarks],
              ].map(([label, value]) => (
                <div key={label} style={S.detailItem}>
                  <div style={S.detailLabel}>{label}</div>
                  <div style={S.detailValue}>{value || "-"}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={S.summaryCard}>
          <h2 style={S.cardTitle}>Activity Summary</h2>
          <div style={S.summaryGrid}>
            {[
              ["Activity Name", draft.activityName],
              ["Account Name", draft.accountName],
              ["Lead ID", draft.leadId],
              ["Date", draft.activityDate],
              ["Stage", draft.stage],
              ["Handled By", draft.handledBy],
              ["Notes", draft.notes],
            ].map(([label, value]) => (
              <div key={label} style={S.detailItem}>
                <div style={S.detailLabel}>{label}</div>
                <div style={S.detailValue}>{value || "-"}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={S.workspaceCard}>
          <h2 style={S.cardTitle}>Actions</h2>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
            <button
              type="button"
              onClick={() => {
                setActiveAction(null);
                setActionDescription("");
                setMeetingMode("offline");
                setMeetingPlace("");
                setMeetingUrl("");
                setDraft((prev) => ({
                  ...prev,
                  isDeal: true,
                  probability: prev.probability || "10",
                  dealItems: prev.dealItems && prev.dealItems.length > 0 ? prev.dealItems : [createEmptyDealItem()],
                }));
                setShowDealEditor((prev) => !prev || !draft.isDeal);
              }}
              style={{
                padding: "8px 20px",
                borderRadius: 9999,
                border: showDealEditor ? "1px solid #be185d" : "1px solid #cbd5e1",
                background: showDealEditor ? "#e11d48" : "#fff",
                color: showDealEditor ? "#fff" : "#334155",
                fontSize: 14,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              {showDealEditor ? "Deal On" : "+ Deal"}
            </button>
            {(["Note", "Call", "Meeting"] as const).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => {
                  setShowDealEditor(false);
                  setActiveAction(type);
                  setActionDescription("");
                  setMeetingMode("offline");
                  setMeetingPlace("");
                  setMeetingUrl("");
                }}
                style={S.quickBtn}
              >
                + {type}
              </button>
            ))}
          </div>

          {draft.isDeal && showDealEditor && (
            <div style={S.dealCard}>
              <div style={S.dealTop}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span style={S.dealAmount}>
                    {draft.dealCurrency} {effectiveDealAmount.toLocaleString("en-IN")}
                  </span>
                  <span style={{ fontSize: 13, color: "#94a3b8" }}>•</span>
                  <span style={{ fontSize: 13, color: "#475569" }}>
                    There&apos;s a {draft.probability || "10"}% chance it will close on{" "}
                    <span style={{ color: "#2563eb", fontWeight: 700 }}>{draft.dueDate || "Select date"}</span>
                  </span>
                </div>
                <button type="button" onClick={() => setShowLostModal(true)} style={S.lostBtn}>Lost</button>
              </div>

              <div style={S.pipelineRow}>
                {DEAL_PIPELINE_STAGES.map((stage, index) => {
                  const isActive = draft.probability === stage.id || (!draft.probability && stage.id === "10");
                  return (
                    <Fragment key={stage.id}>
                      <button
                        type="button"
                        onClick={() =>
                          setDraft((prev) => {
                            const previousStageId = getValidStageId(prev.probability);
                            return {
                              ...prev,
                              probability: stage.id,
                              dealStatus: stage.id === "100" ? "won" : "open",
                              outcomeStageId: stage.id === "100" ? previousStageId : "",
                              outcomeStageLabel: stage.id === "100" ? getStageLabel(previousStageId) : "",
                            };
                          })
                        }
                        style={{
                          padding: "0 14px",
                          minHeight: 34,
                          borderRadius: 10,
                          border: isActive ? (stage.id === "100" ? "1.5px solid #60a5fa" : "1.5px solid #e11d48") : "1.5px solid #cbd5e1",
                          background: isActive ? (stage.id === "100" ? "#ffffff" : "#e11d48") : "#ffffff",
                          color: isActive ? (stage.id === "100" ? "#3b82f6" : "#ffffff") : "#475569",
                          fontSize: 12,
                          fontWeight: 700,
                          cursor: "pointer",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          whiteSpace: "nowrap",
                        }}
                      >
                        <span>{stage.percent}</span>
                        <span style={{ opacity: isActive && stage.id !== "100" ? 0.7 : 0.5 }}>|</span>
                        <span>{stage.label}</span>
                      </button>
                      {index < DEAL_PIPELINE_STAGES.length - 1 && <span style={{ alignSelf: "center", color: "#cbd5e1", fontSize: 22 }}>›</span>}
                    </Fragment>
                  );
                })}
              </div>

                <div style={S.dealGrid}>
                <div>
                  <div style={{ marginBottom: 18 }}>
                    <label style={S.fLabel}>Deal name</label>
                    <input style={S.fInput} value={draft.dealName || ""} onChange={(e) => setDraft({ ...draft, dealName: e.target.value })} placeholder="Enter deal name" />
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: draft.isMultiMonth ? "minmax(0,1fr) 20px 110px" : "minmax(0,1fr)", gap: 10, alignItems: "end", marginBottom: 16 }}>
                    <div>
                      <label style={S.fLabel}>{draft.isMultiMonth ? "Monthly amount" : "Amount"}</label>
                      <div style={{ display: "flex", gap: 8 }}>
                        <select value={draft.dealCurrency} onChange={(e) => setDraft({ ...draft, dealCurrency: e.target.value })} style={{ ...S.fInput, width: 98 }}>
                          {CURRENCIES.map((currency) => <option key={currency}>{currency}</option>)}
                        </select>
                        <input type="number" placeholder="0" value={draft.dealValue || ""} onChange={(e) => setDraft({ ...draft, dealValue: e.target.value })} style={S.fInput} />
                      </div>
                    </div>
                    {draft.isMultiMonth && (
                      <>
                        <div style={{ textAlign: "center", fontSize: 22, color: "#94a3b8", paddingBottom: 8 }}>x</div>
                        <div>
                          <label style={S.fLabel}>Months</label>
                          <input type="number" min="1" value={draft.dealDurationMonths || "12"} onChange={(e) => setDraft({ ...draft, dealDurationMonths: e.target.value })} style={S.fInput} />
                        </div>
                      </>
                    )}
                  </div>

                  {draft.hasCommission && (
                    <div style={{ marginBottom: 18 }}>
                      <label style={S.fLabel}>Commission %</label>
                      <div style={{ display: "grid", gridTemplateColumns: "110px 40px 1fr", gap: 10, alignItems: "center" }}>
                        <input type="number" min="0" value={draft.commissionPercent || "10"} onChange={(e) => setDraft({ ...draft, commissionPercent: e.target.value })} style={S.fInput} />
                        <div style={{ ...S.fInput, display: "flex", justifyContent: "center", alignItems: "center", padding: "9px 0" }}>%</div>
                        <div style={{ fontSize: 12, color: "#475569" }}>
                          Value <strong>{draft.dealCurrency} {commissionValue.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</strong> based on amount
                        </div>
                      </div>
                    </div>
                  )}

                  <div style={{ marginBottom: 18 }}>
                    <label style={S.fLabel}>Deal Items ({(draft.dealItems || []).length})</label>
                    <div style={{ border: "1px solid #dbe4f0", borderRadius: 12, overflow: "hidden", background: "#ffffff" }}>
                      <div style={{ display: "grid", gridTemplateColumns: dealItemTemplateColumns, gap: 0, background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                        {["Item Name", "Description", ...(draft.hasCost ? ["Cost"] : []), "Price", ""].map((label, index) => (
                          <div key={`${label}-${index}`} style={{ padding: "10px 12px", fontSize: 11, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
                        ))}
                      </div>
                      {(draft.dealItems || []).map((item, index) => (
                        <div key={index} style={{ display: "grid", gridTemplateColumns: dealItemTemplateColumns, borderBottom: index === (draft.dealItems || []).length - 1 ? "none" : "1px solid #eef2f7" }}>
                          <input value={item.itemName} onChange={(e) => setDraft((prev) => ({ ...prev, dealItems: prev.dealItems.map((it, idx) => idx === index ? { ...it, itemName: e.target.value } : it) }))} style={{ ...S.fInput, border: "none", borderRadius: 0, background: "#fff", padding: "12px", fontSize: 12 }} placeholder="Enter item name" />
                          <input value={item.description} onChange={(e) => setDraft((prev) => ({ ...prev, dealItems: prev.dealItems.map((it, idx) => idx === index ? { ...it, description: e.target.value } : it) }))} style={{ ...S.fInput, border: "none", borderRadius: 0, background: "#fff", padding: "12px", fontSize: 12 }} placeholder="Enter description" />
                          {draft.hasCost && <input type="number" value={item.cost} onChange={(e) => setDraft((prev) => ({ ...prev, dealItems: prev.dealItems.map((it, idx) => idx === index ? { ...it, cost: e.target.value } : it) }))} style={{ ...S.fInput, border: "none", borderRadius: 0, background: "#fff", padding: "12px", fontSize: 12 }} placeholder="0" />}
                          <input type="number" value={item.price} onChange={(e) => setDraft((prev) => ({ ...prev, dealItems: prev.dealItems.map((it, idx) => idx === index ? { ...it, price: e.target.value } : it) }))} style={{ ...S.fInput, border: "none", borderRadius: 0, background: "#fff", padding: "12px", fontSize: 12 }} placeholder="0" />
                          <button type="button" onClick={() => setDraft((prev) => {
                            const nextItems = prev.dealItems.filter((_, idx) => idx !== index);
                            return { ...prev, dealItems: nextItems.length > 0 ? nextItems : [createEmptyDealItem()] };
                          })} style={{ border: "none", background: "#fff", color: "#ef4444", fontSize: 16, cursor: "pointer" }}>×</button>
                        </div>
                      ))}
                    </div>
                    <button type="button" onClick={() => setDraft((prev) => ({ ...prev, dealItems: [...(prev.dealItems || []), createEmptyDealItem()] }))} style={S.insertItemsBtn}>
                      + Insert Items
                    </button>
                  </div>
                </div>

                <div>
                  <div style={{ display: "grid", gap: 14, marginBottom: 18 }}>
                    {[
                      { key: "isMultiMonth", label: "Multi-month" },
                      { key: "hasCommission", label: "Commission" },
                      { key: "hasCost", label: "Cost" },
                    ].map((toggle) => (
                      <label key={toggle.key} style={S.toggleRow}>
                        <span>{toggle.label}</span>
                        <button type="button" onClick={() => setDraft((prev) => ({ ...prev, [toggle.key]: !(prev as any)[toggle.key] }))} style={{ width: 48, height: 28, borderRadius: 9999, border: "none", background: (draft as any)[toggle.key] ? "#84cc16" : "#cbd5e1", position: "relative", cursor: "pointer" }}>
                          <span style={{ position: "absolute", top: 3, left: (draft as any)[toggle.key] ? 23 : 3, width: 22, height: 22, borderRadius: "50%", background: "#fff", transition: "left 0.2s ease", boxShadow: "0 2px 6px rgba(15,23,42,0.15)" }} />
                        </button>
                      </label>
                    ))}
                  </div>

                  <div style={{ display: "grid", gap: 16 }}>
                    <div>
                      <label style={S.fLabel}>Expected close date</label>
                      <input type="date" value={draft.dueDate} onChange={(e) => setDraft({ ...draft, dueDate: e.target.value })} style={S.fInput} />
                    </div>
                    {draft.probability === "100" && (
                      <>
                        <div>
                          <label style={S.fLabel}>Won Date</label>
                          <input type="date" value={draft.wonDate} onChange={(e) => setDraft({ ...draft, wonDate: e.target.value })} style={S.fInput} />
                        </div>
                        <div>
                          <label style={S.fLabel}>Won Time</label>
                          <input type="time" value={draft.wonTime} onChange={(e) => setDraft({ ...draft, wonTime: e.target.value })} style={S.fInput} />
                        </div>
                      </>
                    )}
                    {draft.dealValue && parseFloat(draft.dealValue) > 0 && draft.probability && parseFloat(draft.probability) > 0 && (
                      <div style={S.pipelineValueCard}>
                        <div style={S.pipelineValueLabel}>Pipeline Value</div>
                        <div style={S.pipelineValueAmount}>
                          {draft.dealCurrency} {weightedDealAmount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                        <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>Calculated as deal amount x close probability</div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div style={S.dealFooterActions}>
                <button type="button" onClick={saveDeal} style={S.btnPrimary}>Save Deal</button>
                <button
                  type="button"
                  onClick={() => {
                    setDraft(buildActivityDraft(selectedActivity));
                    setShowDealEditor(false);
                  }}
                  style={S.btnOutline}
                >
                  Reset
                </button>
              </div>
            </div>
          )}

          {activeAction && (
            <div style={S.inlineActionCard}>
              <h4 style={{ margin: "0 0 16px 0", fontSize: 16, fontWeight: 600 }}>Add {activeAction}</h4>
              <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
                <input type="time" value={actionTime} onChange={(e) => setActionTime(e.target.value)} style={{ ...S.fInput, width: 140 }} />
                {activeAction === "Meeting" && (
                  <select value={meetingMode} onChange={(e) => setMeetingMode(e.target.value as "offline" | "online")} style={{ ...S.fInput, width: 160 }}>
                    <option value="offline">Offline</option>
                    <option value="online">Online</option>
                  </select>
                )}
              </div>
              {activeAction === "Meeting" && (
                <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
                  {meetingMode === "online" ? (
                    <input
                      type="url"
                      placeholder="Meeting URL"
                      value={meetingUrl}
                      onChange={(e) => setMeetingUrl(e.target.value)}
                      style={{ ...S.fInput, flex: 1 }}
                    />
                  ) : (
                    <input
                      type="text"
                      placeholder="Meeting place"
                      value={meetingPlace}
                      onChange={(e) => setMeetingPlace(e.target.value)}
                      style={{ ...S.fInput, flex: 1 }}
                    />
                  )}
                </div>
              )}
              <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
                <input type="date" value={actionDate} onChange={(e) => setActionDate(e.target.value)} style={{ ...S.fInput, width: 180 }} />
                <textarea rows={4} placeholder={`Describe this ${activeAction.toLowerCase()}...`} value={actionDescription} onChange={(e) => setActionDescription(e.target.value)} style={{ ...S.fInput, flex: 1, resize: "vertical" }} />
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <button type="button" onClick={saveAction} style={S.btnPrimary}>Save {activeAction}</button>
                <button
                  type="button"
                  onClick={() => {
                    setActiveAction(null);
                    setMeetingMode("offline");
                    setMeetingPlace("");
                    setMeetingUrl("");
                  }}
                  style={S.btnOutline}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, marginTop: 12 }}>
            <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Timeline</h3>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {TIMELINE_FILTERS.map((filter) => (
                <button
                  key={filter.key}
                  type="button"
                  onClick={() => {
                    setTimelineFilter(filter.key);
                    if (filter.key !== "deal") setDealTimelineFilter("all");
                  }}
                  style={{
                    padding: "8px 16px",
                    borderRadius: 9999,
                    border: "1px solid",
                    borderColor: timelineFilter === filter.key ? "#93c5fd" : "transparent",
                    background: timelineFilter === filter.key ? "#eff6ff" : "#f8fafc",
                    color: timelineFilter === filter.key ? "#2563eb" : "#64748b",
                    fontWeight: 700,
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          </div>

          {timelineFilter === "deal" && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
              {[
                { key: "all", label: "All Deals" },
                { key: "inprogress", label: "Deal Inprogress" },
                { key: "won", label: "Deal Won" },
                { key: "lost", label: "Deal Lost" },
              ].map((filter) => {
                const isActive = dealTimelineFilter === filter.key;
                return (
                  <button
                    key={filter.key}
                    type="button"
                    onClick={() => setDealTimelineFilter(filter.key as DealTimelineFilter)}
                    style={{
                      padding: "7px 14px",
                      borderRadius: 9999,
                      border: "1px solid",
                      borderColor: isActive ? "#fecdd3" : "transparent",
                      background: isActive ? "#fff1f2" : "#f8fafc",
                      color: isActive ? "#be123c" : "#64748b",
                      fontWeight: 700,
                      fontSize: 13,
                      cursor: "pointer",
                    }}
                  >
                    {filter.label}
                  </button>
                );
              })}
            </div>
          )}

          {filteredTimelineEntries.length === 0 ? (
            <div style={S.emptyTimeline}>No timeline entries yet for this filter.</div>
          ) : (
            <div style={{ display: "grid", gap: 14 }}>
              {filteredTimelineEntries.map((entry, index) => {
                const meta = TIMELINE_META[entry.category];
                const originalIndex = normalizeTimelineEntries(draft.actions || []).findIndex((item) => item.id === entry.id);
                return (
                  <div key={entry.id} style={S.timelineEntry}>
                    <div style={S.timelineDot} />
                    <div style={S.timelineBody}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 6 }}>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                              <span style={{ padding: "4px 10px", borderRadius: 9999, background: meta.bg, color: meta.color, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>{meta.label}</span>
                              <span style={{ fontSize: 12, color: "#64748b" }}>{formatDisplayDate(entry.date)}{entry.time ? ` at ${entry.time}` : ""}</span>
                            </div>
                            {entry.createdBy && (
                              <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6 }}>Created by: {entry.createdBy}</div>
                            )}
                            {entry.category === "deal" && entry.amount && (
                              <div style={{ marginBottom: 8 }}>
                                <span style={S.timelineAmountPill}>Amount: {entry.amount}</span>
                              </div>
                            )}
                            <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a", marginBottom: entry.description ? 4 : 0, overflowWrap: "anywhere", wordBreak: "break-word" }}>{entry.title}</div>
                            {entry.place && <div style={{ fontSize: 12, color: "#64748b", marginBottom: entry.description ? 4 : 0, overflowWrap: "anywhere", wordBreak: "break-word" }}>Place: {entry.place}</div>}
                            {entry.description && <div style={{ fontSize: 13, color: "#334155", lineHeight: 1.45, overflowWrap: "anywhere", wordBreak: "break-word" }}>{entry.description}</div>}
                        </div>
                        <button type="button" onClick={() => setActionDeleteModal({ index: originalIndex, action: entry })} style={{ border: "none", background: "transparent", color: "#94a3b8", fontSize: 16, cursor: "pointer", flexShrink: 0, alignSelf: "flex-start" }}>×</button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

        </div>
      </div>

      {showLostModal && (
        <div style={S.modalBackdrop}>
          <div style={S.modalCard}>
            <div style={S.modalHeader}>
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Reason Lost</h2>
              <button onClick={() => { setShowLostModal(false); setSelectedLostReason(""); }} style={S.modalCloseBtn}>×</button>
            </div>
            <select value={selectedLostReason} onChange={(e) => setSelectedLostReason(e.target.value)} style={{ ...S.fInput, width: "100%", marginBottom: 24 }}>
              <option value="">Please select ...</option>
              <option value="Wrong time">Wrong time</option>
              <option value="Price too high">Price too high</option>
              <option value="No authority">No authority</option>
              <option value="Competitor">Competitor</option>
            </select>
            <button onClick={handleSaveLostReason} style={{ ...S.btnPrimary, width: "100%" }}>Save</button>
          </div>
        </div>
      )}

      {deleteModalOpen && (
        <DeleteModal
          title="Delete Activity"
          itemName={`${selectedActivity.activityName} — ${selectedActivity.accountName}`}
          onConfirm={confirmDeleteActivity}
          onCancel={() => setDeleteModalOpen(false)}
        />
      )}

      {actionDeleteModal && (
        <DeleteModal
          title="Delete Action"
          itemName={`${actionDeleteModal.action.title} - ${actionDeleteModal.action.date}${actionDeleteModal.action.time ? ` at ${actionDeleteModal.action.time}` : ""}`}
          onConfirm={confirmDeleteAction}
          onCancel={() => setActionDeleteModal(null)}
        />
      )}
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", background: "#f8fafc", fontFamily: "'DM Sans','Segoe UI',sans-serif", color: "#0f172a" },
  loadingPage: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8fafc", fontFamily: "'DM Sans','Segoe UI',sans-serif" },
  content: { padding: "20px 24px 40px", display: "grid", gap: 18 },
  notFoundCard: { margin: "32px 24px", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 16, padding: 28, display: "grid", gap: 16, boxShadow: "0 6px 24px rgba(15,23,42,0.05)" },
  breadcrumbRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" },
  breadcrumbs: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  breadcrumbBtn: { border: "none", background: "transparent", color: "#2563eb", fontSize: 13, fontWeight: 700, cursor: "pointer", padding: 0 },
  breadcrumbSlash: { color: "#94a3b8", fontSize: 13 },
  breadcrumbCurrent: { color: "#334155", fontSize: 13, fontWeight: 700 },
  breadcrumbActions: { display: "flex", gap: 10, flexWrap: "wrap" },
  btnPrimary: { padding: "10px 16px", background: "#0f172a", color: "#fff", border: "none", borderRadius: 12, fontSize: 13, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", boxShadow: "0 10px 22px rgba(15,23,42,0.16)" },
  btnOutline: { padding: "10px 14px", background: "#fff", color: "#0f172a", border: "1px solid #d7dee8", borderRadius: 12, fontSize: 13, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", boxShadow: "0 1px 2px rgba(15,23,42,0.04)" },
  deleteActionBtn: { padding: "10px 14px", background: "#fff", color: "#dc2626", border: "1px solid #fecaca", borderRadius: 12, fontSize: 13, fontWeight: 700, cursor: "pointer" },
  summaryCard: { background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 16, padding: 20, boxShadow: "0 6px 24px rgba(15,23,42,0.05)" },
  editCard: { background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 16, padding: 20, boxShadow: "0 6px 24px rgba(15,23,42,0.05)" },
  workspaceCard: { background: "#ffffff", border: "1px solid #d7e2f0", borderRadius: 16, padding: 20, boxShadow: "0 8px 28px rgba(15,23,42,0.06)" },
  cardTitle: { margin: "0 0 16px 0", fontSize: 18, fontWeight: 800, color: "#0f172a" },
  summaryGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "16px 20px" },
  detailItem: { display: "flex", flexDirection: "column", gap: 4 },
  detailLabel: { fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: "#64748b" },
  detailValue: { fontSize: 14, color: "#0f172a", lineHeight: 1.45, whiteSpace: "pre-wrap", wordBreak: "break-word" },
  formGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "16px 20px", paddingBottom: 20 },
  formField: { display: "flex", flexDirection: "column" },
  fLabel: { fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 5 },
  fInput: { padding: "9px 12px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 13, background: "#f8fafc", outline: "none", color: "#0f172a", width: "100%", boxSizing: "border-box" },
  quickBtn: { padding: "8px 20px", borderRadius: 9999, border: "1px solid #3b82f6", background: "#fff", color: "#3b82f6", fontSize: 14, fontWeight: 600, cursor: "pointer" },
  dealCard: { marginBottom: 20, padding: "18px 18px 14px", background: "#ffffff", borderRadius: 14, border: "1px solid #dbe4f0", boxShadow: "0 4px 14px rgba(15,23,42,0.05)" },
  dealTop: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 },
  dealAmount: { fontSize: 20, fontWeight: 800, color: "#0f172a", lineHeight: 1.1 },
  lostBtn: { padding: "8px 16px", background: "#fff1f2", color: "#be123c", border: "1px solid #fecdd3", borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: "pointer" },
  pipelineRow: { display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4, marginBottom: 18 },
  dealGrid: { display: "grid", gridTemplateColumns: "minmax(0, 1.65fr) minmax(260px, 0.95fr)", gap: 18, alignItems: "start" },
  dealFooterActions: { marginTop: 18, paddingTop: 14, borderTop: "1px solid #e2e8f0", display: "flex", gap: 10 },
  toggleRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, fontSize: 13, fontWeight: 700, color: "#334155" },
  pipelineValueCard: { padding: "12px 14px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10 },
  pipelineValueLabel: { fontSize: 12, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 },
  pipelineValueAmount: { fontSize: 18, fontWeight: 800, color: "#0f172a" },
  insertItemsBtn: { width: "100%", marginTop: 10, padding: "10px 16px", background: "#ffffff", color: "#2563eb", border: "1.5px dashed #93c5fd", borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: "pointer" },
  inlineActionCard: { background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 12, padding: 20, marginBottom: 20 },
  emptyTimeline: { border: "1px dashed #cbd5e1", borderRadius: 14, padding: "22px 18px", color: "#94a3b8", fontSize: 14, background: "#fbfdff" },
  timelineEntry: { display: "flex", gap: 14, alignItems: "flex-start" },
  timelineDot: { width: 12, height: 12, borderRadius: "50%", background: "#93c5fd", marginTop: 14, boxShadow: "0 0 0 4px #dbeafe" },
  timelineBody: { flex: 1, background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 12, padding: "12px 14px", boxShadow: "0 2px 6px rgba(0,0,0,0.05)" },
  timelineAmountPill: { display: "inline-flex", alignItems: "center", maxWidth: "100%", padding: "4px 10px", borderRadius: 9999, background: "#eff6ff", color: "#1d4ed8", fontSize: 11, fontWeight: 700, overflowWrap: "anywhere", wordBreak: "break-word", whiteSpace: "normal" },
  modalBackdrop: { position: "fixed", inset: 0, background: "rgba(15,23,42,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10000 },
  modalCard: { background: "#ffffff", borderRadius: 16, width: "100%", maxWidth: 380, boxShadow: "0 20px 60px rgba(0,0,0,0.25)", padding: 24 },
  modalHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  modalCloseBtn: { background: "none", border: "none", fontSize: 24, cursor: "pointer", color: "#64748b" },
};
