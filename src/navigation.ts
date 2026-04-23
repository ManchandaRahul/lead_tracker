export type Page = "leads" | "transactions" | "deals" | "activity" | "users";

export function getPagePath(page: Page, leadId?: string) {
  switch (page) {
    case "leads":
      return "/leads";
    case "transactions":
      return leadId ? `/leads/${encodeURIComponent(leadId)}/activities` : "/activities";
    case "deals":
      return "/deals";
    case "activity":
      return "/activity-log";
    case "users":
      return "/users";
    default:
      return "/leads";
  }
}
