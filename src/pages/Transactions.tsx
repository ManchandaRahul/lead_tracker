import React, { useEffect, useState, Fragment } from "react";
import { db } from "../firebase/config";
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc } from "firebase/firestore";
import { logActivity } from "../firebase/activityLog";
import { signOut } from "firebase/auth";
import { auth } from "../firebase/config";
import * as XLSX from "xlsx";
import DeleteModal from "../components/DeleteModal";
import AppPageHeader from "../components/AppPageHeader";
import { Page } from "../navigation";

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

function generateActivityId() {
  const d = new Date();
  return `ACT_${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"00")}${String(d.getDate()).padStart(2,"00")}_${Math.floor(Math.random()*9000+1000)}`;
}

function generateTimelineId() {
  return `TL_${Date.now()}_${Math.floor(Math.random() * 9000 + 1000)}`;
}

const DEAL_PIPELINE_STAGES = [
  { id: "10", label: "Qualified", percent: "10%" },
  { id: "20", label: "Meeting ar...", percent: "20%" },
  { id: "40", label: "Needs defi...", percent: "40%" },
  { id: "60", label: "Proposal s...", percent: "60%" },
  { id: "80", label: "Negotiation", percent: "80%" },
  { id: "100", label: "Won", percent: "100%" },
];

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

export default function Transactions({ onNavigate, routeLeadId }: { onNavigate: (p: Page, leadId?: string) => void; routeLeadId?: string | null }) {
  const user    = JSON.parse(localStorage.getItem("leadUser")!);
  const isAdmin = user.role === "admin";
  const logout  = () => { signOut(auth); localStorage.removeItem("leadUser"); window.location.reload(); };

  const [activities, setActivities] = useState<Activity[]>([]);
  const [leads, setLeads]           = useState<Lead[]>([]);
  const [loading, setLoading]       = useState(true);
  const [showForm, setShowForm]     = useState(false);
  const [actionActivityId, setActionActivityId] = useState<string | null>(null);
  const [formData, setFormData]     = useState({ ...EMPTY_ACTIVITY });
  const [editingId, setEditingId]   = useState<string | null>(null);
  const [search, setSearch]         = useState("");
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

  const [showLostModal, setShowLostModal] = useState(false);
  const [selectedLostReason, setSelectedLostReason] = useState("");
  const [actionDeleteModal, setActionDeleteModal] = useState<{ index: number; action: any } | null>(null);
  const [deletedActionLogs, setDeletedActionLogs] = useState<
    { action: any; reason: string; deletedAt: string }[]
  >([]);

  // Inline Action States
  const [activeAction, setActiveAction] = useState<"Note" | "Call" | "Meeting" | null>(null);
  const [actionTime, setActionTime] = useState("11:31");
  const [meetingPlace, setMeetingPlace] = useState("");
  const [actionDescription, setActionDescription] = useState("");
  const [actionDate, setActionDate] = useState(new Date().toISOString().slice(0, 10));
  const [timelineFilter, setTimelineFilter] = useState<"all" | TimelineCategory>("all");

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

  const selectedLead = routeLeadId ? leads.find((lead) => lead.leadId === routeLeadId) || null : null;
  const isLeadWorkspace = !!routeLeadId;
  const scopedActivities = routeLeadId ? activities.filter((activity) => activity.leadId === routeLeadId) : activities;

  const buildEmptyActivity = () => ({
    ...EMPTY_ACTIVITY,
    leadId: routeLeadId || "",
    accountName: selectedLead?.accountName || "",
  });

  const handleLeadSelect = (leadId: string) => {
    const lead = leads.find(l => l.leadId === leadId);
    setFormData(f => ({ ...f, leadId, accountName: lead?.accountName || "" }));
  };

  const buildActivityDraft = (activity: Activity) => ({
    ...EMPTY_ACTIVITY,
    ...activity,
    dealItems: Array.isArray((activity as any).dealItems) && (activity as any).dealItems.length > 0
      ? (activity as any).dealItems
      : [createEmptyDealItem()],
  });

  const normalizeTimelineEntries = (entries: any[] = []): TimelineEntry[] =>
    entries.map((entry, index) => {
      const category = (entry.category || entry.type?.toLowerCase?.() || "update") as TimelineCategory;
      const createdAt = entry.createdAt || entry.timestamp || new Date().toISOString();
      return {
        id: entry.id || `${createdAt}_${index}`,
        category,
        title: entry.title || entry.type || TIMELINE_META[category]?.label || "Update",
        description: entry.description || "",
        date: entry.date || createdAt.slice(0, 10),
        time: entry.time || "",
        place: entry.place || "",
        createdAt,
        createdBy: entry.createdBy || entry.actionBy || "",
      };
    });

  const createTimelineEntry = (
    category: TimelineCategory,
    title: string,
    description: string,
    overrides: Partial<TimelineEntry> = {}
  ): TimelineEntry => ({
    id: generateTimelineId(),
    category,
    title,
    description,
    date: overrides.date || new Date().toISOString().slice(0, 10),
    time: overrides.time || "",
    place: overrides.place || "",
    createdAt: overrides.createdAt || new Date().toISOString(),
    createdBy: overrides.createdBy || user.username,
  });

  const getEffectiveAmountFromActivity = (activity: Partial<Activity>) => {
    const rawAmount = parseFloat(String(activity.dealValue || "0")) || 0;
    const rawMonths = parseFloat(String(activity.dealDurationMonths || "0")) || 0;
    return activity.isMultiMonth ? rawAmount * Math.max(rawMonths, 1) : rawAmount;
  };

  const getStageLabel = (probability?: string) => {
    const match = DEAL_PIPELINE_STAGES.find(stage => stage.id === (probability || "10"));
    return match ? `${match.percent} ${match.label}` : `${probability || "0"}%`;
  };

  const getDealTimelineEntries = (previousActivity: Activity | null, nextActivity: typeof EMPTY_ACTIVITY) => {
    const entries: TimelineEntry[] = [];

    if (!previousActivity && nextActivity.isDeal) {
      entries.push(
        createTimelineEntry(
          "deal",
          "Deal Created",
          `Deal "${nextActivity.dealName || nextActivity.activityName}" was created at ${nextActivity.dealCurrency} ${getEffectiveAmountFromActivity(nextActivity).toLocaleString("en-IN")} in ${getStageLabel(nextActivity.probability)}.`
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
          "deal",
          "Deal Added",
          `Deal was added to this activity at ${nextActivity.dealCurrency} ${getEffectiveAmountFromActivity(nextActivity).toLocaleString("en-IN")}.`
        )
      );
      return entries;
    }

    if (wasDeal && !isDeal) {
      entries.push(createTimelineEntry("deal", "Deal Removed", "Deal tracking was removed from this activity."));
      return entries;
    }

    if (!wasDeal || !isDeal) return entries;

    if ((previousActivity.dealName || "") !== (nextActivity.dealName || "")) {
      entries.push(
        createTimelineEntry(
          "deal",
          "Deal Name Updated",
          `Deal name changed from "${previousActivity.dealName || "Untitled Deal"}" to "${nextActivity.dealName || "Untitled Deal"}".`
        )
      );
    }

    const previousAmount = getEffectiveAmountFromActivity(previousActivity);
    const nextAmount = getEffectiveAmountFromActivity(nextActivity);
    if (previousAmount !== nextAmount || (previousActivity.dealCurrency || "INR") !== (nextActivity.dealCurrency || "INR")) {
      entries.push(
        createTimelineEntry(
          "deal",
          "Deal Amount Updated",
          `Deal amount changed from ${(previousActivity.dealCurrency || "INR")} ${previousAmount.toLocaleString("en-IN")} to ${(nextActivity.dealCurrency || "INR")} ${nextAmount.toLocaleString("en-IN")}.`
        )
      );
    }

    if ((previousActivity.probability || "10") !== (nextActivity.probability || "10")) {
      entries.push(
        createTimelineEntry(
          "deal",
          "Deal Stage Updated",
          `Deal stage changed from ${getStageLabel(previousActivity.probability)} to ${getStageLabel(nextActivity.probability)}.`
        )
      );
    }

    if (!!previousActivity.isMultiMonth !== !!nextActivity.isMultiMonth) {
      entries.push(
        createTimelineEntry(
          "deal",
          "Multi-month Updated",
          `Multi-month was turned ${nextActivity.isMultiMonth ? "on" : "off"}.`
        )
      );
    }

    if (!!previousActivity.hasCommission !== !!nextActivity.hasCommission) {
      entries.push(
        createTimelineEntry(
          "deal",
          "Commission Updated",
          `Commission was turned ${nextActivity.hasCommission ? "on" : "off"}.`
        )
      );
    }

    if (
      nextActivity.hasCommission &&
      (previousActivity.commissionPercent || "0") !== (nextActivity.commissionPercent || "0")
    ) {
      entries.push(
        createTimelineEntry(
          "deal",
          "Commission Percentage Updated",
          `Commission changed from ${previousActivity.commissionPercent || "0"}% to ${nextActivity.commissionPercent || "0"}%.`
        )
      );
    }

    if (!!previousActivity.hasCost !== !!nextActivity.hasCost) {
      entries.push(
        createTimelineEntry(
          "deal",
          "Cost Tracking Updated",
          `Cost tracking was turned ${nextActivity.hasCost ? "on" : "off"}.`
        )
      );
    }

    if ((previousActivity.dueDate || "") !== (nextActivity.dueDate || "")) {
      entries.push(
        createTimelineEntry(
          "deal",
          "Expected Close Date Updated",
          `Expected close date changed from ${previousActivity.dueDate || "not set"} to ${nextActivity.dueDate || "not set"}.`
        )
      );
    }

    if ((previousActivity.wonDate || "") !== (nextActivity.wonDate || "") && nextActivity.wonDate) {
      entries.push(
        createTimelineEntry(
          "deal",
          "Deal Won Date Updated",
          `Won date changed to ${nextActivity.wonDate}${nextActivity.wonTime ? ` at ${nextActivity.wonTime}` : ""}.`
        )
      );
    }

    if (JSON.stringify(previousActivity.dealItems || []) !== JSON.stringify(nextActivity.dealItems || [])) {
      entries.push(createTimelineEntry("deal", "Deal Items Updated", "Deal items were updated."));
    }

    return entries;
  };

  const filtered = scopedActivities
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
    const previousActivity = editingId ? (activities.find(activity => activity.id === editingId) || null) : null;
    if (editingId) {
      await persistExistingActivity(editingId, formData, previousActivity, deletedActionLogs);
    } else {
      const basePayload = {
        ...formData,
        actions: normalizeTimelineEntries(formData.actions || []),
        transactionId: formData.transactionId || generateActivityId(),
        activityDate: formData.activityDate || new Date().toISOString().slice(0, 10),
        updatedAt: new Date().toISOString(),
      };
      const dealTimelineEntries = getDealTimelineEntries(previousActivity, basePayload);
      const payload = {
        ...basePayload,
        actions: [...basePayload.actions, ...dealTimelineEntries],
      };
      await addDoc(collection(db, "transactions"), { ...payload, createdAt: new Date().toISOString() });
      await logActivity(payload.transactionId, payload.accountName, "transactions", {
        actionType: "TXN_ADDED",
        description: `New activity "${payload.activityName}" added for "${payload.accountName}"`,
        actionBy: user.username, timestamp: new Date().toISOString(),
      });
      for (const dealEntry of dealTimelineEntries) {
        await logActivity(payload.transactionId, payload.accountName, "transactions", {
          actionType: "TXN_ADDED",
          description: dealEntry.description,
          actionBy: user.username,
          timestamp: dealEntry.createdAt,
        });
      }
    }
    resetForm();
  };

  const persistExistingActivity = async (
    activityId: string,
    sourceData: typeof EMPTY_ACTIVITY,
    previousActivity: Activity | null,
    deletedActionsToLog: { action: any; reason: string; deletedAt: string }[] = []
  ) => {
    const basePayload = {
      ...sourceData,
      actions: normalizeTimelineEntries(sourceData.actions || []),
      transactionId: sourceData.transactionId || generateActivityId(),
      activityDate: sourceData.activityDate || new Date().toISOString().slice(0, 10),
      updatedAt: new Date().toISOString(),
    };
    const dealTimelineEntries = getDealTimelineEntries(previousActivity, basePayload);
    const payload = {
      ...basePayload,
      actions: [...basePayload.actions, ...dealTimelineEntries],
    };

    await updateDoc(doc(db, "transactions", activityId), payload);
    await logActivity(payload.transactionId, payload.accountName, "transactions", {
      actionType: "TXN_EDITED",
      description: `Activity "${payload.activityName}" for "${payload.accountName}" was edited`,
      actionBy: user.username, timestamp: new Date().toISOString(),
    });
    for (const dealEntry of dealTimelineEntries) {
      await logActivity(payload.transactionId, payload.accountName, "transactions", {
        actionType: "TXN_EDITED",
        description: dealEntry.description,
        actionBy: user.username,
        timestamp: dealEntry.createdAt,
      });
    }
    for (const deletedAction of deletedActionsToLog) {
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

    return payload;
  };

  const resetForm = () => { 
    setFormData(buildEmptyActivity()); 
    setEditingId(null); 
    setShowForm(false); 
    setActionActivityId(null);
    setShowLostModal(false);
    setSelectedLostReason("");
    setActionDeleteModal(null);
    setDeletedActionLogs([]);
    setActiveAction(null);           // Close any open action section
    setActionDescription("");
    setMeetingPlace("");
    setTimelineFilter("all");
  };

  const startEdit = (a: Activity) => {
    setActionActivityId(null);
    setFormData(buildActivityDraft(a)); 
    setActionDeleteModal(null);
    setDeletedActionLogs([]);
    setEditingId(a.id); 
    setShowForm(true);
    setTimelineFilter("all");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const deleteActivity = (a: Activity) => setDeleteModal({ activity: a });

  const openActivityActions = (a: Activity) => {
    if (actionActivityId === a.id) {
      resetForm();
      return;
    }
    setShowForm(false);
    setEditingId(null);
    setActionActivityId(a.id);
    setFormData(buildActivityDraft(a));
    setActionDeleteModal(null);
    setDeletedActionLogs([]);
    setActiveAction(null);
    setActionDescription("");
    setMeetingPlace("");
    setTimelineFilter("all");
  };

  const saveActivityActions = async () => {
    if (!actionActivityId) return;
    const previousActivity = activities.find(activity => activity.id === actionActivityId) || null;
    const payload = await persistExistingActivity(actionActivityId, formData, previousActivity, deletedActionLogs);
    setFormData(prev => ({ ...prev, ...payload }));
    setDeletedActionLogs([]);
    setActiveAction(null);
    setActionDescription("");
    setMeetingPlace("");
  };

  const confirmDeleteAction = (reason: string) => {
    if (!actionDeleteModal) return;
    const updated = [...(formData.actions || [])];
    updated.splice(actionDeleteModal.index, 1);
    setFormData(prev => ({ ...prev, actions: updated }));
    setDeletedActionLogs(prev => [
      ...prev,
      {
        action: actionDeleteModal.action,
        reason,
        deletedAt: new Date().toISOString(),
      },
    ]);
    setActionDeleteModal(null);
  };

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

  const handleSaveLostReason = () => {
    if (!selectedLostReason) return;
    const reasonText = `Deal marked as lost. Reason: ${selectedLostReason}`;
    setFormData(prev => ({
      ...prev,
      probability: "0",
      actions: [
        ...normalizeTimelineEntries(prev.actions || []),
        createTimelineEntry("deal", "Deal Lost", reasonText)
      ],
    }));
    setShowLostModal(false);
    setSelectedLostReason("");
  };

  // Open inline action section
  const openAction = (type: "Note" | "Call" | "Meeting") => {
    setActiveAction(type);
    setActionDescription("");
    setMeetingPlace("");
  };

  const toggleDealMode = () => {
    setFormData(prev => ({
      ...prev,
      isDeal: !prev.isDeal,
      probability: prev.isDeal ? "" : prev.probability || "10",
      dealItems: prev.dealItems && prev.dealItems.length > 0 ? prev.dealItems : [createEmptyDealItem()],
    }));
  };

  const updateDealItem = (index: number, field: keyof DealItem, value: string) => {
    setFormData(prev => ({
      ...prev,
      dealItems: (prev.dealItems || [createEmptyDealItem()]).map((item: DealItem, itemIndex: number) =>
        itemIndex === index ? { ...item, [field]: value } : item
      ),
    }));
  };

  const addDealItemRow = () => {
    setFormData(prev => ({
      ...prev,
      dealItems: [...(prev.dealItems || []), createEmptyDealItem()],
    }));
  };

  const removeDealItemRow = (index: number) => {
    setFormData(prev => {
      const nextItems = (prev.dealItems || []).filter((_: DealItem, itemIndex: number) => itemIndex !== index);
      return {
        ...prev,
        dealItems: nextItems.length > 0 ? nextItems : [createEmptyDealItem()],
      };
    });
  };

  const monthlyAmount = parseFloat(formData.dealValue || "0") || 0;
  const durationMonths = parseFloat(formData.dealDurationMonths || "0") || 0;
  const effectiveDealAmount = formData.isMultiMonth ? monthlyAmount * Math.max(durationMonths, 1) : monthlyAmount;
  const weightedDealAmount = effectiveDealAmount * ((parseFloat(formData.probability || "0") || 0) / 100);
  const commissionValue = effectiveDealAmount * ((parseFloat(formData.commissionPercent || "0") || 0) / 100);
  const dealItemTemplateColumns = [
    "1.15fr",
    "1.55fr",
    formData.hasCost ? "0.7fr" : null,
    "0.7fr",
    "48px",
  ]
    .filter(Boolean)
    .join(" ");


  // Save inline action as structured record
  const saveAction = () => {
    if (!activeAction) return;

    const category = activeAction.toLowerCase() as TimelineCategory;
    const newAction = createTimelineEntry(
      category,
      activeAction,
      actionDescription || "",
      {
        date: actionDate,
        time: actionTime,
        place: meetingPlace || "",
      }
    );

    setFormData(prev => ({
      ...prev,
      actions: [...normalizeTimelineEntries(prev.actions || []), newAction],
    }));

    setActiveAction(null);
    setActionDescription("");
    setMeetingPlace("");
  };

  const timelineEntries = normalizeTimelineEntries(formData.actions || []).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  const filteredTimelineEntries = timelineFilter === "all"
    ? timelineEntries
    : timelineEntries.filter(entry => entry.category === timelineFilter);

  const ActivityActionPanel = ({ activity }: { activity: Activity }) => {
    const [draft, setDraft] = useState(buildActivityDraft(activity));
    const [rowActiveAction, setRowActiveAction] = useState<"Note" | "Call" | "Meeting" | null>(null);
    const [rowActionTime, setRowActionTime] = useState("11:31");
    const [rowMeetingPlace, setRowMeetingPlace] = useState("");
    const [rowActionDescription, setRowActionDescription] = useState("");
    const [rowActionDate, setRowActionDate] = useState(new Date().toISOString().slice(0, 10));
    const [rowTimelineFilter, setRowTimelineFilter] = useState<"all" | TimelineCategory>("all");
    const [rowLostModal, setRowLostModal] = useState(false);
    const [rowLostReason, setRowLostReason] = useState("");
    const [rowActionDeleteModal, setRowActionDeleteModal] = useState<{ index: number; action: TimelineEntry } | null>(null);
    const [rowDeletedActionLogs, setRowDeletedActionLogs] = useState<{ action: any; reason: string; deletedAt: string }[]>([]);

    useEffect(() => {
      setDraft(buildActivityDraft(activity));
      setRowDeletedActionLogs([]);
      setRowActiveAction(null);
      setRowActionDescription("");
      setRowMeetingPlace("");
      setRowTimelineFilter("all");
    }, [activity]);

    const rowMonthlyAmount = parseFloat(draft.dealValue || "0") || 0;
    const rowDurationMonths = parseFloat(draft.dealDurationMonths || "0") || 0;
    const rowEffectiveDealAmount = draft.isMultiMonth ? rowMonthlyAmount * Math.max(rowDurationMonths, 1) : rowMonthlyAmount;
    const rowCommissionValue = rowEffectiveDealAmount * ((parseFloat(draft.commissionPercent || "0") || 0) / 100);
    const rowDealItemTemplateColumns = [
      "1.15fr",
      "1.55fr",
      draft.hasCost ? "0.7fr" : null,
      "0.7fr",
      "48px",
    ].filter(Boolean).join(" ");

    const rowTimelineEntries = normalizeTimelineEntries(draft.actions || []).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    const rowFilteredTimelineEntries = rowTimelineFilter === "all"
      ? rowTimelineEntries
      : rowTimelineEntries.filter(entry => entry.category === rowTimelineFilter);

    const toggleRowDealMode = () => {
      setDraft(prev => ({
        ...prev,
        isDeal: !prev.isDeal,
        probability: prev.isDeal ? "" : prev.probability || "10",
        dealItems: prev.dealItems && prev.dealItems.length > 0 ? prev.dealItems : [createEmptyDealItem()],
      }));
    };

    const updateRowDealItem = (index: number, field: keyof DealItem, value: string) => {
      setDraft(prev => ({
        ...prev,
        dealItems: (prev.dealItems || [createEmptyDealItem()]).map((item: DealItem, itemIndex: number) =>
          itemIndex === index ? { ...item, [field]: value } : item
        ),
      }));
    };

    const addRowDealItem = () => {
      setDraft(prev => ({
        ...prev,
        dealItems: [...(prev.dealItems || []), createEmptyDealItem()],
      }));
    };

    const removeRowDealItem = (index: number) => {
      setDraft(prev => {
        const nextItems = (prev.dealItems || []).filter((_: DealItem, itemIndex: number) => itemIndex !== index);
        return {
          ...prev,
          dealItems: nextItems.length > 0 ? nextItems : [createEmptyDealItem()],
        };
      });
    };

    const openRowAction = (type: "Note" | "Call" | "Meeting") => {
      setRowActiveAction(type);
      setRowActionDescription("");
      setRowMeetingPlace("");
    };

    const saveRowAction = () => {
      if (!rowActiveAction) return;
      const category = rowActiveAction.toLowerCase() as TimelineCategory;
      const newAction = createTimelineEntry(category, rowActiveAction, rowActionDescription || "", {
        date: rowActionDate,
        time: rowActionTime,
        place: rowMeetingPlace || "",
      });
      setDraft(prev => ({
        ...prev,
        actions: [...normalizeTimelineEntries(prev.actions || []), newAction],
      }));
      setRowActiveAction(null);
      setRowActionDescription("");
      setRowMeetingPlace("");
    };

    const saveRowLostReason = () => {
      if (!rowLostReason) return;
      const reasonText = `Deal marked as lost. Reason: ${rowLostReason}`;
      setDraft(prev => ({
        ...prev,
        probability: "0",
        actions: [...normalizeTimelineEntries(prev.actions || []), createTimelineEntry("deal", "Deal Lost", reasonText)],
      }));
      setRowLostModal(false);
      setRowLostReason("");
    };

    const confirmDeleteRowAction = (reason: string) => {
      if (!rowActionDeleteModal) return;
      const nextActions = normalizeTimelineEntries(draft.actions || []).filter((_, index) => index !== rowActionDeleteModal.index);
      setDraft(prev => ({ ...prev, actions: nextActions }));
      setRowDeletedActionLogs(prev => [
        ...prev,
        {
          action: rowActionDeleteModal.action,
          reason,
          deletedAt: new Date().toISOString(),
        },
      ]);
      setRowActionDeleteModal(null);
    };

    const saveRowActions = async () => {
      const previousActivity = activities.find(item => item.id === activity.id) || null;
      const payload = await persistExistingActivity(activity.id, draft, previousActivity, rowDeletedActionLogs);
      setDraft(buildActivityDraft({ ...(previousActivity || activity), ...payload, id: activity.id } as Activity));
      setRowDeletedActionLogs([]);
      setRowActiveAction(null);
      setRowActionDescription("");
      setRowMeetingPlace("");
    };

    return (
      <div style={S.rowActionPanel}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Actions</h3>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
          <button
            type="button"
            onClick={toggleRowDealMode}
            style={{
              padding: "8px 20px",
              borderRadius: 9999,
              border: draft.isDeal ? "1px solid #be185d" : "1px solid #cbd5e1",
              background: draft.isDeal ? "#e11d48" : "#fff",
              color: draft.isDeal ? "#fff" : "#334155",
              fontSize: 14,
              fontWeight: 700,
              cursor: "pointer"
            }}
          >
            {draft.isDeal ? "Deal On" : "+ Deal"}
          </button>
          <button type="button" onClick={() => openRowAction("Note")} style={{ padding: "8px 20px", borderRadius: 9999, border: "1px solid #3b82f6", background: "#fff", color: "#3b82f6", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>+ Note</button>
          <button type="button" onClick={() => openRowAction("Call")} style={{ padding: "8px 20px", borderRadius: 9999, border: "1px solid #3b82f6", background: "#fff", color: "#3b82f6", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>+ Call</button>
          <button type="button" onClick={() => openRowAction("Meeting")} style={{ padding: "8px 20px", borderRadius: 9999, border: "1px solid #3b82f6", background: "#fff", color: "#3b82f6", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>+ Meeting</button>
        </div>

        {draft.isDeal && (
          <div style={{ marginBottom: 20, padding: "18px 18px 14px", background: "#ffffff", borderRadius: 14, border: "1px solid #dbe4f0", boxShadow: "0 4px 14px rgba(15,23,42,0.05)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontSize: 20, fontWeight: 800, color: "#0f172a", lineHeight: 1.1 }}>
                  {draft.dealCurrency} {rowEffectiveDealAmount.toLocaleString("en-IN")}
                </span>
                <span style={{ fontSize: 13, color: "#94a3b8" }}>•</span>
                <span style={{ fontSize: 13, color: "#475569" }}>
                  There&apos;s a {draft.probability || "10"}% chance it will close on{" "}
                  <span style={{ color: "#2563eb", fontWeight: 700 }}>{draft.dueDate || "Select date"}</span>
                </span>
              </div>
              <button type="button" onClick={() => setRowLostModal(true)} style={{ padding: "8px 16px", background: "#fff1f2", color: "#be123c", border: "1px solid #fecdd3", borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                Lost
              </button>
            </div>

            <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4, marginBottom: 18 }}>
              {DEAL_PIPELINE_STAGES.map((stage, index) => {
                const isActive = draft.probability === stage.id || (!draft.probability && stage.id === "10");
                return (
                  <Fragment key={stage.id}>
                    <button
                      type="button"
                      onClick={() => setDraft({ ...draft, probability: stage.id })}
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
                        whiteSpace: "nowrap"
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

            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.65fr) minmax(260px, 0.95fr)", gap: 18, alignItems: "start" }}>
              <div>
                <div style={{ marginBottom: 18 }}>
                  <label style={S.fLabel}>Deal name</label>
                  <input style={S.fInput} value={draft.dealName || ""} onChange={e => setDraft({ ...draft, dealName: e.target.value })} placeholder="Enter deal name" />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: draft.isMultiMonth ? "minmax(0,1fr) 20px 110px" : "minmax(0,1fr)", gap: 10, alignItems: "end", marginBottom: 16 }}>
                  <div>
                    <label style={S.fLabel}>{draft.isMultiMonth ? "Monthly amount" : "Amount"}</label>
                    <div style={{ display: "flex", gap: 8 }}>
                      <select value={draft.dealCurrency} onChange={e => setDraft({ ...draft, dealCurrency: e.target.value })} style={{ ...S.fInput, width: 98 }}>
                        {CURRENCIES.map(c => <option key={c}>{c}</option>)}
                      </select>
                      <input type="number" placeholder="0" value={draft.dealValue || ""} onChange={e => setDraft({ ...draft, dealValue: e.target.value })} style={S.fInput} />
                    </div>
                  </div>
                  {draft.isMultiMonth && (
                    <>
                      <div style={{ textAlign: "center", fontSize: 22, color: "#94a3b8", paddingBottom: 8 }}>x</div>
                      <div>
                        <label style={S.fLabel}>Months</label>
                        <input type="number" min="1" value={draft.dealDurationMonths || "12"} onChange={e => setDraft({ ...draft, dealDurationMonths: e.target.value })} style={S.fInput} />
                      </div>
                    </>
                  )}
                </div>

                {draft.hasCommission && (
                  <div style={{ marginBottom: 18 }}>
                    <label style={S.fLabel}>Commission %</label>
                    <div style={{ display: "grid", gridTemplateColumns: "110px 40px 1fr", gap: 10, alignItems: "center" }}>
                      <input type="number" min="0" value={draft.commissionPercent || "10"} onChange={e => setDraft({ ...draft, commissionPercent: e.target.value })} style={S.fInput} />
                      <div style={{ ...S.fInput, display: "flex", justifyContent: "center", alignItems: "center", padding: "9px 0" }}>%</div>
                      <div style={{ fontSize: 12, color: "#475569" }}>
                        Value <strong>{draft.dealCurrency} {rowCommissionValue.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</strong> based on amount
                      </div>
                    </div>
                  </div>
                )}

                <div style={{ marginBottom: 18 }}>
                  <label style={S.fLabel}>Deal Items ({(draft.dealItems || []).length})</label>
                  <div style={{ border: "1px solid #dbe4f0", borderRadius: 12, overflow: "hidden", background: "#ffffff" }}>
                    <div style={{ display: "grid", gridTemplateColumns: rowDealItemTemplateColumns, gap: 0, background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                      {["Item Name", "Description", ...(draft.hasCost ? ["Cost"] : []), "Price", ""].map((label, index) => (
                        <div key={`${label}-${index}`} style={{ padding: "10px 12px", fontSize: 11, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
                      ))}
                    </div>
                    {(draft.dealItems || []).map((item: DealItem, index: number) => (
                      <div key={index} style={{ display: "grid", gridTemplateColumns: rowDealItemTemplateColumns, borderBottom: index === (draft.dealItems || []).length - 1 ? "none" : "1px solid #eef2f7" }}>
                        <input value={item.itemName} onChange={e => updateRowDealItem(index, "itemName", e.target.value)} style={{ ...S.fInput, border: "none", borderRadius: 0, background: "#fff", padding: "12px", fontSize: 12 }} placeholder="Enter item name" />
                        <input value={item.description} onChange={e => updateRowDealItem(index, "description", e.target.value)} style={{ ...S.fInput, border: "none", borderRadius: 0, background: "#fff", padding: "12px", fontSize: 12 }} placeholder="Enter description" />
                        {draft.hasCost && <input type="number" value={item.cost} onChange={e => updateRowDealItem(index, "cost", e.target.value)} style={{ ...S.fInput, border: "none", borderRadius: 0, background: "#fff", padding: "12px", fontSize: 12 }} placeholder="0" />}
                        <input type="number" value={item.price} onChange={e => updateRowDealItem(index, "price", e.target.value)} style={{ ...S.fInput, border: "none", borderRadius: 0, background: "#fff", padding: "12px", fontSize: 12 }} placeholder="0" />
                        <button type="button" onClick={() => removeRowDealItem(index)} style={{ border: "none", background: "#fff", color: "#ef4444", fontSize: 16, cursor: "pointer" }} aria-label={`Remove deal item ${index + 1}`}>×</button>
                      </div>
                    ))}
                  </div>
                  <button type="button" onClick={addRowDealItem} style={{ width: "100%", marginTop: 10, padding: "10px 16px", background: "#ffffff", color: "#2563eb", border: "1.5px dashed #93c5fd", borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
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
                  ].map(toggle => (
                    <label key={toggle.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, fontSize: 13, fontWeight: 700, color: "#334155" }}>
                      <span>{toggle.label}</span>
                      <button type="button" onClick={() => setDraft(prev => ({ ...prev, [toggle.key]: !(prev as any)[toggle.key] }))} style={{ width: 48, height: 28, borderRadius: 9999, border: "none", background: (draft as any)[toggle.key] ? "#84cc16" : "#cbd5e1", position: "relative", cursor: "pointer" }}>
                        <span style={{ position: "absolute", top: 3, left: (draft as any)[toggle.key] ? 23 : 3, width: 22, height: 22, borderRadius: "50%", background: "#fff", transition: "left 0.2s ease", boxShadow: "0 2px 6px rgba(15,23,42,0.15)" }} />
                      </button>
                    </label>
                  ))}
                </div>

                <div style={{ display: "grid", gap: 16 }}>
                  <div>
                    <label style={S.fLabel}>Expected close date</label>
                    <input type="date" value={draft.dueDate} onChange={e => setDraft({ ...draft, dueDate: e.target.value })} style={S.fInput} />
                  </div>
                  {draft.probability === "100" && (
                    <>
                      <div>
                        <label style={S.fLabel}>Won Date</label>
                        <input type="date" value={draft.wonDate} onChange={e => setDraft({ ...draft, wonDate: e.target.value })} style={S.fInput} />
                      </div>
                      <div>
                        <label style={S.fLabel}>Won Time</label>
                        <input type="time" value={draft.wonTime} onChange={e => setDraft({ ...draft, wonTime: e.target.value })} style={S.fInput} />
                      </div>
                    </>
                  )}
                  {draft.dealValue && parseFloat(draft.dealValue) > 0 && draft.probability && parseFloat(draft.probability) > 0 && (
                    <div style={{ padding: "12px 14px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>Pipeline Value</div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: "#0f172a" }}>
                        {draft.dealCurrency}{" "}
                        {(parseFloat(draft.dealValue) * (parseFloat(draft.probability) / 100)).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                      <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>Calculated as deal amount x close probability</div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {rowActiveAction && (
          <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 12, padding: 20, marginBottom: 20 }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: 16, fontWeight: 600 }}>Add {rowActiveAction}</h4>
            <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
              <input type="time" value={rowActionTime} onChange={e => setRowActionTime(e.target.value)} style={{ padding: "10px", border: "1px solid #e2e8f0", borderRadius: 8, width: 140 }} />
              {rowActiveAction === "Meeting" && <input type="text" placeholder="Meeting place" value={rowMeetingPlace} onChange={e => setRowMeetingPlace(e.target.value)} style={{ flex: 1, padding: "10px", border: "1px solid #e2e8f0", borderRadius: 8 }} />}
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: "#475569", marginBottom: 8, display: "block" }}>Description (Optional)</label>
              <textarea value={rowActionDescription} onChange={e => setRowActionDescription(e.target.value)} rows={4} style={{ width: "100%", padding: "12px", border: "1px solid #e2e8f0", borderRadius: 8, resize: "vertical" }} placeholder="Add details here..." />
            </div>
            <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
              <button type="button" onClick={() => setRowActiveAction(null)} style={{ padding: "10px 24px", border: "none", background: "transparent", color: "#64748b", fontWeight: 600 }}>Cancel</button>
              <button type="button" onClick={saveRowAction} style={{ padding: "10px 32px", background: "#f59e0b", color: "#fff", border: "none", borderRadius: 9999, fontWeight: 600 }}>Save {rowActiveAction}</button>
            </div>
          </div>
        )}

        <div style={{ marginTop: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
            <h4 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Timeline</h4>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {TIMELINE_FILTERS.map(filter => {
                const isActive = rowTimelineFilter === filter.key;
                return (
                  <button
                    key={filter.key}
                    type="button"
                    onClick={() => setRowTimelineFilter(filter.key)}
                    style={{
                      padding: "7px 14px",
                      borderRadius: 9999,
                      border: isActive ? "1px solid #bfdbfe" : "1px solid transparent",
                      background: isActive ? "#eff6ff" : "#f8fafc",
                      color: isActive ? "#2563eb" : "#64748b",
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: "pointer"
                    }}
                  >
                    {filter.label}
                  </button>
                );
              })}
            </div>
          </div>

          {rowFilteredTimelineEntries.length === 0 ? (
            <div style={{ padding: "18px 16px", border: "1px dashed #cbd5e1", borderRadius: 12, background: "#f8fafc", color: "#64748b", fontSize: 13 }}>
              No timeline entries yet for this filter.
            </div>
          ) : (
            <div style={{ position: "relative", paddingLeft: 28 }}>
              <div style={{ position: "absolute", left: 12, top: 4, bottom: 4, width: 2, background: "#e2e8f0", borderRadius: 2 }} />
              {rowFilteredTimelineEntries.map((entry, idx) => {
                const meta = TIMELINE_META[entry.category];
                const originalIndex = rowTimelineEntries.findIndex(item => item.id === entry.id);
                return (
                  <div key={entry.id} style={{ position: "relative", display: "flex", gap: 14, marginBottom: idx === rowFilteredTimelineEntries.length - 1 ? 0 : 18, alignItems: "flex-start" }}>
                    <div style={{ position: "absolute", left: 6, top: 10, width: 12, height: 12, borderRadius: "50%", background: meta.color, border: "2px solid #fff", boxShadow: `0 0 0 2px ${meta.color}22` }} />
                    <div style={{ marginLeft: 20, flex: 1, background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 12, padding: "12px 14px", boxShadow: "0 2px 6px rgba(0,0,0,0.05)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 6 }}>
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                            <span style={{ padding: "4px 10px", borderRadius: 9999, background: meta.bg, color: meta.color, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>{meta.label}</span>
                            <span style={{ fontSize: 12, color: "#64748b" }}>{entry.date}{entry.time ? ` at ${entry.time}` : ""}</span>
                          </div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a", marginBottom: entry.description ? 4 : 0 }}>{entry.title}</div>
                          {entry.place && <div style={{ fontSize: 12, color: "#64748b", marginBottom: entry.description ? 4 : 0 }}>Place: {entry.place}</div>}
                          {entry.description && <div style={{ fontSize: 13, color: "#334155", lineHeight: 1.45 }}>{entry.description}</div>}
                        </div>
                        <button type="button" onClick={() => setRowActionDeleteModal({ index: originalIndex, action: entry })} style={{ border: "none", background: "transparent", color: "#94a3b8", fontSize: 16, cursor: "pointer" }} aria-label={`Delete ${entry.title}`}>
                          x
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
          <button type="button" onClick={saveRowActions} style={S.btnPrimary}>Save Actions</button>
        </div>

        {rowLostModal && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10000 }}>
            <div style={{ background: "#ffffff", borderRadius: 16, width: "100%", maxWidth: 380, boxShadow: "0 20px 60px rgba(0,0,0,0.25)", padding: 24 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Reason Lost</h2>
                <button onClick={() => { setRowLostModal(false); setRowLostReason(""); }} style={{ background: "none", border: "none", fontSize: 24, cursor: "pointer", color: "#64748b" }}>✕</button>
              </div>
              <select value={rowLostReason} onChange={(e) => setRowLostReason(e.target.value)} style={{ width: "100%", padding: "12px 14px", borderRadius: 8, border: "2px solid #3b82f6", fontSize: 15, background: "#fff", outline: "none", marginBottom: 24 }}>
                <option value="">Please select ...</option>
                <option value="Wrong time">Wrong time</option>
                <option value="Price too high">Price too high</option>
                <option value="No authority">No authority</option>
                <option value="Competitor">Competitor</option>
              </select>
              <button onClick={saveRowLostReason} style={{ width: "100%", background: "#6b7280", color: "#fff", border: "none", padding: "14px", borderRadius: 9999, fontSize: 15, fontWeight: 600, cursor: "pointer" }}>Save</button>
            </div>
          </div>
        )}

        {rowActionDeleteModal && (
          <DeleteModal
            title="Delete Action"
            itemName={rowActionDeleteModal.action.title}
            onCancel={() => setRowActionDeleteModal(null)}
            onConfirm={confirmDeleteRowAction}
          />
        )}
      </div>
    );
  };

  const renderActionWorkspace = () => (
    <div style={S.rowActionPanel}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Actions</h3>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
        <button
          type="button"
          onClick={toggleDealMode}
          style={{
            padding: "8px 20px",
            borderRadius: 9999,
            border: formData.isDeal ? "1px solid #be185d" : "1px solid #cbd5e1",
            background: formData.isDeal ? "#e11d48" : "#fff",
            color: formData.isDeal ? "#fff" : "#334155",
            fontSize: 14,
            fontWeight: 700,
            cursor: "pointer"
          }}
        >
          {formData.isDeal ? "Deal On" : "+ Deal"}
        </button>
        <button
          type="button"
          onClick={() => openAction("Note")}
          style={{ padding: "8px 20px", borderRadius: 9999, border: "1px solid #3b82f6", background: "#fff", color: "#3b82f6", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
        >+ Note</button>
        <button
          type="button"
          onClick={() => openAction("Call")}
          style={{ padding: "8px 20px", borderRadius: 9999, border: "1px solid #3b82f6", background: "#fff", color: "#3b82f6", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
        >+ Call</button>
        <button
          type="button"
          onClick={() => openAction("Meeting")}
          style={{ padding: "8px 20px", borderRadius: 9999, border: "1px solid #3b82f6", background: "#fff", color: "#3b82f6", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
        >+ Meeting</button>
      </div>

      {formData.isDeal && (
        <div style={{ marginBottom: 20, padding: "18px 18px 14px", background: "#ffffff", borderRadius: 14, border: "1px solid #dbe4f0", boxShadow: "0 4px 14px rgba(15,23,42,0.05)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 20, fontWeight: 800, color: "#0f172a", lineHeight: 1.1 }}>
                {formData.dealCurrency} {effectiveDealAmount.toLocaleString("en-IN")}
              </span>
              <span style={{ fontSize: 13, color: "#94a3b8" }}>•</span>
              <span style={{ fontSize: 13, color: "#475569" }}>
                There&apos;s a {formData.probability || "10"}% chance it will close on{" "}
                <span style={{ color: "#2563eb", fontWeight: 700 }}>{formData.dueDate || "Select date"}</span>
              </span>
            </div>
            <button
              type="button"
              onClick={() => setShowLostModal(true)}
              style={{ padding: "8px 16px", background: "#fff1f2", color: "#be123c", border: "1px solid #fecdd3", borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: "pointer" }}
            >
              Lost
            </button>
          </div>

          <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4, marginBottom: 18 }}>
            {DEAL_PIPELINE_STAGES.map((stage, index) => {
              const isActive = formData.probability === stage.id || (!formData.probability && stage.id === "10");
              return (
                <Fragment key={stage.id}>
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, probability: stage.id })}
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
                      whiteSpace: "nowrap"
                    }}
                  >
                    <span>{stage.percent}</span>
                    <span style={{ opacity: isActive && stage.id !== "100" ? 0.7 : 0.5 }}>|</span>
                    <span>{stage.label}</span>
                  </button>
                  {index < DEAL_PIPELINE_STAGES.length - 1 && (
                    <span style={{ alignSelf: "center", color: "#cbd5e1", fontSize: 22 }}>›</span>
                  )}
                </Fragment>
              );
            })}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.65fr) minmax(260px, 0.95fr)", gap: 18, alignItems: "start" }}>
            <div>
              <div style={{ marginBottom: 18 }}>
                <label style={S.fLabel}>Deal name</label>
                <input
                  style={S.fInput}
                  value={formData.dealName || ""}
                  onChange={e => setFormData({ ...formData, dealName: e.target.value })}
                  placeholder="Enter deal name"
                />
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: formData.isMultiMonth ? "minmax(0,1fr) 20px 110px" : "minmax(0,1fr)",
                  gap: 10,
                  alignItems: "end",
                  marginBottom: 16
                }}
              >
                <div>
                  <label style={S.fLabel}>{formData.isMultiMonth ? "Monthly amount" : "Amount"}</label>
                  <div style={{ display: "flex", gap: 8 }}>
                    <select value={formData.dealCurrency} onChange={e => setFormData({ ...formData, dealCurrency: e.target.value })} style={{ ...S.fInput, width: 98 }}>
                      {CURRENCIES.map(c => <option key={c}>{c}</option>)}
                    </select>
                    <input
                      type="number"
                      placeholder="0"
                      value={formData.dealValue || ""}
                      onChange={e => setFormData({ ...formData, dealValue: e.target.value })}
                      style={S.fInput}
                    />
                  </div>
                </div>
                {formData.isMultiMonth && (
                  <>
                    <div style={{ textAlign: "center", fontSize: 22, color: "#94a3b8", paddingBottom: 8 }}>x</div>
                    <div>
                      <label style={S.fLabel}>Months</label>
                      <input
                        type="number"
                        min="1"
                        value={formData.dealDurationMonths || "12"}
                        onChange={e => setFormData({ ...formData, dealDurationMonths: e.target.value })}
                        style={S.fInput}
                      />
                    </div>
                  </>
                )}
              </div>

              {formData.hasCommission && (
                <div style={{ marginBottom: 18 }}>
                  <label style={S.fLabel}>Commission %</label>
                  <div style={{ display: "grid", gridTemplateColumns: "110px 40px 1fr", gap: 10, alignItems: "center" }}>
                    <input
                      type="number"
                      min="0"
                      value={formData.commissionPercent || "10"}
                      onChange={e => setFormData({ ...formData, commissionPercent: e.target.value })}
                      style={S.fInput}
                    />
                    <div style={{ ...S.fInput, display: "flex", justifyContent: "center", alignItems: "center", padding: "9px 0" }}>%</div>
                    <div style={{ fontSize: 12, color: "#475569" }}>
                      Value{" "}
                      <strong>
                        {formData.dealCurrency} {commissionValue.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                      </strong>{" "}
                      based on amount
                    </div>
                  </div>
                </div>
              )}

              <div style={{ marginBottom: 18 }}>
                <label style={S.fLabel}>Deal Items ({(formData.dealItems || []).length})</label>
                <div style={{ border: "1px solid #dbe4f0", borderRadius: 12, overflow: "hidden", background: "#ffffff" }}>
                  <div style={{ display: "grid", gridTemplateColumns: dealItemTemplateColumns, gap: 0, background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                    {["Item Name", "Description", ...(formData.hasCost ? ["Cost"] : []), "Price", ""].map((label, index) => (
                      <div key={`${label}-${index}`} style={{ padding: "10px 12px", fontSize: 11, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                        {label}
                      </div>
                    ))}
                  </div>
                  {(formData.dealItems || []).map((item: DealItem, index: number) => (
                    <div key={index} style={{ display: "grid", gridTemplateColumns: dealItemTemplateColumns, borderBottom: index === (formData.dealItems || []).length - 1 ? "none" : "1px solid #eef2f7" }}>
                      <input value={item.itemName} onChange={e => updateDealItem(index, "itemName", e.target.value)} style={{ ...S.fInput, border: "none", borderRadius: 0, background: "#fff", padding: "12px", fontSize: 12 }} placeholder="Enter item name" />
                      <input value={item.description} onChange={e => updateDealItem(index, "description", e.target.value)} style={{ ...S.fInput, border: "none", borderRadius: 0, background: "#fff", padding: "12px", fontSize: 12 }} placeholder="Enter description" />
                      {formData.hasCost && (
                        <input type="number" value={item.cost} onChange={e => updateDealItem(index, "cost", e.target.value)} style={{ ...S.fInput, border: "none", borderRadius: 0, background: "#fff", padding: "12px", fontSize: 12 }} placeholder="0" />
                      )}
                      <input type="number" value={item.price} onChange={e => updateDealItem(index, "price", e.target.value)} style={{ ...S.fInput, border: "none", borderRadius: 0, background: "#fff", padding: "12px", fontSize: 12 }} placeholder="0" />
                      <button
                        type="button"
                        onClick={() => removeDealItemRow(index)}
                        style={{ border: "none", background: "#fff", color: "#ef4444", fontSize: 16, cursor: "pointer" }}
                        aria-label={`Remove deal item ${index + 1}`}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={addDealItemRow}
                  style={{ width: "100%", marginTop: 10, padding: "10px 16px", background: "#ffffff", color: "#2563eb", border: "1.5px dashed #93c5fd", borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: "pointer" }}
                >
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
                ].map(toggle => (
                  <label key={toggle.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, fontSize: 13, fontWeight: 700, color: "#334155" }}>
                    <span>{toggle.label}</span>
                    <button
                      type="button"
                      onClick={() => setFormData(prev => ({ ...prev, [toggle.key]: !(prev as any)[toggle.key] }))}
                      style={{
                        width: 48,
                        height: 28,
                        borderRadius: 9999,
                        border: "none",
                        background: (formData as any)[toggle.key] ? "#84cc16" : "#cbd5e1",
                        position: "relative",
                        cursor: "pointer"
                      }}
                    >
                      <span
                        style={{
                          position: "absolute",
                          top: 3,
                          left: (formData as any)[toggle.key] ? 23 : 3,
                          width: 22,
                          height: 22,
                          borderRadius: "50%",
                          background: "#fff",
                          transition: "left 0.2s ease",
                          boxShadow: "0 2px 6px rgba(15,23,42,0.15)"
                        }}
                      />
                    </button>
                  </label>
                ))}
              </div>

              <div style={{ display: "grid", gap: 16 }}>
                <div>
                  <label style={S.fLabel}>Expected close date</label>
                  <input type="date" value={formData.dueDate} onChange={e => setFormData({ ...formData, dueDate: e.target.value })} style={S.fInput} />
                </div>
                {formData.probability === "100" && (
                  <>
                    <div>
                      <label style={S.fLabel}>Won Date</label>
                      <input type="date" value={formData.wonDate} onChange={e => setFormData({ ...formData, wonDate: e.target.value })} style={S.fInput} />
                    </div>
                    <div>
                      <label style={S.fLabel}>Won Time</label>
                      <input type="time" value={formData.wonTime} onChange={e => setFormData({ ...formData, wonTime: e.target.value })} style={S.fInput} />
                    </div>
                  </>
                )}
                {formData.dealValue && parseFloat(formData.dealValue) > 0 && formData.probability && parseFloat(formData.probability) > 0 && (
                  <div style={{ padding: "12px 14px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>Pipeline Value</div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: "#0f172a" }}>
                      {formData.dealCurrency}{" "}
                      {(parseFloat(formData.dealValue) * (parseFloat(formData.probability) / 100)).toLocaleString("en-IN", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </div>
                    <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>Calculated as deal amount x close probability</div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {activeAction && (
        <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 12, padding: 20, marginBottom: 20 }}>
          <h4 style={{ margin: "0 0 16px 0", fontSize: 16, fontWeight: 600 }}>Add {activeAction}</h4>
          
          <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
            <input
              type="time"
              value={actionTime}
              onChange={e => setActionTime(e.target.value)}
              style={{ padding: "10px", border: "1px solid #e2e8f0", borderRadius: 8, width: 140 }}
            />
            {activeAction === "Meeting" && (
              <input
                type="text"
                placeholder="Meeting place"
                value={meetingPlace}
                onChange={e => setMeetingPlace(e.target.value)}
                style={{ flex: 1, padding: "10px", border: "1px solid #e2e8f0", borderRadius: 8 }}
              />
            )}
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: "#475569", marginBottom: 8, display: "block" }}>Description (Optional)</label>
            <textarea
              value={actionDescription}
              onChange={e => setActionDescription(e.target.value)}
              rows={4}
              style={{ width: "100%", padding: "12px", border: "1px solid #e2e8f0", borderRadius: 8, resize: "vertical" }}
              placeholder="Add details here..."
            />
          </div>

          <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={() => setActiveAction(null)}
              style={{ padding: "10px 24px", border: "none", background: "transparent", color: "#64748b", fontWeight: 600 }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={saveAction}
              style={{ padding: "10px 32px", background: "#f59e0b", color: "#fff", border: "none", borderRadius: 9999, fontWeight: 600 }}
            >
              Save {activeAction}
            </button>
          </div>
        </div>
      )}

      <div style={{ marginTop: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
          <h4 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Timeline</h4>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {TIMELINE_FILTERS.map(filter => {
              const isActive = timelineFilter === filter.key;
              return (
                <button
                  key={filter.key}
                  type="button"
                  onClick={() => setTimelineFilter(filter.key)}
                  style={{
                    padding: "7px 14px",
                    borderRadius: 9999,
                    border: isActive ? "1px solid #bfdbfe" : "1px solid transparent",
                    background: isActive ? "#eff6ff" : "#f8fafc",
                    color: isActive ? "#2563eb" : "#64748b",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer"
                  }}
                >
                  {filter.label}
                </button>
              );
            })}
          </div>
        </div>

        {filteredTimelineEntries.length === 0 ? (
          <div style={{ padding: "18px 16px", border: "1px dashed #cbd5e1", borderRadius: 12, background: "#f8fafc", color: "#64748b", fontSize: 13 }}>
            No timeline entries yet for this filter.
          </div>
        ) : (
          <div style={{ position: "relative", paddingLeft: 28 }}>
            <div style={{ position: "absolute", left: 12, top: 4, bottom: 4, width: 2, background: "#e2e8f0", borderRadius: 2 }} />

            {filteredTimelineEntries.map((entry, idx) => {
              const meta = TIMELINE_META[entry.category];
              const originalIndex = timelineEntries.findIndex(item => item.id === entry.id);
              return (
                <div
                  key={entry.id}
                  style={{
                    position: "relative",
                    display: "flex",
                    gap: 14,
                    marginBottom: idx === filteredTimelineEntries.length - 1 ? 0 : 18,
                    alignItems: "flex-start"
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      left: 6,
                      top: 10,
                      width: 12,
                      height: 12,
                      borderRadius: "50%",
                      background: meta.color,
                      border: "2px solid #fff",
                      boxShadow: `0 0 0 2px ${meta.color}22`
                    }}
                  />
                  <div
                    style={{
                      marginLeft: 20,
                      flex: 1,
                      background: "#ffffff",
                      border: "1px solid #e2e8f0",
                      borderRadius: 12,
                      padding: "12px 14px",
                      boxShadow: "0 2px 6px rgba(0,0,0,0.05)"
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 6 }}>
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                          <span style={{ padding: "4px 10px", borderRadius: 9999, background: meta.bg, color: meta.color, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                            {meta.label}
                          </span>
                          <span style={{ fontSize: 12, color: "#64748b" }}>
                            {entry.date}{entry.time ? ` at ${entry.time}` : ""}
                          </span>
                        </div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a", marginBottom: entry.description ? 4 : 0 }}>
                          {entry.title}
                        </div>
                        {entry.place && (
                          <div style={{ fontSize: 12, color: "#64748b", marginBottom: entry.description ? 4 : 0 }}>
                            Place: {entry.place}
                          </div>
                        )}
                        {entry.description && (
                          <div style={{ fontSize: 13, color: "#334155", lineHeight: 1.45 }}>
                            {entry.description}
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => setActionDeleteModal({ index: originalIndex, action: entry })}
                        style={{ border: "none", background: "transparent", color: "#94a3b8", fontSize: 16, cursor: "pointer" }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = "#ef4444")}
                        onMouseLeave={(e) => (e.currentTarget.style.color = "#94a3b8")}
                        aria-label={`Delete ${entry.title}`}
                      >
                        x
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
        <button type="button" onClick={saveActivityActions} style={S.btnPrimary}>Save Actions</button>
        <button type="button" onClick={resetForm} style={S.btnOutline}>Close</button>
      </div>
    </div>
  );

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
    count: scopedActivities.filter(a => a.stage === s).length,
  }));

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Sans', sans-serif", background: "#f8fafc" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>🔥</div>
          <div style={{ fontSize: 15, color: "#64748b" }}>Loading…</div>
        </div>
      </div>
    );
  }

  if (isLeadWorkspace && !selectedLead) {
    return (
      <div style={S.page}>
        <AppPageHeader
          current="transactions"
          onNavigate={onNavigate}
          isAdmin={isAdmin}
          onLogout={logout}
        />
        <div style={{ padding: "32px 24px" }}>
          <div style={S.leadWorkspaceEmpty}>
            <h2 style={{ margin: 0, fontSize: 22, color: "#0f172a" }}>Lead not found</h2>
            <p style={{ margin: 0, color: "#64748b", lineHeight: 1.6 }}>
              No lead could be found for <strong>{routeLeadId}</strong>. Please return to Leads and open a valid row.
            </p>
            <button type="button" onClick={() => onNavigate("leads")} style={S.btnPrimary}>
              Back to Leads
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={S.page}>
      <AppPageHeader
        current="transactions"
        onNavigate={onNavigate}
        isAdmin={isAdmin}
        onLogout={logout}
      />

      {isLeadWorkspace && selectedLead && (
        <div style={S.leadInfoWrap}>
          <div style={S.leadInfoHeader}>
            <div>
              <div style={S.leadInfoTitle}>{selectedLead.accountName || "Lead Information"}</div>
              <div style={S.leadInfoSubtitle}>Lead ID: {selectedLead.leadId}</div>
            </div>
            <button type="button" onClick={() => onNavigate("leads")} style={S.btnOutline}>
              Back to Leads
            </button>
          </div>
          <div style={S.leadInfoGrid}>
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
              <div key={label} style={S.leadInfoItem}>
                <div style={S.leadInfoLabel}>{label}</div>
                <div style={S.leadInfoValue}>{value || "-"}</div>
              </div>
            ))}
          </div>
        </div>
      )}

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

      <div style={S.actionBar}>
        <div style={S.actionRow}>
          <input placeholder="Search activities…" value={search} onChange={e => setSearch(e.target.value)} style={S.searchInput} />
          <select value={stageFilter} onChange={e => setStageFilter(e.target.value)} style={S.select}>
            <option value="All">All Stages</option>
            {STAGES.map(s => <option key={s}>{s}</option>)}
          </select>
          <button onClick={downloadExcel} style={S.btnDark}>Export Excel</button>
          <button onClick={() => setShowColModal(true)} style={S.btnOutline}>Columns</button>
          <button
            onClick={() => {
              setShowForm(true);
              setActionActivityId(null);
              setActionDeleteModal(null);
              setDeletedActionLogs([]);
              setEditingId(null);
              setFormData(buildEmptyActivity());
            }}
            style={S.btnPrimary}
          >
            + Add Activity
          </button>
        </div>
      </div>

      {/* Form */}
      {showForm && (
        <div style={S.formCard}>
          <div style={S.formHeader}>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>{editingId ? "Edit Activity" : "Add New Activity"}</h2>
            <button onClick={resetForm} style={S.closeBtn}>✕</button>
          </div>
          <form onSubmit={handleSubmit}>
            {/* Original fields unchanged */}
            <div style={S.formGrid}>
              <div style={S.formField}>
                <label style={S.fLabel}>Link to Lead *</label>
                {isLeadWorkspace && selectedLead ? (
                  <input
                    style={{ ...S.fInput, background: "#f8fafc", color: "#475569" }}
                    value={`${selectedLead.leadId} — ${selectedLead.accountName}`}
                    readOnly
                  />
                ) : (
                  <select style={S.fInput} value={formData.leadId} required onChange={e => handleLeadSelect(e.target.value)}>
                    <option value="">Select a Lead</option>
                    {leads.map(l => <option key={l.leadId} value={l.leadId}>{l.leadId} — {l.accountName}</option>)}
                  </select>
                )}
              </div>
              <div style={S.formField}>
                <label style={S.fLabel}>Account Name</label>
                <input style={{ ...S.fInput, background: "#f1f5f9" }} value={formData.accountName} readOnly />
              </div>
              <div style={S.formField}>
                <label style={S.fLabel}>Activity Name *</label>
                <input style={S.fInput} required placeholder="e.g. Discovery Call, Proposal Sent…" value={formData.activityName} onChange={e => setFormData({ ...formData, activityName: e.target.value })} />
              </div>
              <div style={S.formField}>
                <label style={S.fLabel}>Date</label>
                <input type="date" style={S.fInput} value={formData.activityDate || new Date().toISOString().slice(0, 10)} onChange={e => setFormData({ ...formData, activityDate: e.target.value })} />
              </div>
              <div style={S.formField}>
                <label style={S.fLabel}>Stage</label>
                <select style={S.fInput} value={formData.stage} onChange={e => setFormData({ ...formData, stage: e.target.value })}>
                  {STAGES.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div style={S.formField}>
                <label style={S.fLabel}>Handled By</label>
                <input style={S.fInput} value={formData.handledBy} onChange={e => setFormData({ ...formData, handledBy: e.target.value })} />
              </div>
            </div>

            <div style={{ padding: "0 24px 20px" }}>
              <label style={S.fLabel}>Notes</label>
              <textarea rows={3} style={{ ...S.fInput, resize: "vertical" }} value={formData.notes} onChange={e => setFormData({ ...formData, notes: e.target.value })} />
            </div>
            {false && (
            <>
            {/* ==================== ACTIONS SECTION (Inline + Timeline) ==================== */}
            <div style={{ padding: "0 24px 24px", borderTop: "1px solid #e2e8f0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Actions</h3>
              </div>

              {/* Quick Buttons */}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
                <button
                  type="button"
                  onClick={toggleDealMode}
                  style={{
                    padding: "8px 20px",
                    borderRadius: 9999,
                    border: formData.isDeal ? "1px solid #be185d" : "1px solid #cbd5e1",
                    background: formData.isDeal ? "#e11d48" : "#fff",
                    color: formData.isDeal ? "#fff" : "#334155",
                    fontSize: 14,
                    fontWeight: 700,
                    cursor: "pointer"
                  }}
                >
                  {formData.isDeal ? "Deal On" : "+ Deal"}
                </button>
                <button 
                  type="button" 
                  onClick={() => openAction("Note")} 
                  style={{ padding: "8px 20px", borderRadius: 9999, border: "1px solid #3b82f6", background: "#fff", color: "#3b82f6", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
                >+ Note</button>
                <button 
                  type="button" 
                  onClick={() => openAction("Call")} 
                  style={{ padding: "8px 20px", borderRadius: 9999, border: "1px solid #3b82f6", background: "#fff", color: "#3b82f6", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
                >+ Call</button>
                <button 
                  type="button" 
                  onClick={() => openAction("Meeting")} 
                  style={{ padding: "8px 20px", borderRadius: 9999, border: "1px solid #3b82f6", background: "#fff", color: "#3b82f6", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
                >+ Meeting</button>
              </div>

              {formData.isDeal && (
                <div style={{ marginBottom: 20, padding: "18px 18px 14px", background: "#ffffff", borderRadius: 14, border: "1px solid #dbe4f0", boxShadow: "0 4px 14px rgba(15,23,42,0.05)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 20, fontWeight: 800, color: "#0f172a", lineHeight: 1.1 }}>
                        {formData.dealCurrency} {effectiveDealAmount.toLocaleString("en-IN")}
                      </span>
                      <span style={{ fontSize: 13, color: "#94a3b8" }}>•</span>
                      <span style={{ fontSize: 13, color: "#475569" }}>
                        There&apos;s a {formData.probability || "10"}% chance it will close on{" "}
                        <span style={{ color: "#2563eb", fontWeight: 700 }}>{formData.dueDate || "Select date"}</span>
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowLostModal(true)}
                      style={{ padding: "8px 16px", background: "#fff1f2", color: "#be123c", border: "1px solid #fecdd3", borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: "pointer" }}
                    >
                      Lost
                    </button>
                  </div>

                  <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4, marginBottom: 18 }}>
                    {DEAL_PIPELINE_STAGES.map((stage, index) => {
                      const isActive = formData.probability === stage.id || (!formData.probability && stage.id === "10");
                      return (
                        <Fragment key={stage.id}>
                          <button
                            type="button"
                            onClick={() => setFormData({ ...formData, probability: stage.id })}
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
                              whiteSpace: "nowrap"
                            }}
                          >
                            <span>{stage.percent}</span>
                            <span style={{ opacity: isActive && stage.id !== "100" ? 0.7 : 0.5 }}>|</span>
                            <span>{stage.label}</span>
                          </button>
                          {index < DEAL_PIPELINE_STAGES.length - 1 && (
                            <span style={{ alignSelf: "center", color: "#cbd5e1", fontSize: 22 }}>›</span>
                          )}
                        </Fragment>
                      );
                    })}
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.65fr) minmax(260px, 0.95fr)", gap: 18, alignItems: "start" }}>
                    <div>
                      <div style={{ marginBottom: 18 }}>
                        <label style={S.fLabel}>Deal name</label>
                        <input
                          style={S.fInput}
                          value={formData.dealName || ""}
                          onChange={e => setFormData({ ...formData, dealName: e.target.value })}
                          placeholder="Enter deal name"
                        />
                      </div>

                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: formData.isMultiMonth ? "minmax(0,1fr) 20px 110px" : "minmax(0,1fr)",
                          gap: 10,
                          alignItems: "end",
                          marginBottom: 16
                        }}
                      >
                        <div>
                          <label style={S.fLabel}>{formData.isMultiMonth ? "Monthly amount" : "Amount"}</label>
                          <div style={{ display: "flex", gap: 8 }}>
                            <select value={formData.dealCurrency} onChange={e => setFormData({ ...formData, dealCurrency: e.target.value })} style={{ ...S.fInput, width: 98 }}>
                              {CURRENCIES.map(c => <option key={c}>{c}</option>)}
                            </select>
                            <input
                              type="number"
                              placeholder="0"
                              value={formData.dealValue || ""}
                              onChange={e => setFormData({ ...formData, dealValue: e.target.value })}
                              style={S.fInput}
                            />
                          </div>
                        </div>
                        {formData.isMultiMonth && (
                          <>
                            <div style={{ textAlign: "center", fontSize: 22, color: "#94a3b8", paddingBottom: 8 }}>x</div>
                            <div>
                              <label style={S.fLabel}>Months</label>
                              <input
                                type="number"
                                min="1"
                                value={formData.dealDurationMonths || "12"}
                                onChange={e => setFormData({ ...formData, dealDurationMonths: e.target.value })}
                                style={S.fInput}
                              />
                            </div>
                          </>
                        )}
                      </div>

                      {formData.hasCommission && (
                        <div style={{ marginBottom: 18 }}>
                          <label style={S.fLabel}>Commission %</label>
                          <div style={{ display: "grid", gridTemplateColumns: "110px 40px 1fr", gap: 10, alignItems: "center" }}>
                            <input
                              type="number"
                              min="0"
                              value={formData.commissionPercent || "10"}
                              onChange={e => setFormData({ ...formData, commissionPercent: e.target.value })}
                              style={S.fInput}
                            />
                            <div style={{ ...S.fInput, display: "flex", justifyContent: "center", alignItems: "center", padding: "9px 0" }}>%</div>
                            <div style={{ fontSize: 12, color: "#475569" }}>
                              Value{" "}
                              <strong>
                                {formData.dealCurrency} {commissionValue.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                              </strong>{" "}
                              based on amount
                            </div>
                          </div>
                        </div>
                      )}

                      <div style={{ marginBottom: 18 }}>
                        <label style={S.fLabel}>Deal Items ({(formData.dealItems || []).length})</label>
                        <div style={{ border: "1px solid #dbe4f0", borderRadius: 12, overflow: "hidden", background: "#ffffff" }}>
                          <div style={{ display: "grid", gridTemplateColumns: dealItemTemplateColumns, gap: 0, background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                            {["Item Name", "Description", ...(formData.hasCost ? ["Cost"] : []), "Price", ""].map((label, index) => (
                              <div key={`${label}-${index}`} style={{ padding: "10px 12px", fontSize: 11, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                                {label}
                              </div>
                            ))}
                          </div>
                          {(formData.dealItems || []).map((item: DealItem, index: number) => (
                            <div key={index} style={{ display: "grid", gridTemplateColumns: dealItemTemplateColumns, borderBottom: index === (formData.dealItems || []).length - 1 ? "none" : "1px solid #eef2f7" }}>
                              <input value={item.itemName} onChange={e => updateDealItem(index, "itemName", e.target.value)} style={{ ...S.fInput, border: "none", borderRadius: 0, background: "#fff", padding: "12px", fontSize: 12 }} placeholder="Enter item name" />
                              <input value={item.description} onChange={e => updateDealItem(index, "description", e.target.value)} style={{ ...S.fInput, border: "none", borderRadius: 0, background: "#fff", padding: "12px", fontSize: 12 }} placeholder="Enter description" />
                              {formData.hasCost && (
                                <input type="number" value={item.cost} onChange={e => updateDealItem(index, "cost", e.target.value)} style={{ ...S.fInput, border: "none", borderRadius: 0, background: "#fff", padding: "12px", fontSize: 12 }} placeholder="0" />
                              )}
                              <input type="number" value={item.price} onChange={e => updateDealItem(index, "price", e.target.value)} style={{ ...S.fInput, border: "none", borderRadius: 0, background: "#fff", padding: "12px", fontSize: 12 }} placeholder="0" />
                              <button
                                type="button"
                                onClick={() => removeDealItemRow(index)}
                                style={{ border: "none", background: "#fff", color: "#ef4444", fontSize: 16, cursor: "pointer" }}
                                aria-label={`Remove deal item ${index + 1}`}
                              >
                                ×
                              </button>
                            </div>
                          ))}
                        </div>
                        <button
                          type="button"
                          onClick={addDealItemRow}
                          style={{ width: "100%", marginTop: 10, padding: "10px 16px", background: "#ffffff", color: "#2563eb", border: "1.5px dashed #93c5fd", borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: "pointer" }}
                        >
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
                        ].map(toggle => (
                          <label key={toggle.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, fontSize: 13, fontWeight: 700, color: "#334155" }}>
                            <span>{toggle.label}</span>
                            <button
                              type="button"
                              onClick={() => setFormData(prev => ({ ...prev, [toggle.key]: !(prev as any)[toggle.key] }))}
                              style={{
                                width: 48,
                                height: 28,
                                borderRadius: 9999,
                                border: "none",
                                background: (formData as any)[toggle.key] ? "#84cc16" : "#cbd5e1",
                                position: "relative",
                                cursor: "pointer"
                              }}
                            >
                              <span
                                style={{
                                  position: "absolute",
                                  top: 3,
                                  left: (formData as any)[toggle.key] ? 23 : 3,
                                  width: 22,
                                  height: 22,
                                  borderRadius: "50%",
                                  background: "#fff",
                                  transition: "left 0.2s ease",
                                  boxShadow: "0 2px 6px rgba(15,23,42,0.15)"
                                }}
                              />
                            </button>
                          </label>
                        ))}
                      </div>

                      <div style={{ display: "grid", gap: 16 }}>
                        <div>
                          <label style={S.fLabel}>Expected close date</label>
                          <input type="date" value={formData.dueDate} onChange={e => setFormData({ ...formData, dueDate: e.target.value })} style={S.fInput} />
                        </div>
                        {formData.probability === "100" && (
                          <>
                            <div>
                              <label style={S.fLabel}>Won Date</label>
                              <input type="date" value={formData.wonDate} onChange={e => setFormData({ ...formData, wonDate: e.target.value })} style={S.fInput} />
                            </div>
                            <div>
                              <label style={S.fLabel}>Won Time</label>
                              <input type="time" value={formData.wonTime} onChange={e => setFormData({ ...formData, wonTime: e.target.value })} style={S.fInput} />
                            </div>
                          </>
                        )}
                        {formData.dealValue && parseFloat(formData.dealValue) > 0 && formData.probability && parseFloat(formData.probability) > 0 && (
                          <div style={{ padding: "12px 14px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10 }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>Pipeline Value</div>
                            <div style={{ fontSize: 18, fontWeight: 800, color: "#0f172a" }}>
                              {formData.dealCurrency}{" "}
                              {(parseFloat(formData.dealValue) * (parseFloat(formData.probability) / 100)).toLocaleString("en-IN", {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </div>
                            <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>Calculated as deal amount x close probability</div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

                            {/* Inline Action Form - appears when button is clicked */}
              {activeAction && (
                <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 12, padding: 20, marginBottom: 20 }}>
                  <h4 style={{ margin: "0 0 16px 0", fontSize: 16, fontWeight: 600 }}>Add {activeAction}</h4>
                  
                  <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
                    <input 
                      type="time" 
                      value={actionTime} 
                      onChange={e => setActionTime(e.target.value)} 
                      style={{ padding: "10px", border: "1px solid #e2e8f0", borderRadius: 8, width: 140 }} 
                    />
                    {activeAction === "Meeting" && (
                      <input 
                        type="text" 
                        placeholder="Meeting place" 
                        value={meetingPlace} 
                        onChange={e => setMeetingPlace(e.target.value)} 
                        style={{ flex: 1, padding: "10px", border: "1px solid #e2e8f0", borderRadius: 8 }} 
                      />
                    )}
                  </div>

                  <div style={{ marginBottom: 16 }}>
                    <label style={{ fontSize: 13, fontWeight: 600, color: "#475569", marginBottom: 8, display: "block" }}>Description (Optional)</label>
                    <textarea 
                      value={actionDescription} 
                      onChange={e => setActionDescription(e.target.value)} 
                      rows={4} 
                      style={{ width: "100%", padding: "12px", border: "1px solid #e2e8f0", borderRadius: 8, resize: "vertical" }} 
                      placeholder="Add details here..." 
                    />
                  </div>

                  <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
                    <button 
                      type="button"
                      onClick={() => setActiveAction(null)} 
                      style={{ padding: "10px 24px", border: "none", background: "transparent", color: "#64748b", fontWeight: 600 }}
                    >
                      Cancel
                    </button>
                    <button 
                      type="button"
                      onClick={saveAction} 
                      style={{ padding: "10px 32px", background: "#f59e0b", color: "#fff", border: "none", borderRadius: 9999, fontWeight: 600 }}
                    >
                      Save {activeAction}
                    </button>
                  </div>
                </div>
              )}



              <div style={{ marginTop: 20 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
                  <h4 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Timeline</h4>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {TIMELINE_FILTERS.map(filter => {
                      const isActive = timelineFilter === filter.key;
                      return (
                        <button
                          key={filter.key}
                          type="button"
                          onClick={() => setTimelineFilter(filter.key)}
                          style={{
                            padding: "7px 14px",
                            borderRadius: 9999,
                            border: isActive ? "1px solid #bfdbfe" : "1px solid transparent",
                            background: isActive ? "#eff6ff" : "#f8fafc",
                            color: isActive ? "#2563eb" : "#64748b",
                            fontSize: 13,
                            fontWeight: 600,
                            cursor: "pointer"
                          }}
                        >
                          {filter.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {filteredTimelineEntries.length === 0 ? (
                  <div style={{ padding: "18px 16px", border: "1px dashed #cbd5e1", borderRadius: 12, background: "#f8fafc", color: "#64748b", fontSize: 13 }}>
                    No timeline entries yet for this filter.
                  </div>
                ) : (
                  <div style={{ position: "relative", paddingLeft: 28 }}>
                    <div style={{ position: "absolute", left: 12, top: 4, bottom: 4, width: 2, background: "#e2e8f0", borderRadius: 2 }} />

                    {filteredTimelineEntries.map((entry, idx) => {
                      const meta = TIMELINE_META[entry.category];
                      const originalIndex = timelineEntries.findIndex(item => item.id === entry.id);
                      return (
                        <div
                          key={entry.id}
                          style={{
                            position: "relative",
                            display: "flex",
                            gap: 14,
                            marginBottom: idx === filteredTimelineEntries.length - 1 ? 0 : 18,
                            alignItems: "flex-start"
                          }}
                        >
                          <div
                            style={{
                              position: "absolute",
                              left: 6,
                              top: 10,
                              width: 12,
                              height: 12,
                              borderRadius: "50%",
                              background: meta.color,
                              border: "2px solid #fff",
                              boxShadow: `0 0 0 2px ${meta.color}22`
                            }}
                          />
                          <div
                            style={{
                              marginLeft: 20,
                              flex: 1,
                              background: "#ffffff",
                              border: "1px solid #e2e8f0",
                              borderRadius: 12,
                              padding: "12px 14px",
                              boxShadow: "0 2px 6px rgba(0,0,0,0.05)"
                            }}
                          >
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 6 }}>
                              <div>
                                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                                  <span style={{ padding: "4px 10px", borderRadius: 9999, background: meta.bg, color: meta.color, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                                    {meta.label}
                                  </span>
                                  <span style={{ fontSize: 12, color: "#64748b" }}>
                                    {entry.date}{entry.time ? ` at ${entry.time}` : ""}
                                  </span>
                                </div>
                                <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a", marginBottom: entry.description ? 4 : 0 }}>
                                  {entry.title}
                                </div>
                                {entry.place && (
                                  <div style={{ fontSize: 12, color: "#64748b", marginBottom: entry.description ? 4 : 0 }}>
                                    Place: {entry.place}
                                  </div>
                                )}
                                {entry.description && (
                                  <div style={{ fontSize: 13, color: "#334155", lineHeight: 1.45 }}>
                                    {entry.description}
                                  </div>
                                )}
                              </div>
                              <button
                                type="button"
                                onClick={() => setActionDeleteModal({ index: originalIndex, action: entry })}
                                style={{ border: "none", background: "transparent", color: "#94a3b8", fontSize: 16, cursor: "pointer" }}
                                onMouseEnter={(e) => (e.currentTarget.style.color = "#ef4444")}
                                onMouseLeave={(e) => (e.currentTarget.style.color = "#94a3b8")}
                                aria-label={`Delete ${entry.title}`}
                              >
                                x
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            </>
            )}
            <div style={{ padding: "0 24px 24px", display: "flex", gap: 10 }}>
              <button type="submit" style={S.btnPrimary}>{editingId ? "Save Changes" : "Add Activity"}</button>
              <button type="button" onClick={resetForm} style={S.btnOutline}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* Lost Dialog */}
      {showLostModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10000 }}>
          <div style={{ background: "#ffffff", borderRadius: 16, width: "100%", maxWidth: 380, boxShadow: "0 20px 60px rgba(0,0,0,0.25)", padding: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Reason Lost</h2>
              <button onClick={() => { setShowLostModal(false); setSelectedLostReason(""); }} style={{ background: "none", border: "none", fontSize: 24, cursor: "pointer", color: "#64748b" }}>✕</button>
            </div>
            <select value={selectedLostReason} onChange={(e) => setSelectedLostReason(e.target.value)} style={{ width: "100%", padding: "12px 14px", borderRadius: 8, border: "2px solid #3b82f6", fontSize: 15, background: "#fff", outline: "none", marginBottom: 24 }}>
              <option value="">Please select ...</option>
              <option value="Wrong time">Wrong time</option>
              <option value="Price too high">Price too high</option>
              <option value="No authority">No authority</option>
              <option value="Competitor">Competitor</option>
            </select>
            <button onClick={handleSaveLostReason} style={{ width: "100%", background: "#6b7280", color: "#fff", border: "none", padding: "14px", borderRadius: 9999, fontSize: 15, fontWeight: 600, cursor: "pointer" }}>Save</button>
          </div>
        </div>
      )}

      {/* Table Section - unchanged */}
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
                <Fragment key={a.id}>
                  <tr style={S.tr}
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
                  <td style={S.tdSticky}>
                    <div style={{ display: "flex", gap: 6, flexDirection: "column" }}>
                      <button onClick={() => onNavigate("activityDetail", a.transactionId || a.id)} style={S.txnBtn}>View Activity</button>
                      <button onClick={() => startEdit(a)} style={S.editBtn}>Edit</button>
                      <button onClick={() => deleteActivity(a)} style={S.deleteBtn}>Delete</button>
                    </div>
                  </td>
                </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 12, fontSize: 12, color: "#94a3b8" }}>
          Showing {filtered.length} of {scopedActivities.length} activities · <span style={{ color: "#16a34a" }}>🔥 Firebase connected</span>
        </div>
      </div>

      {/* Column Selector Modal - unchanged */}
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
                      <input type="checkbox" checked={visibleCols[col]} onChange={() => setVisibleCols(p => ({ ...p, [col]: !p[col] }))} style={{ cursor: "pointer" }} />
                      {col}
                    </label>
                  ))}
                </div>
              </div>
            ))}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
              <button onClick={() => setVisibleCols(Object.fromEntries(Object.keys(visibleCols).map(k => [k, true])))} style={{ padding: "8px 16px", background: "#f1f5f9", color: "#475569", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                Reset All
              </button>
              <button onClick={() => setShowColModal(false)} style={{ padding: "8px 20px", background: "#0f172a", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteModal && (
        <DeleteModal
          title="Delete Activity"
          itemName={`${deleteModal.activity.activityName} — ${deleteModal.activity.accountName}`}
          onConfirm={confirmDelete}
          onCancel={() => setDeleteModal(null)}
        />
      )}
      {actionDeleteModal && (
        <DeleteModal
          title="Delete Action"
          itemName={`${actionDeleteModal.action.type} - ${actionDeleteModal.action.date} at ${actionDeleteModal.action.time}`}
          onConfirm={confirmDeleteAction}
          onCancel={() => setActionDeleteModal(null)}
        />
      )}
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", background: "#f8fafc", fontFamily: "'DM Sans','Segoe UI',sans-serif", color: "#0f172a" },
  header: { display: "grid", padding: "18px 24px 14px", background: "#ffffff", borderBottom: "1px solid #e9eef5", boxShadow: "0 8px 24px rgba(15,23,42,0.06)", position: "sticky", top: 0, zIndex: 100, gap: 14 },
  headerTop: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" as "wrap" },
  headerBottom: { display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" as "wrap" },
  headerLeft: { display: "flex", alignItems: "center", gap: 12 },
  headerTitle: { fontSize: 22, fontWeight: 800, margin: 0, letterSpacing: "-0.5px", color: "#0f172a" },
  navTabs: { display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap", width: "100%", order: 3 },
  navTab: { padding: "6px 14px", background: "transparent", color: "#64748b", border: "1.5px solid #e2e8f0", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" },
  navTabActive: { background: "#0f172a", color: "#fff", border: "1.5px solid #0f172a" },
  headerRight: { display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10, flexWrap: "wrap" as "wrap", flex: "1 1 420px" },
  searchInput: { padding: "10px 14px", borderRadius: 12, border: "1px solid #d7dee8", fontSize: 13, background: "#ffffff", outline: "none", width: 230, boxShadow: "0 1px 2px rgba(15,23,42,0.04)" },
  select: { padding: "10px 14px", borderRadius: 12, border: "1px solid #d7dee8", fontSize: 13, background: "#ffffff", outline: "none", cursor: "pointer", boxShadow: "0 1px 2px rgba(15,23,42,0.04)" },
  btnPrimary: { padding: "10px 16px", background: "#0f172a", color: "#fff", border: "none", borderRadius: 12, fontSize: 13, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", boxShadow: "0 10px 22px rgba(15,23,42,0.16)" },
  btnDark: { padding: "10px 14px", background: "#1e293b", color: "#fff", border: "none", borderRadius: 12, fontSize: 13, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" },
  btnOutline: { padding: "10px 14px", background: "#fff", color: "#0f172a", border: "1px solid #d7dee8", borderRadius: 12, fontSize: 13, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", boxShadow: "0 1px 2px rgba(15,23,42,0.04)" },
  btnLogout: { padding: "10px 14px", background: "#fff", color: "#ef4444", border: "1px solid #fecaca", borderRadius: 12, fontSize: 13, fontWeight: 700, cursor: "pointer" },
  statsBar: { display: "flex", gap: 12, padding: "14px 24px", background: "#ffffff", borderBottom: "1px solid #e2e8f0", flexWrap: "wrap", alignItems: "center" },
  actionBar: { padding: "14px 24px 18px", background: "#ffffff", borderBottom: "1px solid #e2e8f0" },
  actionRow: { display: "flex", alignItems: "center", justifyContent: "flex-start", gap: 10, flexWrap: "wrap" as "wrap" },
  statTotal: { display: "flex", flexDirection: "column", alignItems: "center", padding: "8px 20px", background: "#f1f5f9", borderRadius: 10, marginRight: 4 },
  statNum: { fontSize: 22, fontWeight: 800, color: "#0f172a" },
  statLabel: { fontSize: 11, color: "#64748b", marginTop: 2 },
  statChip: { display: "flex", flexDirection: "column", alignItems: "center", padding: "8px 16px", borderRadius: 10, minWidth: 72, transition: "transform 0.1s" },
  leadInfoWrap: { margin: "18px 24px 0", background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 16, boxShadow: "0 6px 24px rgba(15,23,42,0.05)", overflow: "hidden" },
  leadInfoHeader: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, padding: "18px 20px", borderBottom: "1px solid #eef2f7", background: "#f8fafc", flexWrap: "wrap" as "wrap" },
  leadInfoTitle: { fontSize: 20, fontWeight: 800, color: "#0f172a", marginBottom: 4 },
  leadInfoSubtitle: { fontSize: 13, color: "#64748b", fontWeight: 600 },
  leadInfoGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "16px 20px", padding: "18px 20px" },
  leadInfoItem: { display: "flex", flexDirection: "column", gap: 4 },
  leadInfoLabel: { fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: "#64748b" },
  leadInfoValue: { fontSize: 14, color: "#0f172a", lineHeight: 1.45, whiteSpace: "pre-wrap" as "pre-wrap", wordBreak: "break-word" as "break-word" },
  formCard: { margin: "20px 24px", background: "#ffffff", borderRadius: 16, border: "1px solid #e2e8f0", boxShadow: "0 4px 20px rgba(0,0,0,0.06)", overflow: "hidden" },
  formHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 24px", borderBottom: "1px solid #f1f5f9", background: "#f8fafc" },
  closeBtn: { background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "#64748b", padding: "4px 8px" },
  formGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: "16px 20px", padding: "20px 24px 8px" },
  formField: { display: "flex", flexDirection: "column" },
  fLabel: { fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 5 },
  fInput: { padding: "9px 12px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 13, background: "#f8fafc", outline: "none", color: "#0f172a", width: "100%", boxSizing: "border-box" },
  tableWrap: { overflowX: "auto", borderRadius: 12, border: "1px solid #cfd9e8", background: "#fff", boxShadow: "0 4px 18px rgba(15,23,42,0.06)" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: { padding: "13px 14px", textAlign: "left", background: "#edf4ff", color: "#1e3a5f", fontWeight: 800, fontSize: 12, whiteSpace: "nowrap", borderBottom: "2px solid #cbdcf6", borderRight: "1px solid #dbe7f8", position: "sticky", top: 0 },
  thSticky: { padding: "13px 14px", textAlign: "left", background: "#edf4ff", color: "#1e3a5f", fontWeight: 800, fontSize: 12, whiteSpace: "nowrap", borderBottom: "2px solid #cbdcf6", position: "sticky", top: 0, right: 0, zIndex: 3, boxShadow: "-2px 0 6px rgba(0,0,0,0.06)" },
  tdSticky: { padding: "12px 14px", color: "#334155", verticalAlign: "top", fontSize: 13, position: "sticky", right: 0, background: "#ffffff", zIndex: 1, boxShadow: "-2px 0 6px rgba(0,0,0,0.06)", borderLeft: "1px solid #e2e8f0" },
  tr: { borderBottom: "1px solid #dbe4f0", transition: "background 0.15s" },
  td: { padding: "12px 14px", color: "#334155", verticalAlign: "top", fontSize: 13, borderRight: "1px solid #f1f5f9" },
  txnBtn: { padding: "5px 10px", background: "#fef9c3", color: "#b45309", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 12 },
  editBtn: { padding: "5px 10px", background: "#eff6ff", color: "#2563eb", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 12 },
  deleteBtn: { padding: "5px 10px", background: "#fef2f2", color: "#dc2626", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 12 },
  rowActionPanel: {
    margin: "10px 14px 18px",
    padding: "20px 24px",
    border: "1px solid #d7e2f0",
    borderTop: "3px solid #c7d6f3",
    borderRadius: 16,
    background: "#f8fbff",
    boxShadow: "0 10px 28px rgba(15,23,42,0.06)",
  },
};
