import { Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";
import Login from "./pages/Login";
import LeadDashboard from "./pages/LeadDashboard";
import Transactions from "./pages/Transactions";
import Deals from "./pages/Deals";
import ActivityLog from "./pages/ActivityLog";
import Users from "./pages/Users";
import { getPagePath, Page } from "./navigation";

function LeadActivitiesRoute({ onNavigate }: { onNavigate: (p: Page, leadId?: string) => void }) {
  const { leadId } = useParams();
  return <Transactions onNavigate={onNavigate} routeLeadId={leadId || null} />;
}

function AppRoutes({ role }: { role: string }) {
  const navigate = useNavigate();

  const handleNavigate = (page: Page, leadId?: string) => {
    navigate(getPagePath(page, leadId));
  };

  const adminOnly = (element: JSX.Element) =>
    role === "admin" ? element : <Navigate to="/leads" replace />;

  return (
    <Routes>
      <Route path="/" element={<Navigate to="/leads" replace />} />
      <Route path="/leads" element={<LeadDashboard onNavigate={handleNavigate} />} />
      <Route path="/activities" element={<Transactions onNavigate={handleNavigate} />} />
      <Route path="/leads/:leadId/activities" element={<LeadActivitiesRoute onNavigate={handleNavigate} />} />
      <Route path="/deals" element={<Deals onNavigate={handleNavigate} />} />
      <Route path="/activity-log" element={adminOnly(<ActivityLog onNavigate={handleNavigate} />)} />
      <Route path="/users" element={adminOnly(<Users onNavigate={handleNavigate} />)} />
      <Route path="*" element={<Navigate to="/leads" replace />} />
    </Routes>
  );
}

export default function App() {
  const rawUser = localStorage.getItem("leadUser");

  if (!rawUser) return <Login />;

  const user = JSON.parse(rawUser);
  return <AppRoutes role={user.role} />;
}
