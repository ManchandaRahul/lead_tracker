export type SessionUser = {
  username?: string;
  role?: "admin" | "user" | "restricted_user";
  uid?: string;
  email?: string;
  allowedLeadIds?: string[];
};

export function getSessionUser(): SessionUser {
  try {
    return JSON.parse(localStorage.getItem("leadUser") || "{}");
  } catch {
    return {};
  }
}

export function getAllowedLeadIds(user: SessionUser) {
  return Array.isArray(user.allowedLeadIds) ? user.allowedLeadIds.filter(Boolean) : [];
}

export function isRestrictedUser(user: SessionUser) {
  return user.role === "restricted_user";
}

export function canAccessLead(user: SessionUser, leadId?: string | null) {
  if (!leadId) return true;
  if (!isRestrictedUser(user)) return true;
  return getAllowedLeadIds(user).includes(leadId);
}
