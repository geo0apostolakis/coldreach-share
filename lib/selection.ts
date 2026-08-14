/**
 * Which rows a tick may touch. Policy only, over fields the caller has already
 * pulled off the row, so this file has no imports and the self-test can load it
 * directly, the same arrangement as follow-up.ts and lead-status.ts.
 */

/** The default written on a send when a campaign has not set its own word. */
export const DEFAULT_SENT_VALUE = "Sent";

/**
 * True when the status cell means "this lead has had an email".
 *
 * Compares against the campaign's own configured word, not a hardcoded "Sent".
 * A campaign whose sentValue is "Done" or "Έγινε" was previously counted as
 * zero contacted, which silently emptied the contact rate, the reply rate and
 * every cost-per-lead figure derived from them.
 *
 * The suffix allowance is for follow-ups, which append " +1", " +2".
 */
export function isSentStatus(status: string, sentValue: string): boolean {
  const value = (status || "").trim().toLowerCase();
  if (!value) return false;
  const expected = (sentValue || DEFAULT_SENT_VALUE).trim().toLowerCase();
  return value === expected || value.startsWith(`${expected} `) || value.startsWith(`${expected}+`);
}

export type RowFacts = {
  /** Addresses parsed out of the email cell. */
  emails: string[];
  status: string;
  /** Value in the campaign's inbound column, or "" when inbound is off. */
  inboundValue: string;
  sentValue: string;
};

/**
 * A row may be followed up when it was really sent to, is not mid-flight, did
 * not error, and the inbound processor has not marked it.
 *
 * The inbound check is the whole reason automated follow-ups are safe: it is
 * what stops a second email going to somebody who already replied or whose
 * address bounced.
 */
export function isFollowUpCandidate(facts: RowFacts): boolean {
  if (facts.emails.length === 0) return false;
  if (facts.inboundValue.trim()) return false;
  return isSentStatus(facts.status, facts.sentValue);
}
