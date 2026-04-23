import { useEffect, useRef, useState } from "react";
import { db } from "../firebase/config";
import {
  collection,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
} from "firebase/firestore";
import { logActivity } from "../firebase/activityLog";
import { signOut } from "firebase/auth";
import { auth } from "../firebase/config";
import * as XLSX from "xlsx";
import DeleteModal from "../components/DeleteModal";
import AppHeaderNav from "../components/AppHeaderNav";
import { Page } from "../navigation";

// ─── Constants ───────────────────────────────────────────────────────────────
const COLLECTION = "leads";

const STATUSES = ["Active", "Inactive"];

const STATUSES_ENGAGEMENT = ["Development", "M&S", "Consulting", "Support", "Implementation"];

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  Active:   { bg: "#dcfce7", color: "#16a34a" },
  Inactive: { bg: "#fee2e2", color: "#dc2626" },
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
  clientPhone: "",
  partnerSpoc: "",
  partnerSpocPosition: "",
  partnerEmail: "",
  partnerPhone: "",
  status: "Active",
  remarks: "",
};

type Lead = typeof EMPTY_LEAD & { id: string; createdAt?: string };

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
  "Email Id": "clientEmail",
  "Client Phone": "clientPhone",
  "Phone Number": "clientPhone",
  "Partner SPOC": "partnerSpoc",
  "Partner Designation": "partnerSpocPosition",
  "Partner SPOC Position": "partnerSpocPosition",
  "Partner Email": "partnerEmail",
  "Partner Email Id": "partnerEmail",
  "Partner Phone": "partnerPhone",
  "Partner Phone Number": "partnerPhone",
  "Status": "status",
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
  const user    = JSON.parse(localStorage.getItem("leadUser")!);
  const isAdmin = user.role === "admin";

  const [leads, setLeads] = useState<Lead[]>([]);
  const [transactions, setTransactions] = useState<{leadId:string}[]>([]);
  const [statusFilter, setStatusFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({ ...EMPTY_LEAD });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [deleteModal, setDeleteModal] = useState<{ lead: Lead; txnCount: number } | null>(null);
  const [showColModal, setShowColModal] = useState(false);
  const [visibleCols, setVisibleCols] = useState<Record<string, boolean>>({
    // Lead Info
    "Lead Date": true, "Client Name": true, "Program Name": true,
    "Project Name": true,
    "Engagement Name": true, "Engagement Type": true, "Status": true, "Remarks": true,
    // Client SPOC
    "Client SPOC": true, "Client Designation": true, "Client Email": true, "Client Phone": true,
    // Partner SPOC
    "Partner SPOC": true, "Partner Designation": true, "Partner Email": true, "Partner Phone": true,
  });
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const importRef = useRef<HTMLInputElement>(null);

  // ── Realtime Firebase listener ──
  useEffect(() => {
    const unsub = onSnapshot(collection(db, COLLECTION), (snap) => {
      setLeads(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Lead)));
      setLoading(false);
    });
    const unsubTxn = onSnapshot(collection(db, "transactions"), (snap) => {
      setTransactions(snap.docs.map(d => ({ leadId: d.data().leadId })));
    });
    return () => { unsub(); unsubTxn(); };
  }, []);

  // ── Filtered + sorted leads ──
  const filtered = leads
    .filter((l) => {
      if (statusFilter !== "All" && l.status !== statusFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          l.leadId?.toLowerCase().includes(q) ||
          (l as any).programName?.toLowerCase().includes(q) ||
          l.accountName?.toLowerCase().includes(q) ||
          l.engagementName?.toLowerCase().includes(q) ||
          l.clientSpoc?.toLowerCase().includes(q) ||
          l.partnerSpoc?.toLowerCase().includes(q)
        );
      }
      return true;
    })
    .sort((a, b) => {
      const order: Record<string, number> = { Active: 1, Inactive: 2 };
      return (order[a.status] ?? 9) - (order[b.status] ?? 9);
    });

  // ── Add / Edit lead ──
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // ── Validation ──
    const errors: Record<string, string> = {};
    if (formData.clientEmail && !formData.clientEmail.includes("@")) {
      errors.clientEmail = "Please enter a valid email address containing @";
    }
    if (formData.clientPhone && !/^\d+$/.test(formData.clientPhone)) {
      errors.clientPhone = "Phone number must contain only digits";
    }
    if (formData.partnerEmail && !formData.partnerEmail.includes("@")) {
      errors.partnerEmail = "Please enter a valid email address containing @";
    }
    if (formData.partnerPhone && !/^\d+$/.test(formData.partnerPhone)) {
      errors.partnerPhone = "Phone number must contain only digits";
    }
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }
    setFormErrors({});
    const payload = {
      ...formData,
      leadId: formData.leadId || generateLeadId(),
      leadDate: formData.leadDate || new Date().toISOString().slice(0, 10),
      updatedAt: new Date().toISOString(),
    };
    if (editingId) {
      const old = leads.find(l => l.id === editingId);
      await updateDoc(doc(db, COLLECTION, editingId), payload);
      // ── updated logActivity signature ──
      await logActivity(payload.leadId, payload.accountName, "leads", {
        actionType: "LEAD_EDITED",
        description: `Lead "${payload.accountName}" was edited`,
        previousValue: old?.accountName,
        newValue: payload.accountName,
        actionBy: user.username,
        timestamp: new Date().toISOString(),
      });
    } else {
      await addDoc(collection(db, COLLECTION), {
        ...payload,
        createdAt: new Date().toISOString(),
      });
      // ── updated logActivity signature ──
      await logActivity(payload.leadId, payload.accountName, "leads", {
        actionType: "LEAD_ADDED",
        description: `New lead "${payload.accountName}" was added`,
        actionBy: user.username,
        timestamp: new Date().toISOString(),
      });
    }
    resetForm();
  };

  const resetForm = () => {
    setFormData({ ...EMPTY_LEAD });
    setEditingId(null);
    setShowForm(false);
    setFormErrors({});
  };

  const startEdit = (lead: Lead) => {
    setFormData({ ...lead });
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
    setDeleteModal(null);
  };

  // ── Status update ──
  const updateStatus = async (lead: Lead, newStatus: string) => {
    const old = lead.status;
    await updateDoc(doc(db, COLLECTION, lead.id), { status: newStatus, updatedAt: new Date().toISOString() });
    // ── updated logActivity signature ──
    await logActivity(lead.leadId, lead.accountName, "leads", {
      actionType: "LEAD_STATUS_CHANGED",
      description: `Status changed from "${old}" → "${newStatus}"`,
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
      "Lead Date":          (l) => l.leadDate || "",
      "Client Name":        (l) => l.accountName,
      "Program Name":       (l) => (l as any).programName || "",
      "Project Name":       (l) => l.projectId,
      "Engagement Name":    (l) => l.engagementName,
      "Engagement Type":    (l) => l.engagementType,
      "Client SPOC":        (l) => l.clientSpoc,
      "Client Designation": (l) => l.clientSpocPosition,
      "Client Email":       (l) => l.clientEmail,
      "Client Phone":       (l) => l.clientPhone,
      "Partner SPOC":       (l) => l.partnerSpoc,
      "Partner Designation":(l) => l.partnerSpocPosition,
      "Partner Email":      (l) => l.partnerEmail,
      "Partner Phone":      (l) => l.partnerPhone,
      "Status":             (l) => l.status,
      "Remarks":            (l) => l.remarks,
    };
    // Only export visible columns
    const visibleKeys = Object.keys(allCols).filter(k => visibleCols[k]);
    const rows = filtered.map((l) =>
      Object.fromEntries(visibleKeys.map(k => [k, allCols[k](l)]))
    );
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Leads");
    XLSX.writeFile(wb, `Leads_${new Date().toISOString().slice(0, 10)}.xlsx`);
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

      let count = 0;
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

        const hasContent = Object.entries(lead).some(([key, value]) => (
          !["createdAt", "updatedAt", "status"].includes(key) && String(value || "").trim() !== ""
        ));
        if (!hasContent) continue;

        if (!lead.leadId) lead.leadId = generateLeadId();

        await addDoc(collection(db, COLLECTION), lead);
        // ── updated logActivity signature ──
        await logActivity(lead.leadId, lead.accountName, "leads", {
          actionType: "LEAD_ADDED",
          description: `Lead "${lead.accountName}" imported from Excel`,
          actionBy: user.username,
          timestamp: new Date().toISOString(),
        });
        count++;
      }
      setImportResult(`✅ Imported ${count} lead${count !== 1 ? "s" : ""} successfully.`);
    } catch (err) {
      setImportResult("❌ Import failed. Check your Excel format.");
    } finally {
      setImporting(false);
      if (importRef.current) importRef.current.value = "";
    }
  };

  const logout = () => {
    signOut(auth);
    localStorage.removeItem("leadUser");
    window.location.reload();
  };

  // ── Stats ──
  const stats = STATUSES.map((s) => ({
    status: s,
    count: leads.filter((l) => l.status === s).length,
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
          <button onClick={logout} style={S.btnLogout}>Logout</button>
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
          <span style={S.statNum}>{leads.length}</span>
          <span style={S.statLabel}>Total Leads</span>
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
            placeholder="Search leads…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={S.searchInput}
          />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={S.select}>
            <option value="All">All Statuses</option>
            {STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
          <button onClick={() => setShowColModal(true)} style={S.btnOutline}>Columns</button>
          <label style={S.btnOutline}>
            {importing ? "Importing..." : "Import Excel"}
            <input
              ref={importRef}
              type="file"
              accept=".xlsx,.xls"
              style={{ display: "none" }}
              onChange={handleImport}
              disabled={importing}
            />
          </label>
          <button onClick={downloadExcel} style={S.btnDark}>Export Excel</button>
          <button
            onClick={() => { setShowForm(true); setEditingId(null); setFormData({ ...EMPTY_LEAD }); }}
            style={S.btnPrimary}
          >
            + Add Lead
          </button>
        </div>
      </div>

      {/* ── Add/Edit Form ── */}
      {showForm && (
        <div style={S.formCard}>
          <div style={S.formHeader}>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>{editingId ? "Edit Lead" : "Add New Lead"}</h2>
            <button onClick={resetForm} style={S.closeBtn}>✕</button>
          </div>
          <form onSubmit={handleSubmit}>
            <div style={S.formGrid}>
              {/* Lead Date */}
              <div style={S.formField}>
                <label style={S.fLabel}>Lead Date</label>
                <input
                  type="date"
                  style={S.fInput}
                  value={formData.leadDate || new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setFormData({ ...formData, leadDate: e.target.value })}
                />
              </div>

              {[
                { label: "Client Name", key: "accountName", required: true },
                { label: "Program Name", key: "programName", tooltip: "The overall program or initiative this engagement falls under" },
                { label: "Project Name", key: "projectId" },
                { label: "Engagement Name", key: "engagementName", tooltip: "Name of the specific engagement within the project" },
                { label: "Engagement Type", key: "engagementType", tooltip: "e.g. M&S Project, Consulting, Support, Implementation", isEngagementType: true },
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
                <select style={S.fInput} value={formData.status} onChange={(e) => setFormData({ ...formData, status: e.target.value })}>
                  {STATUSES.map((s) => <option key={s}>{s}</option>)}
                </select>
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
                  { label: "Phone", key: "clientPhone" },
                ].map(({ label, key }) => (
                  <div key={key} style={S.formField}>
                    <label style={S.fLabel}>{label}</label>
                    <input
                      style={{ ...S.fInput, borderColor: formErrors[key] ? "#ef4444" : "" }}
                      value={(formData as any)[key]}
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
                  { label: "Phone", key: "partnerPhone" },
                ].map(({ label, key }) => (
                  <div key={key} style={S.formField}>
                    <label style={S.fLabel}>{label}</label>
                    <input
                      style={{ ...S.fInput, borderColor: formErrors[key] ? "#ef4444" : "" }}
                      value={(formData as any)[key]}
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
              />
            </div>

            <div style={{ padding: "0 24px 24px", display: "flex", gap: 10 }}>
              <button type="submit" style={S.btnPrimary}>{editingId ? "Save Changes" : "Add Lead"}</button>
              <button type="button" onClick={resetForm} style={S.btnOutline}>Cancel</button>
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
                {(["Lead Date","Client Name","Program Name","Project Name","Engagement Name","Engagement Type",
                  "Client SPOC","Client Designation","Client Email","Client Phone",
                  "Partner SPOC","Partner Designation","Partner Email","Partner Phone",
                  "Status","Remarks"] as string[]).filter(h => visibleCols[h]).concat(["Actions"]).map((h) => (
                  <th key={h} style={h === "Actions" ? S.thSticky : S.th}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      {h}
                      {({
                        "Program Name": "The overall program or initiative this engagement falls under",
                        "Engagement Name": "Name of the specific engagement within the project",
                        "Engagement Type": "e.g. Development, M&S, Consulting, Support, Implementation",

                       
                      } as Record<string,string>)[h] && <Tooltip text={({
                        "Program Name": "The overall program or initiative this engagement falls under",
                        "Engagement Name": "Name of the specific engagement within the project",
                        "Engagement Type": "e.g. Development, M&S, Consulting, Support, Implementation",
                        
                      } as Record<string,string>)[h]} />}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={Object.values(visibleCols).filter(Boolean).length + 1} style={{ textAlign: "center", padding: "48px 0", color: "#94a3b8", fontSize: 14 }}>
                    No leads found. Add one or import from Excel.
                  </td>
                </tr>
              )}
              {filtered.map((lead) => (
                <tr key={lead.id} style={S.tr}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#f8fafc")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "")}>
                  {visibleCols["Lead Date"] && <td style={{ ...S.td, whiteSpace: "nowrap", color: "#64748b" }}>{lead.leadDate || "-"}</td>}
                  {visibleCols["Client Name"] && <td style={{ ...S.td, fontWeight: 600, minWidth: 140 }}>{lead.accountName}</td>}
                  {visibleCols["Program Name"] && <td style={{ ...S.td, minWidth: 140 }}>{(lead as any).programName || "-"}</td>}
                  {visibleCols["Project Name"] && <td style={S.td}>{lead.projectId}</td>}
                  {visibleCols["Engagement Name"] && <td style={{ ...S.td, minWidth: 160 }}>{lead.engagementName}</td>}
                  {visibleCols["Engagement Type"] && <td style={S.td}>{lead.engagementType}</td>}
                  {visibleCols["Client SPOC"] && <td style={S.td}>{lead.clientSpoc}</td>}
                  {visibleCols["Client Designation"] && <td style={S.td}>{lead.clientSpocPosition}</td>}
                  {visibleCols["Client Email"] && <td style={{ ...S.td, color: "#2563eb" }}>
                    {lead.clientEmail ? <a href={`mailto:${lead.clientEmail}`} style={{ color: "#2563eb" }}>{lead.clientEmail}</a> : "-"}
                  </td>}
                  {visibleCols["Client Phone"] && <td style={S.td}>{lead.clientPhone || "-"}</td>}
                  {visibleCols["Partner SPOC"] && <td style={S.td}>{lead.partnerSpoc}</td>}
                  {visibleCols["Partner Designation"] && <td style={S.td}>{lead.partnerSpocPosition}</td>}
                  {visibleCols["Partner Email"] && <td style={{ ...S.td, color: "#2563eb" }}>
                    {lead.partnerEmail ? <a href={`mailto:${lead.partnerEmail}`} style={{ color: "#2563eb" }}>{lead.partnerEmail}</a> : "-"}
                  </td>}
                  {visibleCols["Partner Phone"] && <td style={S.td}>{lead.partnerPhone || "-"}</td>}
                  {visibleCols["Status"] && <td style={S.td}>
                    <select value={lead.status} onChange={(e) => updateStatus(lead, e.target.value)}
                      style={{ ...S.statusSelect, background: STATUS_COLORS[lead.status]?.bg, color: STATUS_COLORS[lead.status]?.color }}>
                      {STATUSES.map((s) => <option key={s}>{s}</option>)}
                    </select>
                  </td>}
                  {visibleCols["Remarks"] && <td style={{ ...S.td, minWidth: 200, maxWidth: 240, color: "#64748b", fontSize: 12, whiteSpace: "pre-wrap" }}>
                    {lead.remarks || <span style={{ color: "#cbd5e1", fontStyle: "italic" }}>No remarks</span>}
                  </td>}

                  {/* Actions */}
                  <td style={S.tdSticky}>
                    <div style={{ display: "flex", gap: 6, flexDirection: "column" }}>
                      <button onClick={() => startEdit(lead)} style={S.editBtn}>Edit</button>
                      <button onClick={() => onNavigate("transactions", lead.leadId)} style={S.txnBtn}>Act</button>
                      <button onClick={() => deleteLead(lead)} style={S.deleteBtn}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 12, fontSize: 12, color: "#94a3b8" }}>
          Showing {filtered.length} of {leads.length} leads · Logged in as <b>{user.username}</b>
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
              { title: "Lead Info", cols: ["Lead Date", "Client Name", "Program Name", "Project Name", "Engagement Name", "Engagement Type", "Status", "Remarks"] },
              { title: "Client SPOC", cols: ["Client SPOC", "Client Designation", "Client Email", "Client Phone"] },
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
          title="Delete Lead"
          itemName={`${deleteModal.lead.leadId} — ${deleteModal.lead.accountName}`}
          warning={deleteModal.txnCount > 0
            ? `This lead has ${deleteModal.txnCount} activity${deleteModal.txnCount > 1 ? "s" : ""}. Please delete them first before deleting this lead.`
            : undefined}
          onConfirm={confirmDeleteLead}
          onCancel={() => setDeleteModal(null)}
        />
      )}
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
  tableWrap: {
    overflowX: "auto",
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
    zIndex: 3,
    boxShadow: "-2px 0 6px rgba(0,0,0,0.06)",
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
