import { useEffect, useRef, useState } from "react";
import { db } from "../firebase/config";
import {
  collection,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  setDoc,
} from "firebase/firestore";
import { logActivity } from "../firebase/activityLog";
import { signOut } from "firebase/auth";
import { auth } from "../firebase/config";
import * as XLSX from "xlsx";
import DeleteModal from "../components/DeleteModal";
import AppHeaderNav from "../components/AppHeaderNav";
import ChangePasswordModal from "../components/ChangePasswordModal";
import { Page } from "../navigation";
import {
  canUserSeeProspect,
  getSessionUser,
  getRecordCollaborators,
  isPrimaryAdmin,
} from "../accessControl";
import { getBusinessDayError, isBusinessDay } from "../utils/followUps";

// ─── Constants ───────────────────────────────────────────────────────────────
const COLLECTION = "leads";
const LINKED_LEAD_COLLECTION = "prospectLinkedLeads";

const STATUSES = ["Prospect", "Active", "Inactive", "Test", "Hold", "Converted to Deal"];
const PROSPECT_TYPES = ["Existing Client", "New"];

const STATUSES_ENGAGEMENT = ["Development", "M&S", "Consulting", "Support", "Implementation", "TBD"];

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  Prospect: { bg: "#e0f2fe", color: "#0369a1" },
  Active:   { bg: "#dcfce7", color: "#16a34a" },
  Inactive: { bg: "#fee2e2", color: "#dc2626" },
  Test: { bg: "#ede9fe", color: "#7c3aed" },
  Hold: { bg: "#fef3c7", color: "#b45309" },
  "Converted to Deal": { bg: "#dbeafe", color: "#1d4ed8" },
};

const EMPTY_LEAD = {
  leadId: "",
  leadDate: "",
  programName: "",
  projectId: "",
  accountName: "",
  engagementName: "",
  engagementType: "",
  clientSpoc: "",
  clientSpocPosition: "",
  clientEmail: "",
  clientCountryCode: "",
  clientPhone: "",
  partnerSpoc: "",
  partnerSpocPosition: "",
  partnerEmail: "",
  partnerCountryCode: "",
  partnerPhone: "",
  status: "Active",
  prospectType: "",
  handledBy: "",
  managedBy: "",
  url: "",
  statusComment: "",
  followUpDate: "",
  followUpTime: "",
  recordViewableBy: [] as string[],
  remarks: "",
  actions: [] as LeadTimelineEntry[],
};

function getTodayDateValue() {
  return new Date().toISOString().slice(0, 10);
}

function createEmptyLead() {
  return {
    ...EMPTY_LEAD,
    leadDate: getTodayDateValue(),
  };
}

type Lead = typeof EMPTY_LEAD & { id: string; createdAt?: string };
type TimelineCategory = "note" | "call" | "meeting";
type LeadTimelineEntry = {
  id: string;
  category: TimelineCategory;
  title: string;
  description: string;
  date: string;
  time?: string;
  place?: string;
  createdAt: string;
  createdBy?: string;
  assignedTo?: string;
  followUpDate?: string;
  followUpTime?: string;
};
type LeadTransactionRef = {
  leadId: string;
  transactionId?: string;
  createdAt?: string;
  updatedAt?: string;
  handledBy?: string;
  actions?: Array<{ assignedTo?: string | null }>;
};
type ProspectLinkedLead = {
  linkedLeadId: string;
  prospectLeadId: string;
  prospectDocId: string;
  accountName: string;
  programName: string;
  projectName: string;
  engagementName: string;
  engagementType: string;
  source: "prospect";
  createdAt: string;
  updatedAt: string;
};

function getLeadDisplayDetails(lead: Partial<Lead>, linkedLead?: Partial<ProspectLinkedLead> | null) {
  return {
    programName: String(linkedLead?.programName || (lead as any).programName || "").trim(),
    projectName: String(linkedLead?.projectName || (lead as any).projectId || "").trim(),
    engagementName: String(linkedLead?.engagementName || (lead as any).engagementName || "").trim(),
    engagementType: String(linkedLead?.engagementType || (lead as any).engagementType || "").trim(),
  };
}

// ─── Excel column → field mapping ────────────────────────────────────────────
const EXCEL_MAP: Record<string, keyof typeof EMPTY_LEAD> = {
  "Lead ID": "leadId",
  "Lead Date": "leadDate",
  "Project Name": "projectId",
  "Project ID": "projectId",
  "Client Name": "accountName",
  "Account Name": "accountName",
  "Program Name": "programName",
  "Engagement Name": "engagementName",
  "Engagement Type": "engagementType",
  "Client SPOC": "clientSpoc",
  "Client Designation": "clientSpocPosition",
  "SPOC Position": "clientSpocPosition",
  "Client Email": "clientEmail",
  "Client Country Code": "clientCountryCode",
  "Email Id": "clientEmail",
  "Client Phone": "clientPhone",
  "Phone Number": "clientPhone",
  "Partner SPOC": "partnerSpoc",
  "Partner Designation": "partnerSpocPosition",
  "Partner SPOC Position": "partnerSpocPosition",
  "Partner Email": "partnerEmail",
  "Partner Country Code": "partnerCountryCode",
  "Partner Email Id": "partnerEmail",
  "Partner Phone": "partnerPhone",
  "Partner Phone Number": "partnerPhone",
  "Status": "status",
  "Prospect Type": "prospectType",
  "Handled By": "handledBy",
  "Managed By": "managedBy",
  "URL": "url",
  "Follow Up Date": "followUpDate",
  "Follow Up Time": "followUpTime",
  "Remarks": "remarks",
};

function normalizeExcelHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeImportedDate(value: unknown) {
  if (!value) return "";

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  const raw = String(value).trim();
  if (!raw) return "";

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const slashMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slashMatch) {
    const [, monthValue, dayValue, yearValue] = slashMatch;
    const year = yearValue.length === 2 ? `20${yearValue}` : yearValue;
    return `${year}-${monthValue.padStart(2, "0")}-${dayValue.padStart(2, "0")}`;
  }

  return raw;
}

function generateTimelineId() {
  return `TL_${Date.now()}_${Math.floor(Math.random() * 9000 + 1000)}`;
}

function formatPhoneWithCountryCode(countryCode?: string, phone?: string) {
  const code = String(countryCode || "").trim();
  const number = String(phone || "").trim();
  if (!code) return number;
  if (!number) return code;
  return `${code} ${number}`;
}

function isPastDateTime(date: string, time: string) {
  if (!date) return false;
  const now = new Date();
  const candidate = new Date(`${date}T${time || "00:00"}`);
  return candidate.getTime() < now.getTime();
}

function normalizeMatchValue(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ");
}

function normalizeEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function normalizePhone(value: unknown) {
  return String(value || "").replace(/[^\d]/g, "");
}

function normalizeWebsiteUrl(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const withoutProtocol = raw.replace(/^https?:\/\//i, "");
  if (/^www\./i.test(withoutProtocol)) return withoutProtocol;
  if (/^[a-z0-9][a-z0-9-]*(\.[a-z0-9-]+)+([/?#].*)?$/i.test(withoutProtocol)) {
    return `www.${withoutProtocol.replace(/^www\./i, "")}`;
  }
  return raw;
}

function isPrimaryAdminUsername(value: unknown) {
  return String(value || "").trim().toLowerCase() === "admin";
}

function normalizeImportedStatus(value: unknown) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "";
  if (normalized === "prospect") return "Prospect";
  if (normalized === "active") return "Active";
  if (normalized === "inactive" || normalized === "in-active") return "Inactive";
  if (normalized === "test") return "Test";
  if (normalized === "hold" || normalized === "on hold") return "Hold";
  if (normalized === "converted to deal" || normalized === "converted") return "Converted to Deal";
  return String(value || "").trim();
}

function normalizeStageLabel(value: string) {
  return value === "Initial Call" ? "Initiation" : value;
}

function normalizeLeadTimelineEntries(entries: any[] = []): LeadTimelineEntry[] {
  return entries.map((entry, index) => {
    const createdAt = entry.createdAt || entry.timestamp || new Date().toISOString();
    const category = String(entry.category || entry.type || "note").toLowerCase() as TimelineCategory;
    return {
      id: entry.id || `${createdAt}_${index}`,
      category,
      title: normalizeStageLabel(entry.title || entry.type || category),
      description: normalizeLeadTextRichV2(entry.description || ""),
      date: entry.date || createdAt.slice(0, 10),
      time: entry.time || "",
      place: entry.place || "",
      createdAt,
      createdBy: entry.createdBy || entry.actionBy || "",
      assignedTo: entry.assignedTo || "",
      followUpDate: entry.followUpDate || "",
      followUpTime: entry.followUpTime || "",
    };
  });
}

function createLeadTimelineEntry(
  userName: string,
  category: TimelineCategory,
  title: string,
  description: string,
  overrides: Partial<LeadTimelineEntry> = {}
): LeadTimelineEntry {
  return {
    id: generateTimelineId(),
    category,
    title,
    description: normalizeLeadTextRichV2(description),
    date: overrides.date || new Date().toISOString().slice(0, 10),
    time: overrides.time || "",
    place: overrides.place || "",
    createdAt: overrides.createdAt || new Date().toISOString(),
    createdBy: overrides.createdBy || userName,
    assignedTo: overrides.assignedTo || "",
    followUpDate: overrides.followUpDate || "",
    followUpTime: overrides.followUpTime || "",
  };
}

function getLatestLeadAction(actions: any[] = []) {
  return normalizeLeadTimelineEntries(actions)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] || null;
}

function getLatestAssignedLeadAction(actions: any[] = []) {
  return normalizeLeadTimelineEntries(actions)
    .filter((entry) => String(entry.assignedTo || "").trim())
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] || null;
}

function buildProspectLinkedLeadPayload(
  lead: Partial<Lead>,
  prospectDocId: string,
  detailSource?: Partial<Lead>
): ProspectLinkedLead | null {
  const linkedLeadId = String(lead.leadId || "").trim();
  if (!linkedLeadId) return null;
  const now = new Date().toISOString();
  const details = detailSource || lead;
  return {
    linkedLeadId,
    prospectLeadId: linkedLeadId,
    prospectDocId,
    accountName: String(lead.accountName || "").trim(),
    programName: String((details as any).programName || "").trim(),
    projectName: String((details as any).projectId || "").trim(),
    engagementName: String((details as any).engagementName || "").trim(),
    engagementType: String((details as any).engagementType || "").trim(),
    source: "prospect",
    createdAt: String((lead as any).createdAt || now),
    updatedAt: now,
  };
}

function buildProspectDocumentPayload(lead: Partial<Lead>) {
  const { programName, projectId, engagementName, engagementType, ...rest } = lead as any;
  return rest;
}

function getLeadImportIdentity(lead: Partial<typeof EMPTY_LEAD>) {
  if (String(lead.leadId || "").trim()) return `leadId:${String(lead.leadId).trim()}`;
  const email = normalizeEmail(lead.clientEmail);
  if (email) return `email:${email}`;
  const accountName = normalizeMatchValue(lead.accountName);
  const projectId = normalizeMatchValue(lead.projectId);
  if (accountName && projectId) return `accountProject:${accountName}::${projectId}`;
  const phone = normalizePhone(lead.clientPhone);
  if (accountName && phone) return `accountPhone:${accountName}::${phone}`;
  if (accountName) return `account:${accountName}`;
  return "";
}

function mergeImportedLead(existingLead: Lead, importedLead: Partial<typeof EMPTY_LEAD>) {
  const merged: any = { ...existingLead };
  for (const key of Object.keys(EMPTY_LEAD) as Array<keyof typeof EMPTY_LEAD>) {
    const nextValue = importedLead[key];
    if (typeof nextValue === "string") {
      if (nextValue.trim() !== "") {
        merged[key] = nextValue;
      }
    } else if (nextValue !== undefined && nextValue !== null) {
      merged[key] = nextValue;
    }
  }
  merged.leadId = existingLead.leadId || importedLead.leadId || generateLeadId();
  merged.createdAt = existingLead.createdAt || new Date().toISOString();
  merged.updatedAt = new Date().toISOString();
  return merged;
}

function hasImportedLeadChanges(existingLead: Lead, mergedLead: Lead) {
  for (const key of Object.keys(EMPTY_LEAD) as Array<keyof typeof EMPTY_LEAD>) {
    if (String(existingLead[key] || "") !== String(mergedLead[key] || "")) {
      return true;
    }
  }
  return false;
}

function normalizeLeadText(value: string) {
  const lines = String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u00A0/g, " ")
    .split("\n");
  const normalized: string[] = [];
  for (const line of lines) {
    const cleaned = line.replace(/\t/g, " ").replace(/[ ]{2,}/g, " ").trim();
    if (!cleaned) {
      if (normalized[normalized.length - 1] !== "") normalized.push("");
      continue;
    }
    const bulletMatch = cleaned.match(/^([•◦▪▫‣⁃·*-]|\d+[.)]|[a-zA-Z][.)])\s*(.*)$/);
    if (bulletMatch) {
      const bulletBody = bulletMatch[2].trim();
      normalized.push(bulletBody ? `• ${bulletBody}` : "•");
      continue;
    }
    normalized.push(cleaned);
  }
  return normalized.join("\n").trim();
}

function handleNormalizedTextareaPaste(
  event: React.ClipboardEvent<HTMLTextAreaElement>,
  currentValue: string,
  setValue: (value: string) => void
) {
  event.preventDefault();
  const pasted = normalizeLeadText(event.clipboardData.getData("text/plain"));
  const target = event.currentTarget;
  const start = target.selectionStart ?? currentValue.length;
  const end = target.selectionEnd ?? currentValue.length;
  const nextValue = `${currentValue.slice(0, start)}${pasted}${currentValue.slice(end)}`;
  setValue(normalizeLeadText(nextValue));
}

function getRemarksPreview(value?: string, maxLength = 140) {
  const normalized = normalizeLeadTextRichV2(String(value || ""));
  if (!normalized) return "";
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength).trimEnd()}...` : normalized;
}

function normalizeLeadTextRich(value: string) {
  const lines = String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u00A0/g, " ")
    .split("\n");
  const normalized: string[] = [];
  for (const line of lines) {
    const cleaned = line.replace(/\t/g, " ").replace(/[ ]{2,}/g, " ").trim();
    if (!cleaned) {
      if (normalized[normalized.length - 1] !== "") normalized.push("");
      continue;
    }
    const bulletMatch = cleaned.match(/^([\u2022\u25E6\u25AA\u25AB\u2023\u2043\u00B7*-]|\d+[.)]|[a-zA-Z][.)])\s*(.*)$/u);
    if (bulletMatch) {
      const bulletBody = bulletMatch[2].trim();
      normalized.push(bulletBody ? `• ${bulletBody}` : "•");
      continue;
    }
    normalized.push(cleaned);
  }
  return normalized.join("\n").trim();
}

function extractClipboardTextRich(clipboardData: DataTransfer) {
  const html = clipboardData.getData("text/html");
  if (html && /<li[\s>]/i.test(html)) {
    const container = document.createElement("div");
    container.innerHTML = html;
    const items = Array.from(container.querySelectorAll("li"))
      .map((item) => normalizeLeadTextRich(item.textContent || ""))
      .filter(Boolean);
    if (items.length) {
      return items.map((item) => `• ${item.replace(/^•\s*/, "")}`).join("\n");
    }
  }
  return clipboardData.getData("text/plain");
}

function handleNormalizedTextareaPasteRich(
  event: React.ClipboardEvent<HTMLTextAreaElement>,
  currentValue: string,
  setValue: (value: string) => void
) {
  event.preventDefault();
  const pasted = normalizeLeadTextRich(extractClipboardTextRich(event.clipboardData));
  const target = event.currentTarget;
  const start = target.selectionStart ?? currentValue.length;
  const end = target.selectionEnd ?? currentValue.length;
  const nextValue = `${currentValue.slice(0, start)}${pasted}${currentValue.slice(end)}`;
  setValue(normalizeLeadTextRich(nextValue));
}

function normalizeLeadTextRichV2(value: string) {
  const lines = String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u00A0/g, " ")
    .split("\n");
  const normalized: string[] = [];
  for (const line of lines) {
    const cleaned = line.replace(/\t/g, " ").replace(/[ ]{2,}/g, " ").trim();
    if (!cleaned) {
      if (normalized[normalized.length - 1] !== "") normalized.push("");
      continue;
    }
    const bulletMatch = cleaned.match(/^([\u2022\u25E6\u25AA\u25AB\u2023\u2043\u00B7*-]|\d+[.)]|[a-zA-Z][.)])\s*(.*)$/u);
    if (bulletMatch) {
      const bulletBody = bulletMatch[2].trim();
      normalized.push(bulletBody ? `\u2022 ${bulletBody}` : "\u2022");
      continue;
    }
    normalized.push(cleaned);
  }
  return normalized.join("\n").trim();
}

function extractClipboardTextRichV2(clipboardData: DataTransfer) {
  const html = clipboardData.getData("text/html");
  if (html && /<li[\s>]/i.test(html)) {
    const container = document.createElement("div");
    container.innerHTML = html;
    const items = Array.from(container.querySelectorAll("li"))
      .map((item) => normalizeLeadTextRichV2(item.textContent || ""))
      .filter(Boolean);
    if (items.length) {
      return items.map((item) => `\u2022 ${item.replace(/^\u2022\s*/, "")}`).join("\n");
    }
  }
  return clipboardData.getData("text/plain");
}

function handleNormalizedTextareaPasteRichV2(
  event: React.ClipboardEvent<HTMLTextAreaElement>,
  currentValue: string,
  setValue: (value: string) => void
) {
  event.preventDefault();
  const pasted = normalizeLeadTextRichV2(extractClipboardTextRichV2(event.clipboardData));
  const target = event.currentTarget;
  const start = target.selectionStart ?? currentValue.length;
  const end = target.selectionEnd ?? currentValue.length;
  const nextValue = `${currentValue.slice(0, start)}${pasted}${currentValue.slice(end)}`;
  setValue(normalizeLeadTextRichV2(nextValue));
}

const NORMALIZED_EXCEL_MAP = Object.fromEntries(
  Object.entries(EXCEL_MAP).map(([column, field]) => [normalizeExcelHeader(column), field])
) as Record<string, keyof typeof EMPTY_LEAD>;

// ─── helpers ─────────────────────────────────────────────────────────────────
function generateLeadId() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}_LEAD_${Math.floor(Math.random() * 9000 + 1000)}`;
}

// ─── Tooltip component ───────────────────────────────────────────────────────
function Tooltip({ text }: { text: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <span style={{ position: "relative", display: "inline-flex", alignItems: "center", marginLeft: 5 }}>
      <span
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
        style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 15, height: 15, borderRadius: "50%", background: "#e2e8f0", color: "#64748b", fontSize: 10, fontWeight: 700, cursor: "default", userSelect: "none", flexShrink: 0 }}
      >
        i
      </span>
      {visible && (
        <span style={{ position: "fixed", background: "#0f172a", color: "#fff", fontSize: 11, padding: "6px 10px", borderRadius: 6, whiteSpace: "nowrap", zIndex: 9999, pointerEvents: "none", boxShadow: "0 4px 12px rgba(0,0,0,0.3)", transform: "translateY(-120%)", marginLeft: -8 }}>
          {text}
          <span style={{ position: "absolute", top: "100%", left: 12, borderWidth: 4, borderStyle: "solid", borderColor: "#0f172a transparent transparent transparent" }} />
        </span>
      )}
    </span>
  );
}

export default function LeadDashboard({ onNavigate }: { onNavigate: (p: Page, leadId?: string) => void }) {
  const user    = getSessionUser();
  const isAdmin = user.role === "admin";
  const isSuperAdmin = isPrimaryAdmin(user);
  const [showPasswordModal, setShowPasswordModal] = useState(false);

  const [leads, setLeads] = useState<Lead[]>([]);
  const [transactions, setTransactions] = useState<LeadTransactionRef[]>([]);
  const [linkedLeads, setLinkedLeads] = useState<Record<string, ProspectLinkedLead>>({});
  const [statusFilter, setStatusFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState(createEmptyLead());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [savingLead, setSavingLead] = useState(false);
  const [deleteModal, setDeleteModal] = useState<{ lead: Lead; txnCount: number } | null>(null);
  const [showColModal, setShowColModal] = useState(false);
  const [handledByFilter, setHandledByFilter] = useState("All");
  const [expandedRemarks, setExpandedRemarks] = useState<Record<string, boolean>>({});
  const [expandedLastActionComments, setExpandedLastActionComments] = useState<Record<string, boolean>>({});
  const [activeAction, setActiveAction] = useState<"Note" | "Call" | "Meeting" | null>(null);
  const [manualActionTimestampMode, setManualActionTimestampMode] = useState(false);
  const [editingProspectNoteId, setEditingProspectNoteId] = useState<string | null>(null);
  const [editingProspectNoteDescription, setEditingProspectNoteDescription] = useState("");
  const [actionDate, setActionDate] = useState(new Date().toISOString().slice(0, 10));
  const [actionTime, setActionTime] = useState(new Date().toTimeString().slice(0, 5));
  const [actionDescription, setActionDescription] = useState("");
  const [actionFollowUpDate, setActionFollowUpDate] = useState("");
  const [actionFollowUpTime, setActionFollowUpTime] = useState("");
  const [meetingPlace, setMeetingPlace] = useState("");
  const [actionAssignedTo, setActionAssignedTo] = useState("");
  const [assignableUsers, setAssignableUsers] = useState<string[]>([]);
  const [visibleCols, setVisibleCols] = useState<Record<string, boolean>>({
    // Prospect Info
    "Prospect Date": true, "Client Name": true, "Initiated By": true, "Managed By": true, "Status": true, "Last Action Comment": true, "Remarks": true,
    // Client SPOC
    "Client SPOC": true, "Client Email": true, "Client Phone": true,
    // Partner SPOC
    "Partner SPOC": true, "Partner Designation": true, "Partner Email": true, "Partner Phone": true,
  });
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const handleHiddenTimestampShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "t") {
        event.preventDefault();
        setManualActionTimestampMode((prev) => !prev);
      }
    };

    window.addEventListener("keydown", handleHiddenTimestampShortcut);
    return () => window.removeEventListener("keydown", handleHiddenTimestampShortcut);
  }, []);
  const importRef = useRef<HTMLInputElement>(null);
  const formErrorSummary =
    Object.values(formErrors).find((value) => String(value || "").trim()) ||
    (importResult && !importResult.startsWith("✅") ? importResult : "");
  const formErrorList = Array.from(
    new Set(
      Object.values(formErrors)
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )
  );

  const syncLinkedLeadRecord = async (lead: Partial<Lead>, prospectDocId: string, detailSource?: Partial<Lead>) => {
    const payload = buildProspectLinkedLeadPayload(lead, prospectDocId, detailSource);
    if (!payload) return;
    await setDoc(doc(db, LINKED_LEAD_COLLECTION, payload.linkedLeadId), payload, { merge: true });
  };

  // ── Realtime Firebase listener ──
  useEffect(() => {
    const unsub = onSnapshot(collection(db, COLLECTION), (snap) => {
      setLeads(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Lead)));
      setLoading(false);
    });
    const unsubTxn = onSnapshot(collection(db, "transactions"), (snap) => {
      setTransactions(
        snap.docs.map((d) => ({
          leadId: d.data().leadId,
          transactionId: d.data().transactionId || d.id,
          createdAt: d.data().createdAt,
          updatedAt: d.data().updatedAt,
          handledBy: d.data().handledBy,
          actions: Array.isArray(d.data().actions) ? d.data().actions : [],
        }))
      );
    });
    const unsubLinked = onSnapshot(collection(db, LINKED_LEAD_COLLECTION), (snap) => {
      const next: Record<string, ProspectLinkedLead> = {};
      snap.docs.forEach((docSnap) => {
        next[docSnap.id] = docSnap.data() as ProspectLinkedLead;
      });
      setLinkedLeads(next);
    });
    const unsubUsers = onSnapshot(collection(db, "users"), (snap) => {
      const nextUsers = snap.docs
        .map((docSnap) => String((docSnap.data() as any).username || "").trim())
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));
      setAssignableUsers(nextUsers);
    });
    return () => { unsub(); unsubTxn(); unsubLinked(); unsubUsers(); };
  }, []);

  useEffect(() => {
    if (!editingId || !importResult) return;
    const latestLead = leads.find((lead) => lead.id === editingId);
    if (!latestLead) return;
    setFormData({ ...latestLead });
  }, [leads, editingId, importResult]);

  const openLeadActions = (lead: Lead) => {
    const relatedTransactions = transactions
      .filter((transaction) => transaction.leadId === lead.leadId)
      .sort((a, b) => {
        const aTime = new Date(a.updatedAt || a.createdAt || 0).getTime();
        const bTime = new Date(b.updatedAt || b.createdAt || 0).getTime();
        return bTime - aTime;
      });

    if (relatedTransactions.length > 0) {
      onNavigate("activityDetail", relatedTransactions[0].transactionId);
      return;
    }

    onNavigate("transactions", lead.leadId);
  };

  const getProspectAssignableUsers = (leadDraft: Partial<Lead>) => {
    if (isSuperAdmin) return assignableUsers;
    const collaborators = getRecordCollaborators(
      String((leadDraft as any).handledBy || "").trim(),
      ((leadDraft as any).actions || []) as Array<{ assignedTo?: string | null }>
    );
    if (collaborators.length <= 1) return assignableUsers;
    return assignableUsers.filter((username) => collaborators.includes(username));
  };

  const selectedRecordViewableByUsers = Array.from(
    new Set(
      (Array.isArray((formData as any).recordViewableBy) ? (formData as any).recordViewableBy : [])
        .map((value: string) => String(value || "").trim())
        .filter((value: string) => Boolean(value) && !isPrimaryAdminUsername(value))
    )
  );
  const canEditRecordViewableBy =
    isSuperAdmin ||
    String((formData as any).handledBy || "").trim().toLowerCase() === String(user.username || "").trim().toLowerCase() ||
    String((formData as any).managedBy || "").trim().toLowerCase() === String(user.username || "").trim().toLowerCase();
  const recordViewableByOptions = assignableUsers.filter(
    (username) => !isPrimaryAdminUsername(username) && !selectedRecordViewableByUsers.includes(username)
  );

  // ── Filtered + sorted leads ──
  const visibleLeads = leads.filter((lead) => canUserSeeProspect(user, lead as any));

  const handledByOptions = Array.from(
    new Set(
      visibleLeads
        .map((lead) => String((lead as any).handledBy || "").trim())
        .filter(Boolean)
        .filter((value) => isAdmin || value === user.username)
    )
  ).sort((a, b) => a.localeCompare(b));

  const filtered = visibleLeads
    .filter((l) => {
      const linkedDetails = getLeadDisplayDetails(l, linkedLeads[l.leadId]);
      if (statusFilter !== "All" && l.status !== statusFilter) return false;
      if (handledByFilter !== "All" && String((l as any).handledBy || "").trim() !== handledByFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          l.leadId?.toLowerCase().includes(q) ||
          linkedDetails.programName.toLowerCase().includes(q) ||
          l.accountName?.toLowerCase().includes(q) ||
          linkedDetails.engagementName.toLowerCase().includes(q) ||
          l.clientSpoc?.toLowerCase().includes(q) ||
          l.partnerSpoc?.toLowerCase().includes(q) ||
          String((l as any).handledBy || "").toLowerCase().includes(q)
        );
      }
      return true;
    })
    .sort((a, b) => {
      const order: Record<string, number> = { Active: 1, Inactive: 2 };
      const statusDiff = (order[a.status] ?? 9) - (order[b.status] ?? 9);
      if (statusDiff !== 0) return statusDiff;

      const aCreated = new Date(a.createdAt || 0).getTime();
      const bCreated = new Date(b.createdAt || 0).getTime();
      return bCreated - aCreated;
    });

  // ── Add / Edit lead ──
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingLead) return;
    // ── Validation ──
    const errors: Record<string, string> = {};
    if (!String(formData.leadDate || "").trim()) {
      errors.leadDate = "Please select the prospect date";
    }
    if (!String((formData as any).handledBy || "").trim()) {
      errors.handledBy = "Initiated By is required";
    }
    if (formData.clientEmail && !formData.clientEmail.includes("@")) {
      errors.clientEmail = "Please enter a valid email address containing @";
    }
    if (formData.clientCountryCode && !/^\+?\d{1,4}$/.test(formData.clientCountryCode.trim())) {
      errors.clientCountryCode = "Country code must be digits and may start with +";
    }
    if (formData.clientPhone && !/^[\d ]+$/.test(formData.clientPhone)) {
      errors.clientPhone = "Phone number can contain digits and spaces only";
    }
    if (formData.partnerEmail && !formData.partnerEmail.includes("@")) {
      errors.partnerEmail = "Please enter a valid email address containing @";
    }
    if (formData.partnerCountryCode && !/^\+?\d{1,4}$/.test(formData.partnerCountryCode.trim())) {
      errors.partnerCountryCode = "Country code must be digits and may start with +";
    }
    if (formData.partnerPhone && !/^[\d ]+$/.test(formData.partnerPhone)) {
      errors.partnerPhone = "Phone number can contain digits and spaces only";
    }
    const normalizedUrl = normalizeWebsiteUrl(formData.url);
    if (normalizedUrl && !/^www\.[^\s]+\.[^\s]+$/i.test(normalizedUrl)) {
      errors.url = "Please enter a valid website URL";
    }
    if (!editingId && !formData.prospectType.trim()) {
      errors.prospectType = "Please select the prospect type";
    }
    if (formData.followUpDate && formData.followUpTime && isPastDateTime(formData.followUpDate, formData.followUpTime)) {
      errors.followUpDate = "Follow-up date and time cannot be in the past";
    }
    if ((formData.followUpDate && !formData.followUpTime) || (!formData.followUpDate && formData.followUpTime)) {
      errors.followUpDate = "Please enter both follow-up date and follow-up time";
    }
    if (formData.followUpDate && !isBusinessDay(formData.followUpDate)) {
      errors.followUpDate = getBusinessDayError(formData.followUpDate);
    }

    const currentClientPhone = normalizePhone(formData.clientPhone);
    if (currentClientPhone) {
      const duplicateLead = leads.find((lead) => lead.id !== editingId && normalizePhone(lead.clientPhone) === currentClientPhone);
      if (duplicateLead) {
        errors.clientPhone = `This phone number already exists for ${duplicateLead.accountName}`;
      }
    }
    const currentPartnerPhone = normalizePhone(formData.partnerPhone);
    if (currentPartnerPhone) {
      const duplicatePartnerLead = leads.find((lead) => lead.id !== editingId && normalizePhone(lead.partnerPhone) === currentPartnerPhone);
      if (duplicatePartnerLead) {
        errors.partnerPhone = `This phone number already exists for ${duplicatePartnerLead.accountName}`;
      }
    }
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      setImportResult("Please fix the highlighted fields before saving.");
      return;
    }
    setFormErrors({});
    setImportResult(null);

    const previousLead = editingId ? leads.find(l => l.id === editingId) || null : null;
    let statusComment = String((formData as any).statusComment || "").trim();
    const previousStatus = previousLead?.status || "Active";
    if (previousStatus === "Active" && formData.status === "Inactive" && !statusComment) {
      setFormErrors((prev) => ({
        ...prev,
        statusComment: "Inactive comment is required when changing status from Active to Inactive",
      }));
      return;
    }

    const followUpChanged =
      String((previousLead as any)?.followUpDate || "") !== String((formData as any).followUpDate || "") ||
      String((previousLead as any)?.followUpTime || "") !== String((formData as any).followUpTime || "");
    const nextFollowUpOwnerUsername =
      (formData as any).followUpDate || (formData as any).followUpTime
        ? followUpChanged
          ? user.username
          : String((previousLead as any)?.followUpOwnerUsername || user.username)
        : "";

    const payload = {
      ...formData,
      remarks: normalizeLeadTextRichV2(formData.remarks || ""),
      prospectType: formData.prospectType.trim(),
      handledBy: String((formData as any).handledBy || "").trim(),
      url: normalizeWebsiteUrl((formData as any).url),
      recordViewableBy: Array.from(
        new Set(
          (Array.isArray((formData as any).recordViewableBy) ? (formData as any).recordViewableBy : [])
            .map((value: string) => String(value || "").trim())
            .filter((value: string) => Boolean(value) && !isPrimaryAdminUsername(value))
        )
      ),
      followUpOwnerUsername: nextFollowUpOwnerUsername,
      statusComment,
      actions: normalizeLeadTimelineEntries((formData as any).actions || []),
      leadId: formData.leadId || generateLeadId(),
      leadDate: formData.leadDate || new Date().toISOString().slice(0, 10),
      updatedAt: new Date().toISOString(),
    };
    const prospectPayload = buildProspectDocumentPayload(payload);
    setSavingLead(true);
    try {
      if (editingId) {
        await updateDoc(doc(db, COLLECTION, editingId), prospectPayload);
        await syncLinkedLeadRecord(prospectPayload as Lead, editingId, payload as Lead);
        await logActivity(payload.leadId, payload.accountName, "leads", {
          actionType: "LEAD_EDITED",
          description: `Lead "${payload.accountName}" was edited`,
          previousValue: previousLead?.accountName,
          newValue: payload.accountName,
          actionBy: user.username,
          timestamp: new Date().toISOString(),
        });
        if (previousStatus !== payload.status) {
          await logActivity(payload.leadId, payload.accountName, "leads", {
            actionType: "LEAD_STATUS_CHANGED",
            description: `Status changed from "${previousStatus}" to "${payload.status}"${statusComment ? `. Comment: ${statusComment}` : ""}`,
            previousValue: previousStatus,
            newValue: payload.status,
            actionBy: user.username,
            timestamp: new Date().toISOString(),
          });
        }
      } else {
        const createdPayload = {
          ...prospectPayload,
          createdAt: new Date().toISOString(),
        };
        const createdRef = await addDoc(collection(db, COLLECTION), createdPayload);
        await syncLinkedLeadRecord(createdPayload as Lead, createdRef.id, { ...payload, createdAt: createdPayload.createdAt } as Lead);
        await logActivity(payload.leadId, payload.accountName, "leads", {
          actionType: "LEAD_ADDED",
          description: `New lead "${payload.accountName}" was added`,
          actionBy: user.username,
          timestamp: new Date().toISOString(),
        });
      }
      resetForm();
      setImportResult(null);
    } catch (error: any) {
      console.error("save prospect error:", error);
      setImportResult(
        error?.message
          ? `Failed to save prospect. ${error.message}`
          : "Failed to save prospect. Please try again."
      );
    } finally {
      setSavingLead(false);
    }
  };

  const resetForm = () => {
    setFormData({
      ...createEmptyLead(),
      handledBy: String(user.username || "").trim(),
    });
    setEditingId(null);
    setShowForm(false);
    setFormErrors({});
    setActiveAction(null);
    setActionDescription("");
    setMeetingPlace("");
    setActionFollowUpDate("");
    setActionFollowUpTime("");
  };

  const startEdit = (lead: Lead) => {
    setFormData({ ...lead, actions: normalizeLeadTimelineEntries((lead as any).actions || []) });
    setEditingId(lead.id);
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // ── Delete: opens modal with reason, warns if lead has transactions ──
  const deleteLead = (lead: Lead) => {
    const txnCount = transactions.filter(t => t.leadId === lead.leadId).length;
    setDeleteModal({ lead, txnCount });
  };

  const confirmDeleteLead = async (reason: string) => {
    if (!deleteModal) return;
    const { lead } = deleteModal;
    await logActivity(lead.leadId, lead.accountName, "leads", {
      actionType: "LEAD_DELETED",
      description: `Lead "${lead.accountName}" was deleted. Reason: ${reason}`,
      actionBy: user.username,
      timestamp: new Date().toISOString(),
    });
    await deleteDoc(doc(db, COLLECTION, lead.id));
    if (lead.leadId) {
      await deleteDoc(doc(db, LINKED_LEAD_COLLECTION, lead.leadId));
    }
    setDeleteModal(null);
  };

  // ── Status update ──
  const updateStatus = async (lead: Lead, newStatus: string) => {
    const old = lead.status;
    let statusComment = String((lead as any).statusComment || "").trim();
    if (old === "Active" && newStatus === "Inactive") {
      const promptValue = window.prompt("Please enter a comment before changing this prospect from Active to Inactive.", statusComment);
      if (!promptValue || !promptValue.trim()) return;
      statusComment = promptValue.trim();
    }
    await updateDoc(doc(db, COLLECTION, lead.id), {
      status: newStatus,
      statusComment,
      updatedAt: new Date().toISOString(),
    });
    await logActivity(lead.leadId, lead.accountName, "leads", {
      actionType: "LEAD_STATUS_CHANGED",
      description: `Status changed from "${old}" → "${newStatus}"${statusComment ? `. Comment: ${statusComment}` : ""}`,
      previousValue: old,
      newValue: newStatus,
      actionBy: user.username,
      timestamp: new Date().toISOString(),
    });
  };

  // ── Excel Export — respects both status filter and visible columns ──
  const downloadExcel = () => {
    // Full row map
    const allCols: Record<string, (l: Lead) => any> = {
      "Prospect Date":      (l) => l.leadDate || "",
      "Client Name":        (l) => l.accountName,
      "Program Name":       (l) => getLeadDisplayDetails(l, linkedLeads[l.leadId]).programName,
      "Project Name":       (l) => getLeadDisplayDetails(l, linkedLeads[l.leadId]).projectName,
      "Engagement Name":    (l) => getLeadDisplayDetails(l, linkedLeads[l.leadId]).engagementName,
      "Engagement Type":    (l) => getLeadDisplayDetails(l, linkedLeads[l.leadId]).engagementType,
      "Initiated By":       (l) => (l as any).handledBy || "",
      "URL":                (l) => (l as any).url || "",
      "Client SPOC":        (l) => l.clientSpoc,
      "Client Designation": (l) => l.clientSpocPosition,
      "Client Email":       (l) => l.clientEmail,
      "Client Phone":       (l) => formatPhoneWithCountryCode((l as any).clientCountryCode, l.clientPhone),
      "Partner SPOC":       (l) => l.partnerSpoc,
      "Partner Designation":(l) => l.partnerSpocPosition,
      "Partner Email":      (l) => l.partnerEmail,
      "Partner Phone":      (l) => formatPhoneWithCountryCode((l as any).partnerCountryCode, l.partnerPhone),
      "Status":             (l) => l.status,
      "Prospect Type":      (l) => (l as any).prospectType || "",
      "Follow-up Date":     (l) => (l as any).followUpDate || "",
      "Follow-up Time":     (l) => (l as any).followUpTime || "",
      "Remarks":            (l) => normalizeLeadTextRichV2(l.remarks || ""),
    };
    // Only export visible columns
    const visibleKeys = Object.keys(allCols).filter(k => visibleCols[k]);
    const rows = filtered.map((l) =>
      Object.fromEntries(visibleKeys.map(k => [k, allCols[k](l)]))
    );
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Prospects");
    XLSX.writeFile(wb, `Prospects_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  // ── Excel Import ──
  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportResult(null);

    try {
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data, { cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: any[] = XLSX.utils.sheet_to_json(ws, { defval: "", raw: false });

      const existingByLeadId = new Map<string, Lead>();
      const existingByEmail = new Map<string, Lead>();
      const existingByAccountProject = new Map<string, Lead>();
      const existingByAccountPhone = new Map<string, Lead>();
      const existingByAccount = new Map<string, Lead>();
      const seenImportKeys = new Set<string>();

      for (const existingLead of leads) {
        const existingLeadId = String(existingLead.leadId || "").trim();
        if (existingLeadId) existingByLeadId.set(existingLeadId, existingLead);

        const existingEmail = normalizeEmail(existingLead.clientEmail);
        if (existingEmail) existingByEmail.set(existingEmail, existingLead);

        const existingAccountName = normalizeMatchValue(existingLead.accountName);
        const existingProjectId = normalizeMatchValue(existingLead.projectId);
        const existingPhone = normalizePhone(existingLead.clientPhone);

        if (existingAccountName && existingProjectId) {
          existingByAccountProject.set(`${existingAccountName}::${existingProjectId}`, existingLead);
        }
        if (existingAccountName && existingPhone) {
          existingByAccountPhone.set(`${existingAccountName}::${existingPhone}`, existingLead);
        }
        if (existingAccountName) {
          existingByAccount.set(existingAccountName, existingLead);
        }
      }

      let createdCount = 0;
      let updatedCount = 0;
      let duplicateSkippedCount = 0;
      let unchangedSkippedCount = 0;
      for (const row of rows) {
        const normalizedRow = Object.fromEntries(
          Object.entries(row).map(([column, value]) => [normalizeExcelHeader(column), value])
        ) as Record<string, any>;

        const lead: any = {
          ...EMPTY_LEAD,
          status: "Active",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        for (const [col, field] of Object.entries(NORMALIZED_EXCEL_MAP)) {
          if (normalizedRow[col] === undefined) continue;
          lead[field] =
            field === "leadDate"
              ? normalizeImportedDate(normalizedRow[col])
              : String(normalizedRow[col]).trim();
        }

        if (normalizedRow["emailid1"] !== undefined) lead.partnerEmail = String(normalizedRow["emailid1"]).trim();
        if (normalizedRow["phonenumber1"] !== undefined) lead.partnerPhone = String(normalizedRow["phonenumber1"]).trim();
        if (normalizedRow["spocposition1"] !== undefined) lead.partnerSpocPosition = String(normalizedRow["spocposition1"]).trim();

        const unnamedStatus = normalizeImportedStatus(normalizedRow["empty"]);
        if (unnamedStatus && STATUSES.includes(unnamedStatus)) {
          lead.status = unnamedStatus;
        } else {
          lead.status = normalizeImportedStatus(lead.status || "Active") || "Active";
        }

        const hasContent = Object.entries(lead).some(([key, value]) => (
          !["createdAt", "updatedAt", "status"].includes(key) && String(value || "").trim() !== ""
        ));
        if (!hasContent) continue;

        const importIdentity = getLeadImportIdentity(lead);
        if (importIdentity) {
          if (seenImportKeys.has(importIdentity)) {
            duplicateSkippedCount++;
            continue;
          }
          seenImportKeys.add(importIdentity);
        }

        let matchedLead: Lead | undefined;
        const leadId = String(lead.leadId || "").trim();
        const email = normalizeEmail(lead.clientEmail);
        const accountName = normalizeMatchValue(lead.accountName);
        const projectId = normalizeMatchValue(lead.projectId);
        const phone = normalizePhone(lead.clientPhone);

        if (leadId) matchedLead = existingByLeadId.get(leadId);
        if (!matchedLead && email) matchedLead = existingByEmail.get(email);
        if (!matchedLead && accountName && projectId) {
          matchedLead = existingByAccountProject.get(`${accountName}::${projectId}`);
        }
        if (!matchedLead && accountName && phone) {
          matchedLead = existingByAccountPhone.get(`${accountName}::${phone}`);
        }
        if (!matchedLead && accountName) {
          matchedLead = existingByAccount.get(accountName);
        }

        if (matchedLead) {
          const mergedLead = mergeImportedLead(matchedLead, lead);
          if (!hasImportedLeadChanges(matchedLead, mergedLead)) {
            unchangedSkippedCount++;
            continue;
          }
          await updateDoc(doc(db, COLLECTION, matchedLead.id), buildProspectDocumentPayload(mergedLead));
          await syncLinkedLeadRecord(buildProspectDocumentPayload(mergedLead) as Lead, matchedLead.id, mergedLead as Lead);
          await logActivity(mergedLead.leadId, mergedLead.accountName, "leads", {
            actionType: "LEAD_EDITED",
            description: `Lead "${mergedLead.accountName}" updated from Excel import`,
            actionBy: user.username,
            timestamp: new Date().toISOString(),
          });
          updatedCount++;
          continue;
        }

        if (!lead.leadId) lead.leadId = generateLeadId();

        const prospectLeadPayload = buildProspectDocumentPayload(lead);
        const leadRef = await addDoc(collection(db, COLLECTION), prospectLeadPayload);
        await syncLinkedLeadRecord(prospectLeadPayload as Lead, leadRef.id, lead as Lead);
        // ── updated logActivity signature ──
        await logActivity(lead.leadId, lead.accountName, "leads", {
          actionType: "LEAD_ADDED",
          description: `Lead "${lead.accountName}" imported from Excel`,
          actionBy: user.username,
          timestamp: new Date().toISOString(),
        });
        createdCount++;
      }
      setImportResult(
        `Import complete. ${createdCount} new lead${createdCount !== 1 ? "s" : ""} created, ${updatedCount} existing lead${updatedCount !== 1 ? "s" : ""} updated, ${unchangedSkippedCount} unchanged row${unchangedSkippedCount !== 1 ? "s" : ""} skipped, ${duplicateSkippedCount} duplicate row${duplicateSkippedCount !== 1 ? "s" : ""} skipped.`
      );
    } catch (err) {
      setImportResult("Import failed. Check your Excel format.");
    } finally {
      setImporting(false);
      if (importRef.current) importRef.current.value = "";
    }
  };

  const openProspectAction = (type: "Note" | "Call" | "Meeting") => {
    setActiveAction(type);
    setActionDescription("");
    setMeetingPlace("");
    setActionAssignedTo("");
    setActionFollowUpDate("");
    setActionFollowUpTime("");
    const now = new Date();
    setActionDate(now.toISOString().slice(0, 10));
    setActionTime(now.toTimeString().slice(0, 5));
  };

  const saveProspectAction = () => {
    if (!activeAction) return;
    const normalizedDescription = normalizeLeadTextRichV2(actionDescription || "");
    if (!normalizedDescription.trim()) {
      setFormErrors((prev) => ({ ...prev, actionDescription: `Please enter ${activeAction.toLowerCase()} details before saving.` }));
      return;
    }
    if ((actionFollowUpDate && !actionFollowUpTime) || (!actionFollowUpDate && actionFollowUpTime)) {
      setFormErrors((prev) => ({ ...prev, actionFollowUpDate: "Please enter both follow-up date and follow-up time." }));
      return;
    }
    if (actionFollowUpDate && actionFollowUpTime && isPastDateTime(actionFollowUpDate, actionFollowUpTime)) {
      setFormErrors((prev) => ({ ...prev, actionFollowUpDate: "Follow-up date and time cannot be in the past." }));
      return;
    }
    if (actionFollowUpDate && !isBusinessDay(actionFollowUpDate)) {
      setFormErrors((prev) => ({ ...prev, actionFollowUpDate: getBusinessDayError(actionFollowUpDate) }));
      return;
    }
    const category = activeAction.toLowerCase() as TimelineCategory;
    const now = new Date();
    const noteUsesManualTimestamp = activeAction === "Note" && manualActionTimestampMode;
    const entryDate = noteUsesManualTimestamp ? actionDate : activeAction === "Note" ? now.toISOString().slice(0, 10) : actionDate;
    const entryTime = noteUsesManualTimestamp ? actionTime : activeAction === "Note" ? now.toTimeString().slice(0, 5) : actionTime;
    const newEntry = createLeadTimelineEntry(user.username, category, activeAction, normalizedDescription, {
      date: entryDate,
      time: entryTime,
      place: activeAction === "Meeting" ? meetingPlace : "",
      assignedTo: activeAction === "Note" ? actionAssignedTo : "",
      followUpDate: actionFollowUpDate,
      followUpTime: actionFollowUpTime,
    });
    setFormData((prev) => ({
      ...prev,
      actions: [...normalizeLeadTimelineEntries((prev as any).actions || []), newEntry],
    }));
    setFormErrors((prev) => {
      const next = { ...prev };
      delete next.actionDescription;
      delete next.actionFollowUpDate;
      return next;
    });
    setActiveAction(null);
    setActionDescription("");
    setMeetingPlace("");
    setActionAssignedTo("");
    setActionFollowUpDate("");
    setActionFollowUpTime("");
  };

  const startEditingProspectNote = (entry: LeadTimelineEntry) => {
    setEditingProspectNoteId(entry.id);
    setEditingProspectNoteDescription(entry.description || "");
    setFormErrors((prev) => ({ ...prev, actionDescription: "" }));
  };

  const cancelEditingProspectNote = () => {
    setEditingProspectNoteId(null);
    setEditingProspectNoteDescription("");
  };

  const saveEditedProspectNote = (entryId: string) => {
    const normalizedDescription = normalizeActionTextRichV2(editingProspectNoteDescription || "");
    if (!normalizedDescription.trim()) {
      setFormErrors((prev) => ({ ...prev, actionDescription: "Please enter note details before saving." }));
      return;
    }
    setFormData((prev) => ({
      ...prev,
      actions: normalizeLeadTimelineEntries((prev as any).actions || []).map((entry) =>
        entry.id === entryId ? { ...entry, description: normalizedDescription } : entry
      ),
    }));
    setEditingProspectNoteId(null);
    setEditingProspectNoteDescription("");
    setFormErrors((prev) => ({ ...prev, actionDescription: "" }));
  };

  const logout = () => {
    signOut(auth);
    localStorage.removeItem("leadUser");
    window.location.reload();
  };

  // ── Stats ──
  const stats = STATUSES.filter((s) => s !== "Prospect").map((s) => ({
    status: s,
    count: visibleLeads.filter((l) => l.status === s).length,
  }));

  // ── Loading state ──
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

  return (
    <div style={S.page}>
      <div style={S.header}>
        <div style={S.headerTop}>
          <div style={S.headerBrandGroup}>
            <div style={S.headerLeft}>
              <img src="/k1.svg" alt="Karuyaki Logo" style={{ height: 36 }} />
              <h1 style={S.headerTitle}>Lead Tracker</h1>
            </div>
            <AppHeaderNav current="leads" onNavigate={onNavigate} isAdmin={isAdmin} />
          </div>
          <div style={S.headerActions}>
            <button onClick={() => setShowPasswordModal(true)} style={S.btnOutline}>Change Password</button>
            <button onClick={logout} style={S.btnLogout}>Logout</button>
          </div>
        </div>
      </div>

      {/* ── Import result ── */}
      {importResult && (
        <div style={{
          padding: "10px 24px",
          background: importResult.startsWith("✅") ? "#f0fdf4" : "#fef2f2",
          color: importResult.startsWith("✅") ? "#16a34a" : "#dc2626",
          fontSize: 13,
          borderBottom: "1px solid #e2e8f0",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}>
          {importResult}
          <button onClick={() => setImportResult(null)} style={{ marginLeft: 12, background: "none", border: "none", cursor: "pointer", color: "inherit", fontWeight: 700 }}>×</button>
        </div>
      )}

      {/* ── Stats bar ── */}
      <div style={S.statsBar}>
        <div style={S.statTotal}>
          <span style={S.statNum}>{visibleLeads.length}</span>
          <span style={S.statLabel}>Total Prospects</span>
        </div>
        {stats.map(({ status, count }) => (
          <div
            key={status}
            style={{ ...S.statChip, background: STATUS_COLORS[status]?.bg, color: STATUS_COLORS[status]?.color, cursor: "pointer", outline: statusFilter === status ? "2px solid currentColor" : "none" }}
            onClick={() => setStatusFilter(statusFilter === status ? "All" : status)}
          >
            <span style={{ fontWeight: 700, fontSize: 16 }}>{count}</span>
            <span style={{ fontSize: 11, marginTop: 2 }}>{status}</span>
          </div>
        ))}
      </div>

      <div style={S.actionBar}>
        <div style={S.headerRight}>
          <input
            placeholder="Search prospects…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={S.searchInput}
          />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={S.select}>
            <option value="All">All Statuses</option>
            {STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
          <select value={handledByFilter} onChange={(e) => setHandledByFilter(e.target.value)} style={S.select}>
            <option value="All">All Handled By</option>
            {handledByOptions.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          <button onClick={() => setShowColModal(true)} style={S.btnOutline}>Columns</button>
          <label style={S.btnOutline}>
            {importing ? "Importing Prospects..." : "Import Prospects Excel"}
            <input
              ref={importRef}
              type="file"
              accept=".xlsx,.xls"
              style={{ display: "none" }}
              onChange={handleImport}
              disabled={importing}
            />
          </label>
          {isSuperAdmin && <button onClick={downloadExcel} style={S.btnDark}>Export Excel</button>}
          <button
            onClick={() => {
              setShowForm(true);
              setEditingId(null);
              setFormData({
                ...createEmptyLead(),
                handledBy: String(user.username || "").trim(),
              });
            }}
            style={S.btnPrimary}
          >
            + Add Prospect
          </button>
        </div>
      </div>

      {/* ── Add/Edit Form ── */}
      {showForm && (
        <div style={S.formCard}>
          <div style={S.formHeader}>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>{editingId ? "Edit Prospect" : "Add New Prospect"}</h2>
            <button onClick={resetForm} style={S.closeBtn}>✕</button>
          </div>
          <form onSubmit={handleSubmit}>
            <div style={S.formGrid}>
              {/* Prospect Date */}
              <div style={S.formField}>
                <label style={S.fLabel}>Prospect Date</label>
                <input
                  type="date"
                  style={S.fInput}
                  value={formData.leadDate || ""}
                  onChange={(e) => setFormData({ ...formData, leadDate: e.target.value })}
                />
              </div>

              {[
                { label: "Client Name", key: "accountName", required: true },
              ].map(({ label, key, placeholder, required, tooltip, isEngagementType }: any) => (
                <div key={key} style={S.formField}>
                  <label style={S.fLabel}>
                    {label}{required && " *"}
                    {tooltip && <Tooltip text={tooltip} />}
                  </label>
                  {isEngagementType ? (
                    <select
                      style={S.fInput}
                      value={(formData as any)[key]}
                      onChange={(e) => setFormData({ ...formData, [key]: e.target.value })}
                    >
                      <option value="">Select type</option>
                      {STATUSES_ENGAGEMENT.map(t => <option key={t}>{t}</option>)}
                    </select>
                  ) : (
                    <input
                      style={S.fInput}
                      placeholder={placeholder || ""}
                      value={(formData as any)[key]}
                      required={required}
                      onChange={(e) => setFormData({ ...formData, [key]: e.target.value })}
                    />
                  )}
                </div>
              ))}
              <div style={S.formField}>
                <label style={S.fLabel}>Status</label>
                <select
                  style={{ ...S.fInput, borderColor: formErrors.statusComment ? "#ef4444" : "" }}
                  value={formData.status}
                  onChange={(e) => {
                    const nextStatus = e.target.value;
                    setFormData((prev) => ({
                      ...prev,
                      status: nextStatus,
                      statusComment: nextStatus === "Inactive" ? prev.statusComment : "",
                    }));
                    if (nextStatus !== "Inactive" && formErrors.statusComment) {
                      setFormErrors((prev) => ({ ...prev, statusComment: "" }));
                    }
                  }}
                >
                  {STATUSES.map((s) => <option key={s}>{s}</option>)}
                </select>
              </div>
              {formData.status === "Inactive" && (
                <div style={S.formField}>
                  <label style={S.fLabel}>Inactive Comment *</label>
                  <textarea
                    rows={3}
                    style={{ ...S.fInput, resize: "vertical", borderColor: formErrors.statusComment ? "#ef4444" : "" }}
                    placeholder="Why is this prospect inactive?"
                    value={(formData as any).statusComment || ""}
                    onChange={(e) => {
                      setFormData({ ...formData, statusComment: e.target.value });
                      if (formErrors.statusComment) {
                        setFormErrors((prev) => ({ ...prev, statusComment: "" }));
                      }
                    }}
                  />
                  {formErrors.statusComment && <span style={{ color: "#ef4444", fontSize: 11, marginTop: 3 }}>{formErrors.statusComment}</span>}
                </div>
              )}
              <div style={S.formField}>
                <label style={S.fLabel}>Initiated By *</label>
                <input
                  style={{ ...S.fInput, borderColor: formErrors.handledBy ? "#ef4444" : "" }}
                  value={(formData as any).handledBy}
                  onChange={(e) => {
                    setFormData({ ...formData, handledBy: e.target.value });
                    if (formErrors.handledBy) setFormErrors((p) => ({ ...p, handledBy: "" }));
                  }}
                />
                {formErrors.handledBy && <span style={{ color: "#ef4444", fontSize: 11, marginTop: 3 }}>{formErrors.handledBy}</span>}
              </div>
              <div style={S.formField}>
                <label style={S.fLabel}>Managed By</label>
                <input
                  style={S.fInput}
                  value={(formData as any).managedBy || ""}
                  onChange={(e) => {
                    setFormData({ ...formData, managedBy: e.target.value });
                  }}
                />
              </div>
              <div style={S.formField}>
                <label style={S.fLabel}>Prospect Type{editingId ? "" : " *"}</label>
                <select
                  style={{ ...S.fInput, borderColor: formErrors.prospectType ? "#ef4444" : "" }}
                  value={(formData as any).prospectType}
                  onChange={(e) => {
                    setFormData({ ...formData, prospectType: e.target.value });
                    if (formErrors.prospectType) setFormErrors((p) => ({ ...p, prospectType: "" }));
                  }}
                >
                  <option value="">Select prospect type</option>
                  {PROSPECT_TYPES.map((type) => <option key={type}>{type}</option>)}
                </select>
                {formErrors.prospectType && <span style={{ color: "#ef4444", fontSize: 11, marginTop: 3 }}>{formErrors.prospectType}</span>}
              </div>
              <div style={S.formField}>
                <label style={S.fLabel}>URL</label>
                <input
                  style={{ ...S.fInput, borderColor: formErrors.url ? "#ef4444" : "" }}
                  placeholder="https://example.com"
                  value={(formData as any).url}
                  onChange={(e) => {
                    setFormData({ ...formData, url: e.target.value });
                    if (formErrors.url) setFormErrors((p) => ({ ...p, url: "" }));
                  }}
                />
                {formErrors.url && <span style={{ color: "#ef4444", fontSize: 11, marginTop: 3 }}>{formErrors.url}</span>}
              </div>
              <div style={S.formField}>
                <label style={S.fLabel}>Follow-up Date</label>
                <input
                  type="date"
                  min={new Date().toISOString().slice(0, 10)}
                  style={{ ...S.fInput, borderColor: formErrors.followUpDate ? "#ef4444" : "" }}
                  value={(formData as any).followUpDate || ""}
                  onChange={(e) => {
                    setFormData({ ...formData, followUpDate: e.target.value });
                    if (formErrors.followUpDate) setFormErrors((p) => ({ ...p, followUpDate: "" }));
                  }}
                />
              </div>
              <div style={S.formField}>
                <label style={S.fLabel}>Follow-up Time</label>
                <input
                  type="time"
                  style={{ ...S.fInput, borderColor: formErrors.followUpDate ? "#ef4444" : "" }}
                  value={(formData as any).followUpTime || ""}
                  onChange={(e) => {
                    setFormData({ ...formData, followUpTime: e.target.value });
                    if (formErrors.followUpDate) setFormErrors((p) => ({ ...p, followUpDate: "" }));
                  }}
                />
                {formErrors.followUpDate && <span style={{ color: "#ef4444", fontSize: 11, marginTop: 3 }}>{formErrors.followUpDate}</span>}
              </div>
                <div style={{ ...S.formField, gridColumn: "1 / -1" }}>
                  <label style={S.fLabel}>Record Viewable By</label>
                  <div style={S.userPickerWrap}>
                    <div>
                      <div style={S.userPickerLabel}>Selected Users</div>
                      <div style={S.userPickerRow}>
                        {selectedRecordViewableByUsers.length === 0 ? (
                          <span style={S.userPickerEmpty}>No users selected.</span>
                        ) : (
                          selectedRecordViewableByUsers.map((username) => (
                            <button
                              key={`selected-${username}`}
                              type="button"
                              title={username}
                              onClick={() =>
                                canEditRecordViewableBy &&
                                setFormData({
                                  ...formData,
                                  recordViewableBy: selectedRecordViewableByUsers.filter((value) => value !== username),
                                })
                              }
                              disabled={!canEditRecordViewableBy}
                              style={{
                                ...S.userPill,
                                ...S.userPillSelected,
                                ...(canEditRecordViewableBy ? {} : S.userPillDisabled),
                              }}
                            >
                              <span style={S.userPillText}>{username}</span>
                              <span style={S.userPillClose}>×</span>
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                    <div>
                      <div style={S.userPickerLabel}>Suggested Users</div>
                      <div style={S.userPickerRow}>
                        {recordViewableByOptions.length === 0 ? (
                          <span style={S.userPickerEmpty}>No more users available.</span>
                        ) : (
                          recordViewableByOptions.map((username) => (
                            <button
                              key={`suggested-${username}`}
                              type="button"
                              title={username}
                              onClick={() =>
                                canEditRecordViewableBy &&
                                setFormData({
                                  ...formData,
                                  recordViewableBy: Array.from(new Set([...selectedRecordViewableByUsers, username])),
                                })
                              }
                              disabled={!canEditRecordViewableBy}
                              style={{
                                ...S.userPill,
                                ...(canEditRecordViewableBy ? {} : S.userPillDisabled),
                              }}
                            >
                              <span style={S.userPillPlus}>+</span>
                              <span style={S.userPillText}>{username}</span>
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

            {/* Client SPOC */}
            <div style={S.formSection}>
              <div style={S.sectionTitle}>Client SPOC</div>
              <div style={S.formGrid}>
                {[
                  { label: "Name", key: "clientSpoc" },
                  { label: "Designation", key: "clientSpocPosition" },
                  { label: "Email", key: "clientEmail" },
                  { label: "Country Code", key: "clientCountryCode" },
                  { label: "Phone", key: "clientPhone" },
                ].map(({ label, key }) => (
                  <div key={key} style={S.formField}>
                    <label style={S.fLabel}>{label}</label>
                    <input
                      style={{ ...S.fInput, borderColor: formErrors[key] ? "#ef4444" : "" }}
                      value={(formData as any)[key]}
                      placeholder={key.includes("CountryCode") ? "+91" : undefined}
                      onChange={(e) => {
                        setFormData({ ...formData, [key]: e.target.value });
                        if (formErrors[key]) setFormErrors(p => ({ ...p, [key]: "" }));
                      }}
                    />
                    {formErrors[key] && <span style={{ color: "#ef4444", fontSize: 11, marginTop: 3 }}>{formErrors[key]}</span>}
                  </div>
                ))}
              </div>
            </div>

            {/* Partner SPOC */}
            <div style={S.formSection}>
              <div style={S.sectionTitle}>Partner SPOC</div>
              <div style={S.formGrid}>
                {[
                  { label: "Name", key: "partnerSpoc" },
                  { label: "Designation", key: "partnerSpocPosition" },
                  { label: "Email", key: "partnerEmail" },
                  { label: "Country Code", key: "partnerCountryCode" },
                  { label: "Phone", key: "partnerPhone" },
                ].map(({ label, key }) => (
                  <div key={key} style={S.formField}>
                    <label style={S.fLabel}>{label}</label>
                    <input
                      style={{ ...S.fInput, borderColor: formErrors[key] ? "#ef4444" : "" }}
                      value={(formData as any)[key]}
                      placeholder={key.includes("CountryCode") ? "+91" : undefined}
                      onChange={(e) => {
                        setFormData({ ...formData, [key]: e.target.value });
                        if (formErrors[key]) setFormErrors(p => ({ ...p, [key]: "" }));
                      }}
                    />
                    {formErrors[key] && <span style={{ color: "#ef4444", fontSize: 11, marginTop: 3 }}>{formErrors[key]}</span>}
                  </div>
                ))}
              </div>
            </div>

            {/* Remarks */}
            <div style={{ padding: "0 24px 20px" }}>
              <label style={S.fLabel}>Remarks</label>
              <textarea
                rows={3}
                style={{ ...S.fInput, resize: "vertical" }}
                value={formData.remarks}
                onChange={(e) => setFormData({ ...formData, remarks: e.target.value })}
                onPaste={(e) =>
                  handleNormalizedTextareaPasteRichV2(e, formData.remarks, (value) =>
                    setFormData((prev) => ({ ...prev, remarks: value }))
                  )
                }
              />
            </div>

            <div style={{ padding: "0 24px 20px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Actions</h3>
              </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
                  {(["Note", "Call", "Meeting"] as const).map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => openProspectAction(type)}
                      style={S.quickBtn}
                    >
                      + {type}
                    </button>
                  ))}
                </div>
              {activeAction && (
                <div style={S.inlineActionCard}>
                  <h4 style={{ margin: "0 0 16px 0", fontSize: 16, fontWeight: 600 }}>Add {activeAction}</h4>
                  {(activeAction !== "Note" || manualActionTimestampMode) && (
                    <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
                      <input type="date" value={actionDate} onChange={(e) => setActionDate(e.target.value)} style={{ ...S.fInput, width: 180 }} />
                      <input type="time" value={actionTime} onChange={(e) => setActionTime(e.target.value)} style={{ ...S.fInput, width: 140 }} />
                    </div>
                  )}
                  {activeAction === "Meeting" && (
                    <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
                      <input
                        type="text"
                        placeholder="Meeting place"
                        value={meetingPlace}
                        onChange={(e) => setMeetingPlace(e.target.value)}
                        style={{ ...S.fInput, flex: 1 }}
                      />
                    </div>
                  )}
                  <textarea
                    rows={4}
                    placeholder={`Describe this ${activeAction.toLowerCase()}...`}
                    value={actionDescription}
                    onChange={(e) => setActionDescription(e.target.value)}
                    onPaste={(e) => handleNormalizedTextareaPasteRichV2(e, actionDescription, setActionDescription)}
                    style={{ ...S.fInput, resize: "vertical", marginBottom: 8 }}
                  />
                  <div style={{ fontSize: 12, color: "#64748b", marginBottom: 16 }}>Details are required before saving this action.</div>
                  {activeAction === "Note" && (
                    <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
                      <select value={actionAssignedTo} onChange={(e) => setActionAssignedTo(e.target.value)} style={{ ...S.fInput, width: 220 }}>
                        <option value="">Assign to user</option>
                        {getProspectAssignableUsers(formData).map((username) => (
                          <option key={username} value={username}>{username}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  {formErrors.actionDescription && <div style={{ color: "#ef4444", fontSize: 11, marginBottom: 12 }}>{formErrors.actionDescription}</div>}
                  <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
                    <input type="date" min={new Date().toISOString().slice(0, 10)} value={actionFollowUpDate} onChange={(e) => setActionFollowUpDate(e.target.value)} style={{ ...S.fInput, width: 180 }} title="Business dates only: Monday to Friday" />
                    <input type="time" value={actionFollowUpTime} onChange={(e) => setActionFollowUpTime(e.target.value)} style={{ ...S.fInput, width: 140 }} />
                    <div style={{ alignSelf: "center", fontSize: 12, color: "#64748b" }}>Next follow-up for this action</div>
                  </div>
                  {formErrors.actionFollowUpDate && <div style={{ color: "#ef4444", fontSize: 11, marginBottom: 12 }}>{formErrors.actionFollowUpDate}</div>}
                  <div style={{ display: "flex", gap: 10 }}>
                    <button type="button" onClick={saveProspectAction} style={S.btnPrimary}>Save {activeAction}</button>
                    <button type="button" onClick={() => setActiveAction(null)} style={S.btnOutline}>Cancel</button>
                  </div>
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "6px 0 16px" }}>
                <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Timeline</h3>
              </div>
              {normalizeLeadTimelineEntries((formData as any).actions || []).length === 0 ? (
                <div style={S.emptyTimeline}>No timeline entries yet for this prospect.</div>
              ) : (
                <div style={{ display: "grid", gap: 14 }}>
                  {normalizeLeadTimelineEntries((formData as any).actions || [])
                    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                    .map((entry) => (
                      <div key={entry.id} style={S.timelineEntry}>
                        <div style={S.timelineDot} />
                        <div style={S.timelineBody}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                            <span style={S.timelinePill}>{entry.title}</span>
                            <span style={{ fontSize: 12, color: "#64748b" }}>{entry.date}{entry.time ? ` at ${entry.time}` : ""}</span>
                          </div>
                          {entry.createdBy && <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6 }}>Created by: {entry.createdBy}</div>}
                          {entry.assignedTo && <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6 }}>Assigned to: {entry.assignedTo}</div>}
                          {entry.place && <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6 }}>Place: {entry.place}</div>}
                          {(entry.followUpDate || entry.followUpTime) && (
                            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6 }}>
                              Follow-up: {entry.followUpDate || "Date pending"}{entry.followUpTime ? ` at ${entry.followUpTime}` : ""}
                            </div>
                          )}
                          {editingProspectNoteId === entry.id ? (
                            <div style={{ display: "grid", gap: 10 }}>
                              <textarea
                                rows={4}
                                value={editingProspectNoteDescription}
                                onChange={(e) => setEditingProspectNoteDescription(e.target.value)}
                                onPaste={(e) => handleNormalizedTextareaPasteRichV2(e, editingProspectNoteDescription, setEditingProspectNoteDescription)}
                                style={{ ...S.fInput, resize: "vertical" }}
                              />
                              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                <button type="button" onClick={() => saveEditedProspectNote(entry.id)} style={S.btnPrimary}>Save Note</button>
                                <button type="button" onClick={cancelEditingProspectNote} style={S.btnOutline}>Cancel</button>
                              </div>
                            </div>
                          ) : (
                            <div style={{ fontSize: 13, color: "#334155", whiteSpace: "pre-wrap" }}>{entry.description}</div>
                          )}
                          {entry.category === "note" && editingProspectNoteId !== entry.id && (
                            <div style={{ marginTop: 8 }}>
                              <button type="button" onClick={() => startEditingProspectNote(entry)} style={{ border: "none", background: "transparent", color: "#64748b", fontSize: 12, fontWeight: 700, cursor: "pointer", padding: 0 }}>Edit</button>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>

            <div style={{ padding: "0 24px 24px", display: "flex", gap: 10 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%" }}>
                {(formErrorSummary || formErrorList.length > 0) && (
                  <div
                    style={{
                      padding: "10px 12px",
                      borderRadius: 10,
                      background: "#fef2f2",
                      border: "1px solid #fecaca",
                      color: "#dc2626",
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    <div>{formErrorSummary || "Please fix the following fields before saving."}</div>
                    {formErrorList.length > 0 && (
                      <ul style={{ margin: "8px 0 0 18px", padding: 0, fontWeight: 500 }}>
                        {formErrorList.map((error) => (
                          <li key={error} style={{ marginBottom: 4 }}>
                            {error}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
                <div style={{ display: "flex", gap: 10 }}>
                  <button type="submit" style={S.btnPrimary} disabled={savingLead}>{savingLead ? "Saving..." : editingId ? "Save Changes" : "Add Prospect"}</button>
                  <button type="button" onClick={resetForm} style={S.btnOutline}>Cancel</button>
                </div>
              </div>
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
                {(["Prospect Date","Client Name","Status","Initiated By","Managed By","Client SPOC","Client Email","Client Phone",
                  "Partner SPOC","Partner Designation","Partner Email","Partner Phone",
                  "Last Action Comment","Remarks"] as string[]).filter(h => visibleCols[h]).concat(["Actions"]).map((h) => (
                  <th key={h} style={h === "Actions" ? S.thSticky : h === "Client Name" ? S.thClientSticky : S.th}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>{h}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={Object.values(visibleCols).filter(Boolean).length + 1} style={{ textAlign: "center", padding: "48px 0", color: "#94a3b8", fontSize: 14 }}>
                    No prospects found. Add one or import from Excel.
                  </td>
                </tr>
              )}
              {filtered.map((lead) => (
                <tr key={lead.id} style={S.tr}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#f8fafc")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "")}>
                  {(() => {
                    const latestAction = getLatestLeadAction((lead as any).actions || []);
                    const latestAssignedAction = getLatestAssignedLeadAction((lead as any).actions || []);
                    return (
                      <>
                  {visibleCols["Prospect Date"] && <td style={{ ...S.td, whiteSpace: "nowrap", color: "#64748b" }}>{lead.leadDate || "-"}</td>}
                  {visibleCols["Client Name"] && (
                    <td style={{ ...S.tdClientSticky, minWidth: 140 }}>
                      <button
                        type="button"
                        onClick={() => openLeadActions(lead)}
                        style={S.clientLinkBtn}
                      >
                        {lead.accountName}
                      </button>
                    </td>
                  )}
                  {visibleCols["Status"] && <td style={S.td}>
                    <select value={lead.status} onChange={(e) => updateStatus(lead, e.target.value)}
                      style={{ ...S.statusSelect, background: STATUS_COLORS[lead.status]?.bg, color: STATUS_COLORS[lead.status]?.color }}>
                      {STATUSES.map((s) => <option key={s}>{s}</option>)}
                    </select>
                  </td>}
                  {visibleCols["Initiated By"] && <td style={S.td}>{(lead as any).handledBy || "-"}</td>}
                  {visibleCols["Managed By"] && <td style={S.td}>{(lead as any).managedBy || latestAssignedAction?.assignedTo || "-"}</td>}
                  {visibleCols["Client SPOC"] && <td style={S.td}>{lead.clientSpoc}</td>}
                  {visibleCols["Client Email"] && <td style={{ ...S.td, color: "#2563eb" }}>
                    {lead.clientEmail ? <a href={`mailto:${lead.clientEmail}`} style={{ color: "#2563eb" }}>{lead.clientEmail}</a> : "-"}
                  </td>}
                  {visibleCols["Client Phone"] && <td style={S.td}>{formatPhoneWithCountryCode((lead as any).clientCountryCode, lead.clientPhone) || "-"}</td>}
                  {visibleCols["Partner SPOC"] && <td style={S.td}>{lead.partnerSpoc}</td>}
                  {visibleCols["Partner Designation"] && <td style={S.td}>{lead.partnerSpocPosition}</td>}
                  {visibleCols["Partner Email"] && <td style={{ ...S.td, color: "#2563eb" }}>
                    {lead.partnerEmail ? <a href={`mailto:${lead.partnerEmail}`} style={{ color: "#2563eb" }}>{lead.partnerEmail}</a> : "-"}
                  </td>}
                  {visibleCols["Partner Phone"] && <td style={S.td}>{formatPhoneWithCountryCode((lead as any).partnerCountryCode, lead.partnerPhone) || "-"}</td>}
                  {visibleCols["Last Action Comment"] && <td style={{ ...S.td, minWidth: 220, maxWidth: 280, whiteSpace: "pre-wrap", color: "#64748b", fontSize: 12 }}>
                    {latestAction?.description ? (
                      <span>
                        <span title={normalizeLeadTextRichV2(latestAction.description)}>
                          {expandedLastActionComments[lead.id] ? normalizeLeadTextRichV2(latestAction.description) : getRemarksPreview(latestAction.description, 180)}
                        </span>
                        {normalizeLeadTextRichV2(latestAction.description).length > 180 && (
                          <button
                            type="button"
                            onClick={() => setExpandedLastActionComments((prev) => ({ ...prev, [lead.id]: !prev[lead.id] }))}
                            style={{ display: "block", marginTop: 6, border: "none", background: "none", color: "#2563eb", cursor: "pointer", padding: 0, fontSize: 12, fontWeight: 600 }}
                          >
                            {expandedLastActionComments[lead.id] ? "Show less" : "Show more"}
                          </button>
                        )}
                      </span>
                    ) : <span style={{ color: "#cbd5e1", fontStyle: "italic" }}>No actions</span>}
                  </td>}
                  {visibleCols["Remarks"] && <td style={{ ...S.td, minWidth: 200, maxWidth: 240, color: "#64748b", fontSize: 12, whiteSpace: "pre-wrap" }}>
                    {lead.remarks ? (
                      <span>
                        <span title={normalizeLeadTextRichV2(lead.remarks)}>
                          {expandedRemarks[lead.id] ? normalizeLeadTextRichV2(lead.remarks) : getRemarksPreview(lead.remarks)}
                        </span>
                        {normalizeLeadTextRichV2(lead.remarks).length > 140 && (
                          <button
                            type="button"
                            onClick={() => setExpandedRemarks((prev) => ({ ...prev, [lead.id]: !prev[lead.id] }))}
                            style={{ display: "block", marginTop: 6, border: "none", background: "none", color: "#2563eb", cursor: "pointer", padding: 0, fontSize: 12, fontWeight: 600 }}
                          >
                            {expandedRemarks[lead.id] ? "Show less" : "Show more"}
                          </button>
                        )}
                      </span>
                    ) : <span style={{ color: "#cbd5e1", fontStyle: "italic" }}>No remarks</span>}
                  </td>}

                  {/* Actions */}
                  <td style={S.tdSticky}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <button onClick={() => startEdit(lead)} style={S.iconBtn} title="Edit prospect" aria-label="Edit prospect">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 20h9" />
                          <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                        </svg>
                      </button>
                      <button onClick={() => onNavigate("transactions", lead.leadId)} style={S.iconBtnWarn} title="Open lead" aria-label="Open lead">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M3 7h18" />
                          <path d="M6 3h12l3 4v14H3V7l3-4Z" />
                        </svg>
                      </button>
                      <button onClick={() => deleteLead(lead)} style={S.iconBtnDanger} title="Delete prospect" aria-label="Delete prospect">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M3 6h18" />
                          <path d="M8 6V4h8v2" />
                          <path d="M19 6l-1 14H6L5 6" />
                        </svg>
                      </button>
                    </div>
                  </td>
                      </>
                    );
                  })()}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 12, fontSize: 12, color: "#94a3b8" }}>
          Showing {filtered.length} of {visibleLeads.length} prospects · Logged in as <b>{user.username}</b>
          {isAdmin && <span style={{ marginLeft: 6, color: "#7c3aed" }}>👑 Admin</span>}
          &nbsp;·&nbsp;<span style={{ color: "#16a34a" }}>🔥 Connected to Firebase</span>
        </div>
      </div>

      {/* ── Column Selector Modal ── */}
      {showColModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, backdropFilter: "blur(2px)" }}>
          <div style={{ background: "#fff", borderRadius: 16, padding: "28px 32px", width: "100%", maxWidth: 520, boxShadow: "0 24px 60px rgba(0,0,0,0.2)", fontFamily: "'DM Sans', sans-serif" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#0f172a" }}>Select Columns</h2>
              <button onClick={() => setShowColModal(false)} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "#64748b" }}>✕</button>
            </div>

            {[
              { title: "Prospect Info", cols: ["Prospect Date", "Client Name", "Status", "Initiated By", "Managed By", "Last Action Comment", "Remarks"] },
              { title: "Client SPOC", cols: ["Client SPOC", "Client Email", "Client Phone"] },
              { title: "Partner SPOC", cols: ["Partner SPOC", "Partner Designation", "Partner Email", "Partner Phone"] },
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
          title="Delete Prospect"
          itemName={`${deleteModal.lead.leadId} — ${deleteModal.lead.accountName}`}
          warning={deleteModal.txnCount > 0
            ? `This prospect has ${deleteModal.txnCount} lead${deleteModal.txnCount > 1 ? "s" : ""}. Please delete them first before deleting this prospect.`
            : undefined}
          onConfirm={confirmDeleteLead}
          onCancel={() => setDeleteModal(null)}
        />
      )}

      <ChangePasswordModal
        open={showPasswordModal}
        onClose={() => setShowPasswordModal(false)}
        targetUid={user.uid || ""}
        targetLabel={user.username || "Current User"}
        actorName={user.username || "unknown"}
        isSelf
      />
    </div>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const S: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "#f8fafc",
    fontFamily: "'DM Sans', 'Segoe UI', sans-serif",
    color: "#0f172a",
  },
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
  headerTop: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "nowrap" },
  headerBrandGroup: { display: "flex", alignItems: "center", gap: 20, minWidth: 0, flex: 1 },
  headerActions: { display: "flex", alignItems: "center", gap: 10, flexWrap: "nowrap" },
  headerBottom: { display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" },
  headerLeft: { display: "flex", alignItems: "center", gap: 12 },
  headerTitle: { fontSize: 22, fontWeight: 800, margin: 0, letterSpacing: "-0.5px", color: "#0f172a" },
  // ── Nav tabs ──
  navTabs: { display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap", width: "100%", order: 3 },
  navTab: {
    padding: "6px 14px",
    background: "transparent",
    color: "#64748b",
    border: "1.5px solid #e2e8f0",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  navTabActive: {
    background: "#0f172a",
    color: "#fff",
    border: "1.5px solid #0f172a",
  },
  headerRight: { display: "flex", alignItems: "center", justifyContent: "flex-start", gap: 10, flexWrap: "wrap", flex: "1 1 420px" },
  searchInput: {
    padding: "10px 14px",
    borderRadius: 12,
    border: "1px solid #d7dee8",
    fontSize: 13,
    background: "#ffffff",
    outline: "none",
    width: 230,
    boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
  },
  select: {
    padding: "10px 14px",
    borderRadius: 12,
    border: "1px solid #d7dee8",
    fontSize: 13,
    background: "#ffffff",
    outline: "none",
    cursor: "pointer",
    boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
  },
  btnPrimary: {
    padding: "10px 16px",
    background: "#0f172a",
    color: "#fff",
    border: "none",
    borderRadius: 12,
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
    whiteSpace: "nowrap",
    boxShadow: "0 10px 22px rgba(15,23,42,0.16)",
  },
  btnDark: {
    padding: "10px 14px",
    background: "#1e293b",
    color: "#fff",
    border: "none",
    borderRadius: 12,
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  btnOutline: {
    padding: "10px 14px",
    background: "#fff",
    color: "#0f172a",
    border: "1px solid #d7dee8",
    borderRadius: 12,
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
    whiteSpace: "nowrap",
    display: "inline-flex",
    alignItems: "center",
    boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
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
  },
  statsBar: {
    display: "flex",
    gap: 12,
    padding: "16px 24px",
    background: "#ffffff",
    borderBottom: "1px solid #e2e8f0",
    flexWrap: "wrap",
    alignItems: "center",
  },
  actionBar: {
    padding: "16px 24px 18px",
    background: "#ffffff",
    borderBottom: "1px solid #e2e8f0",
  },
  statTotal: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    padding: "8px 20px",
    background: "#f1f5f9",
    borderRadius: 10,
    marginRight: 4,
  },
  statNum: { fontSize: 22, fontWeight: 800, color: "#0f172a" },
  statLabel: { fontSize: 11, color: "#64748b", marginTop: 2 },
  statChip: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    padding: "8px 16px",
    borderRadius: 10,
    minWidth: 70,
    transition: "transform 0.1s",
  },
  formCard: {
    margin: "20px 24px",
    background: "#ffffff",
    borderRadius: 16,
    border: "1px solid #e2e8f0",
    boxShadow: "0 4px 20px rgba(0,0,0,0.06)",
    overflow: "hidden",
  },
  formHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "18px 24px",
    borderBottom: "1px solid #f1f5f9",
    background: "#f8fafc",
  },
  closeBtn: {
    background: "none",
    border: "none",
    fontSize: 18,
    cursor: "pointer",
    color: "#64748b",
    padding: "4px 8px",
  },
  formGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
    gap: "16px 20px",
    padding: "20px 24px 8px",
  },
  formField: { display: "flex", flexDirection: "column" },
  formSection: {
    borderTop: "1px solid #f1f5f9",
    paddingTop: 4,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: 700,
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: "0.6px",
    padding: "12px 24px 0",
  },
  fLabel: { fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 5 },
  fInput: {
    padding: "9px 12px",
    borderRadius: 8,
    border: "1.5px solid #e2e8f0",
    fontSize: 13,
    background: "#f8fafc",
    outline: "none",
    color: "#0f172a",
    width: "100%",
    boxSizing: "border-box",
  },
  quickBtn: {
    padding: "8px 20px",
    borderRadius: 9999,
    border: "1px solid #3b82f6",
    background: "#fff",
    color: "#3b82f6",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
  },
  userPickerWrap: {
    display: "flex",
    flexDirection: "column",
    gap: 14,
    padding: "14px 16px",
    border: "1px solid #e2e8f0",
    borderRadius: 12,
    background: "#f8fafc",
  },
  userPickerLabel: {
    marginBottom: 8,
    fontSize: 11,
    fontWeight: 700,
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: "0.12em",
  },
  userPickerRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 10,
  },
  userPickerEmpty: {
    fontSize: 12,
    color: "#64748b",
  },
  userPickerHelper: {
    fontSize: 12,
    color: "#64748b",
    lineHeight: 1.5,
  },
  userPill: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    maxWidth: 220,
    padding: "8px 12px",
    borderRadius: 9999,
    border: "1px solid #cbd5e1",
    background: "#ffffff",
    color: "#1e3a8a",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },
  userPillDisabled: {
    opacity: 0.55,
    cursor: "not-allowed",
  },
  userPillSelected: {
    border: "1px solid #fca5a5",
    background: "#fff5f5",
    color: "#dc2626",
  },
  userPillText: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    maxWidth: 160,
  },
  userPillPlus: {
    fontSize: 15,
    lineHeight: 1,
    fontWeight: 700,
    flexShrink: 0,
  },
  userPillClose: {
    fontSize: 14,
    lineHeight: 1,
    fontWeight: 700,
    flexShrink: 0,
  },
  inlineActionCard: {
    marginBottom: 18,
    padding: "18px",
    background: "#ffffff",
    borderRadius: 14,
    border: "1px solid #dbe4f0",
    boxShadow: "0 4px 14px rgba(15,23,42,0.05)",
  },
  emptyTimeline: {
    border: "1px dashed #cbd5e1",
    borderRadius: 14,
    padding: "22px 18px",
    color: "#94a3b8",
    fontSize: 14,
    background: "#fbfdff",
  },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    border: "1px solid #dbe4f0",
    background: "#ffffff",
    color: "#2563eb",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
  },
  iconBtnWarn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    border: "1px solid #fde68a",
    background: "#fffbeb",
    color: "#d97706",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
  },
  iconBtnDanger: {
    width: 34,
    height: 34,
    borderRadius: 10,
    border: "1px solid #fecaca",
    background: "#fef2f2",
    color: "#dc2626",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
  },
  timelineEntry: {
    position: "relative",
    display: "flex",
    gap: 14,
    alignItems: "flex-start",
  },
  timelineDot: {
    width: 14,
    height: 14,
    borderRadius: "50%",
    background: "#93c5fd",
    boxShadow: "0 0 0 6px #dbeafe",
    marginTop: 10,
    flexShrink: 0,
  },
  timelineBody: {
    flex: 1,
    border: "1px solid #dbe4f0",
    borderRadius: 16,
    background: "#ffffff",
    padding: "16px 18px",
    boxShadow: "0 4px 14px rgba(15,23,42,0.05)",
  },
  timelinePill: {
    padding: "4px 10px",
    borderRadius: 9999,
    background: "#eff6ff",
    color: "#2563eb",
    fontSize: 11,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  tableWrap: {
    overflow: "auto",
    maxHeight: "calc(100vh - 260px)",
    borderRadius: 12,
    border: "1px solid #e2e8f0",
    background: "#fff",
    boxShadow: "0 2px 12px rgba(0,0,0,0.04)",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 13,
  },
  th: {
    padding: "12px 14px",
    textAlign: "left",
    background: "#f8fafc",
    color: "#475569",
    fontWeight: 700,
    fontSize: 12,
    whiteSpace: "nowrap",
    borderBottom: "1px solid #e2e8f0",
    position: "sticky",
    top: 0,
    zIndex: 5,
  },
  thSticky: {
    padding: "12px 14px",
    textAlign: "left",
    background: "#f8fafc",
    color: "#475569",
    fontWeight: 700,
    fontSize: 12,
    whiteSpace: "nowrap",
    borderBottom: "1px solid #e2e8f0",
    position: "sticky",
    top: 0,
    right: 0,
    zIndex: 7,
    boxShadow: "-2px 0 6px rgba(0,0,0,0.06)",
  },
  thClientSticky: {
    padding: "12px 14px",
    textAlign: "left",
    background: "#f8fafc",
    color: "#475569",
    fontWeight: 700,
    fontSize: 12,
    whiteSpace: "nowrap",
    borderBottom: "1px solid #e2e8f0",
    position: "sticky",
    top: 0,
    left: 0,
    zIndex: 8,
    boxShadow: "2px 0 6px rgba(0,0,0,0.06)",
  },
  tdSticky: {
    padding: "11px 14px",
    color: "#334155",
    verticalAlign: "top",
    fontSize: 13,
    position: "sticky",
    right: 0,
    background: "#ffffff",
    zIndex: 1,
    boxShadow: "-2px 0 6px rgba(0,0,0,0.06)",
  },
  tdClientSticky: {
    padding: "11px 14px",
    color: "#334155",
    verticalAlign: "top",
    fontSize: 13,
    position: "sticky",
    left: 0,
    background: "#ffffff",
    zIndex: 2,
    boxShadow: "2px 0 6px rgba(0,0,0,0.06)",
  },
  clientLinkBtn: {
    background: "none",
    border: "none",
    padding: 0,
    margin: 0,
    color: "#0f172a",
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
    textAlign: "left",
  },
  tr: {
    borderBottom: "1px solid #f1f5f9",
    transition: "background 0.15s",
  },
  td: {
    padding: "11px 14px",
    color: "#334155",
    verticalAlign: "top",
    fontSize: 13,
  },
  statusSelect: {
    padding: "5px 10px",
    borderRadius: 20,
    border: "none",
    fontWeight: 600,
    fontSize: 12,
    cursor: "pointer",
    outline: "none",
  },

  editBtn: {
    padding: "5px 10px",
    background: "#eff6ff",
    color: "#2563eb",
    border: "none",
    borderRadius: 6,
    cursor: "pointer",
    fontWeight: 600,
    fontSize: 12,
  },
  txnBtn: {
    padding: "5px 10px",
    background: "#fef9c3",
    color: "#b45309",
    border: "none",
    borderRadius: 6,
    cursor: "pointer",
    fontWeight: 600,
    fontSize: 12,
  },
  deleteBtn: {
    padding: "5px 10px",
    background: "#fef2f2",
    color: "#dc2626",
    border: "none",
    borderRadius: 6,
    cursor: "pointer",
    fontWeight: 600,
    fontSize: 12,
  },
};
