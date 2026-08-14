// Deliberately dependency-free so it can be unit-tested with node --test.
export const LEAD_STATUS_SENDING = "Sending";
export const LEAD_STATUS_SENT = "Sent";
export const LEAD_STATUS_ERROR = "Error";

export const STUCK_AFTER_MS = 15 * 60_000;

/** Marker written before the mail API is called, so a crashed tick is recoverable. */
export function sendingMarker(now = new Date()): string {
  return `${LEAD_STATUS_SENDING} ${now.toISOString()}`;
}

/**
 * A row is claimable when nobody has touched it, or when a previous tick died
 * after claiming it and left a stale "Sending <iso>" marker behind.
 */
export function isClaimable(statusValue: string, now = Date.now()): boolean {
  const value = statusValue.trim();
  if (value === "") return true;
  if (!value.startsWith(LEAD_STATUS_SENDING)) return false;
  const stamp = Date.parse(value.slice(LEAD_STATUS_SENDING.length).trim());
  return !Number.isFinite(stamp) || stamp < now - STUCK_AFTER_MS;
}
