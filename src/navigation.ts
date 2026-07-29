export type Page = "leads" | "transactions" | "activityDetail" | "deals" | "activity" | "followUps" | "users";

export function getPagePath(page: Page, leadId?: string) {
  switch (page) {
    case "leads":
      return "/leads";
    case "transactions":
      return leadId ? `/leads/${encodeURIComponent(leadId)}/activities` : "/activities";
    case "activityDetail":
      return leadId ? `/activities/${encodeURIComponent(leadId)}` : "/activities";
    case "deals":
      return "/deals";
    case "activity":
      return "/activity-log";
    case "followUps":
      return "/follow-ups";
    case "users":
      return "/users";
    default:
      return "/leads";
  }
}
