export function formatLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function isBusinessDay(dateStr?: string) {
  if (!dateStr) return true;
  const [year, month, day] = String(dateStr).split("-").map(Number);
  if (!year || !month || !day) return false;
  const localDate = new Date(year, month - 1, day);
  const weekDay = localDate.getDay();
  return weekDay >= 1 && weekDay <= 5;
}

export function getBusinessDayError(dateStr?: string, label = "Next follow-up date") {
  if (!dateStr) return "";
  return isBusinessDay(dateStr) ? "" : `${label} must be a business day (Monday to Friday).`;
}

export function isTodayFollowUp(dateStr?: string) {
  if (!dateStr) return false;
  return String(dateStr) === formatLocalDateKey();
}

export function isMissedFollowUp(dateStr?: string, timeStr?: string) {
  if (!dateStr) return false;
  const compareTime = timeStr || "23:59";
  const candidate = new Date(`${dateStr}T${compareTime}`);
  return candidate.getTime() < Date.now();
}
