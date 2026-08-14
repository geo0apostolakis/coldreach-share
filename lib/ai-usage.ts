/**
 * Pure parsing of OpenRouter's inline usage block. Kept apart from ai.ts so it
 * can be unit tested: ai.ts pulls in ./types, which the test runner's type
 * stripping cannot resolve.
 *
 * Asking for `usage: { include: true }` puts the cost in the completion
 * response. The separate /generation endpoint reports the same number but only
 * settles roughly eight seconds later, measured against the live API, which
 * would mean sleeping on every send and every classifier batch.
 */
export type UsageBlock = { cost?: number } | undefined;

export function costFromUsage(usage: UsageBlock): number {
  const cost = usage?.cost;
  if (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0) return 0;
  return cost;
}
