/**
 * Pure maths only. No network, no Google client, no Next imports, so this file
 * can be imported straight into scripts/selftest.mjs and unit tested.
 *
 * Every ratio here returns null rather than Infinity or 0 when its denominator
 * is empty. "No data yet" and "zero" are different answers, and showing 0 for
 * the first would make a healthy campaign look dead.
 */
import type { Outcome, OutcomeType } from "./types";

export function ratio(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(denominator) || denominator <= 0) return null;
  return numerator / denominator;
}

export function rate(part: number, whole: number): number | null {
  const value = ratio(part, whole);
  return value === null ? null : value * 100;
}

/**
 * Lifetime gross profit for one closed deal. Recurring deals multiply out the
 * expected months; one-off deals do not. Margin is a percentage, so 60 means
 * 60 percent of the value is profit.
 */
export function grossProfit(outcome: Outcome): number {
  if (outcome.type !== "closed") return 0;
  const margin = (outcome.grossMarginPct || 0) / 100;
  const revenue =
    outcome.dealType === "recurring"
      ? (outcome.monthlyValueUsd || 0) * (outcome.expectedMonths || 0)
      : outcome.dealValueUsd || 0;
  return revenue * margin;
}

/** Total contract value before margin, used for ROAS. */
export function revenue(outcome: Outcome): number {
  if (outcome.type !== "closed") return 0;
  return outcome.dealType === "recurring"
    ? (outcome.monthlyValueUsd || 0) * (outcome.expectedMonths || 0)
    : outcome.dealValueUsd || 0;
}

/** Monthly gross profit, the denominator of the payback period. */
export function monthlyGrossProfit(outcome: Outcome): number {
  if (outcome.type !== "closed" || outcome.dealType !== "recurring") return 0;
  return (outcome.monthlyValueUsd || 0) * ((outcome.grossMarginPct || 0) / 100);
}

export type Funnel = Record<OutcomeType, number>;

export function countByType(outcomes: Outcome[]): Funnel {
  const counts: Funnel = { positive_reply: 0, booked: 0, showed: 0, closed: 0, lost: 0 };
  for (const outcome of outcomes) {
    if (outcome.type in counts) counts[outcome.type] += 1;
  }
  return counts;
}

export type SpendBreakdown = { apify: number; ai: number; other: number; total: number };

export type Volume = {
  leadsTotal: number;
  leadsContacted: number;
  emailsSent: number;
  bounced: number;
  replied: number;
};

export type Metrics = {
  volume: Volume & { delivered: number };
  funnel: Funnel;
  spend: SpendBreakdown;
  money: {
    revenue: number;
    ltgp: number;
    ltgpPerCustomer: number | null;
    cac: number | null;
    ltgpToCac: number | null;
    contributionMargin: number | null;
    roas: number | null;
    paybackMonths: number | null;
    costPerLead: number | null;
    costPerPositiveReply: number | null;
    costPerBookedCall: number | null;
    costPerShow: number | null;
    grossProfitPerLead: number | null;
  };
  rates: {
    contactRate: number | null;
    bounceRate: number | null;
    replyRate: number | null;
    positiveReplyRate: number | null;
    bookingRate: number | null;
    showRate: number | null;
    closeRate: number | null;
    leadToCloseRate: number | null;
    emailsPerClose: number | null;
    leadsPerClose: number | null;
  };
};

export function computeMetrics(
  volume: Volume,
  outcomes: Outcome[],
  spend: SpendBreakdown,
): Metrics {
  const funnel = countByType(outcomes);
  const closedDeals = outcomes.filter((outcome) => outcome.type === "closed");

  const ltgp = closedDeals.reduce((sum, outcome) => sum + grossProfit(outcome), 0);
  const totalRevenue = closedDeals.reduce((sum, outcome) => sum + revenue(outcome), 0);
  const customers = closedDeals.length;

  const cac = ratio(spend.total, customers);
  const ltgpPerCustomer = ratio(ltgp, customers);

  // Payback uses only the recurring deals, because a one-off has no monthly
  // profit to pay the acquisition cost back with.
  const recurring = closedDeals.filter((outcome) => outcome.dealType === "recurring");
  const avgMonthlyGp = ratio(
    recurring.reduce((sum, outcome) => sum + monthlyGrossProfit(outcome), 0),
    recurring.length,
  );

  const delivered = Math.max(0, volume.emailsSent - volume.bounced);
  const leadToClose = rate(funnel.closed, volume.leadsContacted);

  return {
    volume: { ...volume, delivered },
    funnel,
    spend,
    money: {
      revenue: totalRevenue,
      ltgp,
      ltgpPerCustomer,
      cac,
      ltgpToCac: ltgpPerCustomer !== null && cac !== null && cac > 0 ? ltgpPerCustomer / cac : null,
      contributionMargin: ltgpPerCustomer !== null && cac !== null ? ltgpPerCustomer - cac : null,
      roas: ratio(totalRevenue, spend.total),
      paybackMonths: cac !== null && avgMonthlyGp !== null && avgMonthlyGp > 0 ? cac / avgMonthlyGp : null,
      costPerLead: ratio(spend.total, volume.leadsContacted),
      costPerPositiveReply: ratio(spend.total, funnel.positive_reply),
      costPerBookedCall: ratio(spend.total, funnel.booked),
      costPerShow: ratio(spend.total, funnel.showed),
      grossProfitPerLead: ratio(ltgp, volume.leadsContacted),
    },
    rates: {
      contactRate: rate(volume.leadsContacted, volume.leadsTotal),
      bounceRate: rate(volume.bounced, volume.emailsSent),
      replyRate: rate(volume.replied, volume.leadsContacted),
      positiveReplyRate: rate(funnel.positive_reply, volume.leadsContacted),
      bookingRate: rate(funnel.booked, funnel.positive_reply),
      showRate: rate(funnel.showed, funnel.booked),
      closeRate: rate(funnel.closed, funnel.showed),
      leadToCloseRate: leadToClose,
      emailsPerClose: ratio(volume.emailsSent, funnel.closed),
      leadsPerClose: ratio(volume.leadsContacted, funnel.closed),
    },
  };
}

/**
 * Hormozi's stated targets: 3:1 with no human interaction, 6:1 with some human
 * element, 9:1 or higher with multiple human touchpoints. Cold email into a
 * sales call is human-heavy, so the defaults sit at the upper end. Kept as
 * defaults rather than constants so the bands stay editable in settings.
 */
export const DEFAULT_LTGP_CAC_BANDS = { bad: 3, ok: 6, target: 9 };

export function ltgpCacHealth(
  value: number | null,
  bands = DEFAULT_LTGP_CAC_BANDS,
): "unknown" | "bad" | "ok" | "good" {
  if (value === null || !Number.isFinite(value)) return "unknown";
  if (value < bands.bad) return "bad";
  if (value < bands.ok) return "ok";
  return "good";
}

export type DaySend = { date: string; sender: string; count: number };

/**
 * Emails per day per sending address, newest day first.
 *
 * This is the deliverability dial. Reputation is earned per mailbox and per
 * domain, so what matters is not the total but how many went out of each
 * individual address on each day.
 */
export function dailyVolume(
  rows: { date: string; sender: string }[],
  days = 14,
): { dates: string[]; senders: string[]; counts: Record<string, Record<string, number>>; perDayTotal: Record<string, number> } {
  const counts: Record<string, Record<string, number>> = {};
  const perDayTotal: Record<string, number> = {};
  const senderSet = new Set<string>();

  for (const row of rows) {
    if (!row.date) continue;
    const sender = row.sender || "unknown";
    senderSet.add(sender);
    counts[row.date] ??= {};
    counts[row.date][sender] = (counts[row.date][sender] ?? 0) + 1;
    perDayTotal[row.date] = (perDayTotal[row.date] ?? 0) + 1;
  }

  const dates = Object.keys(counts).sort().reverse().slice(0, days);
  return { dates, senders: [...senderSet].sort(), counts, perDayTotal };
}

/**
 * Warm-up guidance per mailbox. A brand new address should not open at volume:
 * the usual practice is to start small and add a few a day, holding well under
 * fifty per mailbox per day on shared infrastructure.
 */
export const SAFE_DAILY_PER_MAILBOX = { warmingCap: 20, steadyCap: 40, hardCap: 50 };

export function senderHealth(sentToday: number): "ok" | "warn" | "bad" {
  if (sentToday > SAFE_DAILY_PER_MAILBOX.hardCap) return "bad";
  if (sentToday > SAFE_DAILY_PER_MAILBOX.steadyCap) return "warn";
  return "ok";
}
