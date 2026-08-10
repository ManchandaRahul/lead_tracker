export type SessionUser = {
  username?: string;
  role?: "admin" | "user" | "restricted_user";
  uid?: string;
  email?: string;
  allowedLeadIds?: string[];
};

type AssignedAction = {
  assignedTo?: string | null;
};

type ProspectVisibilityRecord = {
  leadId?: string | null;
  handledBy?: string | null;
  actions?: AssignedAction[] | null;
  recordViewableBy?: string[] | null;
};

type LeadVisibilityRecord = {
  leadId?: string | null;
  handledBy?: string | null;
  actions?: AssignedAction[] | null;
};

export function normalizeUserKey(value?: string | null) {
  return String(value || "").trim().toLowerCase();
}

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

export function isPrimaryAdmin(user: SessionUser) {
  return (
    user.role === "admin" &&
    normalizeUserKey(user.username) === "admin" &&
    normalizeUserKey(user.email) === "admin@leadtracker.app"
  );
}

export function canAccessLead(user: SessionUser, leadId?: string | null) {
  if (!leadId) return false;
  if (!isRestrictedUser(user)) return false;
  return getAllowedLeadIds(user).includes(leadId);
}

export function canUserSeeProspect(user: SessionUser, prospect?: ProspectVisibilityRecord | null) {
  if (!prospect) return false;
  if (isPrimaryAdmin(user)) return true;

  const currentUser = normalizeUserKey(user.username);
  if (!currentUser) return false;

  if (canAccessLead(user, prospect.leadId)) return true;
  if (normalizeUserKey(prospect.handledBy) === currentUser) return true;

  const visibleUsers = Array.isArray(prospect.recordViewableBy) ? prospect.recordViewableBy : [];
  if (visibleUsers.some((value) => normalizeUserKey(value) === currentUser)) return true;

  return (prospect.actions || []).some(
    (action) => normalizeUserKey(action?.assignedTo) === currentUser
  );
}

export function canUserSeeLead(
  user: SessionUser,
  lead?: LeadVisibilityRecord | null,
  linkedProspect?: ProspectVisibilityRecord | null
) {
  if (!lead) return false;
  if (isPrimaryAdmin(user)) return true;

  const currentUser = normalizeUserKey(user.username);
  if (!currentUser) return false;

  if (canAccessLead(user, lead.leadId)) return true;
  if (normalizeUserKey(lead.handledBy) === currentUser) return true;
  if ((lead.actions || []).some((action) => normalizeUserKey(action?.assignedTo) === currentUser)) {
    return true;
  }

  return canUserSeeProspect(user, linkedProspect);
}

export function canManageOwnedRecord(user: SessionUser, handledBy?: string | null) {
  if (isPrimaryAdmin(user)) return true;
  const owner = normalizeUserKey(handledBy);
  const currentUser = normalizeUserKey(user.username);
  return !!owner && owner === currentUser;
}

export function getRecordCollaborators(
  handledBy?: string | null,
  actions?: Array<{ assignedTo?: string | null }>
) {
  const collaborators = new Set<string>();
  const owner = String(handledBy || "").trim();
  if (owner) collaborators.add(owner);
  for (const action of actions || []) {
    const assignedTo = String(action?.assignedTo || "").trim();
    if (assignedTo) collaborators.add(assignedTo);
  }
  return Array.from(collaborators).sort((a, b) => a.localeCompare(b));
}

export function canManageAssignedAction(
  user: SessionUser,
  handledBy?: string | null,
  actions?: Array<{ assignedTo?: string | null }>
) {
  if (isPrimaryAdmin(user)) return true;
  const currentUser = normalizeUserKey(user.username);
  return getRecordCollaborators(handledBy, actions).some(
    (username) => normalizeUserKey(username) === currentUser
  );
}
