import { useState } from "react";
import Login from "./pages/Login";
import LeadDashboard from "./pages/LeadDashboard";
import Transactions from "./pages/Transactions";
import ActivityLog from "./pages/ActivityLog";

type Page = "leads" | "transactions" | "activity";

export default function App() {
  const rawUser = localStorage.getItem("leadUser");
  const [page, setPage] = useState<Page>("leads");
  const [filterLeadId, setFilterLeadId] = useState<string | null>(null);

  if (!rawUser) return <Login />;

  const user = JSON.parse(rawUser);

  // Guard: non-admin cannot access activity log
  const safePage = page === "activity" && user.role !== "admin" ? "leads" : page;

  const handleNavigate = (p: Page, leadId?: string) => {
    setFilterLeadId(leadId || null);
    setPage(p);
  };

  if (safePage === "transactions") return <Transactions onNavigate={handleNavigate} filterLeadId={filterLeadId} />;
  if (safePage === "activity")     return <ActivityLog  onNavigate={handleNavigate} />;
  return <LeadDashboard onNavigate={handleNavigate} />;
}