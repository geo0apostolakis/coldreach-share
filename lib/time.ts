/**
 * All campaign scheduling is done on calendar dates in the campaign's own
 * timezone. Dates are compared as "YYYY-MM-DD" strings rather than by Date
 * arithmetic, which silently drifts across DST boundaries.
 */

export function formatDateInTz(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function formatTimeInTz(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

/** Whole days between two "YYYY-MM-DD" strings, treated as UTC midnights. */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

export function minutesOfDay(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  if (!Number.isFinite(hours)) return 0;
  return hours * 60 + (Number.isFinite(minutes) ? minutes : 0);
}

export function isWithinWindow(now: Date, timezone: string, start: string, end: string): boolean {
  const current = minutesOfDay(formatTimeInTz(now, timezone));
  return current >= minutesOfDay(start) && current < minutesOfDay(end);
}

/**
 * True once the campaign's local date has reached its start date. Compares the
 * two "YYYY-MM-DD" strings, which sort correctly. An empty start date means the
 * campaign has no scheduled future start, so it counts as already started.
 */
export function hasStarted(startDate: string, today: string): boolean {
  if (!startDate) return true;
  return today >= startDate;
}

/** Daily quota for a given campaign day (day 1 = first day of sending). */
export function quotaForDay(
  day: number,
  firstDayVolume: number,
  dailyIncrement: number,
  maxDailyLimit: number,
): number {
  if (day < 1) return 0;
  const ramped = firstDayVolume + dailyIncrement * (day - 1);
  return Math.max(0, Math.min(ramped, maxDailyLimit));
}

/**
 * One timezone for all reporting. Per-campaign timezones would stop folder
 * totals from summing, and comparing a YYYY-MM-DD bound against a UTC ISO
 * timestamp misfiles anything that happened near midnight locally.
 */
export const REPORTING_TIMEZONE = "Europe/Athens";

/** Inclusive on both ends. A blank bound means unbounded. */
export function withinRange(date: string, range: { from?: string; to?: string }): boolean {
  if (!date) return false;
  if (range.from && date < range.from) return false;
  if (range.to && date > range.to) return false;
  return true;
}

/** Turns a UTC ISO timestamp into its calendar date in the reporting timezone. */
export function isoToReportingDate(iso: string): string {
  if (!iso) return "";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "";
  return formatDateInTz(parsed, REPORTING_TIMEZONE);
}
