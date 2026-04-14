import { useState } from "react";
import Login from "./pages/Login";
import LeadDashboard from "./pages/LeadDashboard";
import Transactions from "./pages/Transactions";
import ActivityLog from "./pages/ActivityLog";
import Users from "./pages/Users";

type Page = "leads" | "transactions" | "activity" | "users";

export default function App() {
  const rawUser = localStorage.getItem("leadUser");
  const [page, setPage] = useState<Page>("leads");
  const [filterLeadId, setFilterLeadId] = useState<string | null>(null);

  if (!rawUser) return <Login />;

  const user = JSON.parse(rawUser);

  // Guard: non-admin cannot access admin pages
  const safePage = (page === "activity" || page === "users") && user.role !== "admin" ? "leads" : page;

  const handleNavigate = (p: Page, leadId?: string) => {
    setFilterLeadId(leadId || null);
    setPage(p);
  };

  if (safePage === "transactions") return <Transactions onNavigate={handleNavigate} filterLeadId={filterLeadId} />;
  if (safePage === "activity")     return <ActivityLog  onNavigate={handleNavigate} />;
  if (safePage === "users")        return <Users onNavigate={handleNavigate} />;
  return <LeadDashboard onNavigate={handleNavigate} />;
}
