/**
 * When a lead is due another email, and which step it should be.
 *
 * Policy only. Date arithmetic stays in time.ts and arrives here as a number of
 * elapsed days, so this file has no imports at all and the self-test can load
 * it directly, the same arrangement as inbound-classify.ts and lead-status.ts.
 */

/** What the Email Log knows about one lead on one campaign. */
export type SendRecord = {
  /** Emails already sent to this lead, first touch included. */
  count: number;
  /** Calendar date of the most recent send, in the campaign timezone. */
  lastDate: string;
  /** Subject of the most recent send, used to build "Re: ..." */
  lastSubject: string;
};

export const MAX_FOLLOW_UPS = 3;

/** 0 disables follow-ups. Anything above 3 is clamped, which is George's cap. */
export function clampMaxFollowUps(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(Math.floor(value), MAX_FOLLOW_UPS);
}

export function clampDayGap(value: number): number {
  if (!Number.isFinite(value) || value < 1) return 1;
  return Math.floor(value);
}

/**
 * A lead is due a follow-up when it has had at least one email, has not used up
 * its allowance, and enough calendar days have passed.
 *
 * A lead with no send history is never due one: that is the case of the rows an
 * older tool marked "Sent" without logging anything here, and emailing those
 * again on a guess would be worse than skipping them.
 */
export function followUpDue(
  record: SendRecord | undefined,
  settings: { dayGap: number; maxFollowUps: number },
  daysSinceLast: number,
): boolean {
  const max = clampMaxFollowUps(settings.maxFollowUps);
  if (max === 0) return false;
  if (!record || record.count < 1 || !record.lastDate) return false;

  // count includes the first touch, so follow-ups already sent is count - 1.
  if (record.count - 1 >= max) return false;

  return daysSinceLast >= clampDayGap(settings.dayGap);
}

/** 0-based index into the configured follow-up steps. */
export function followUpStepIndex(record: SendRecord): number {
  return Math.max(0, record.count - 1);
}

/**
 * Steps are reused from the last one when fewer are written than the allowance,
 * so setting max to 3 with a single step still sends three, rather than sending
 * a blank email twice.
 */
export function stepAt<T>(steps: T[], index: number): T | undefined {
  if (steps.length === 0) return undefined;
  return steps[Math.min(index, steps.length - 1)];
}

/** Follow-up subjects default to replying to whatever went out last. */
export function followUpSubject(configured: string, lastSubject: string): string {
  const trimmed = configured.trim();
  if (trimmed) return trimmed;
  if (!lastSubject) return "";
  return /^re:/i.test(lastSubject) ? lastSubject : `Re: ${lastSubject}`;
}
