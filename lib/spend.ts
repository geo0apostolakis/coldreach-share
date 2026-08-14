import { randomUUID } from "node:crypto";
import { controlSpreadsheetId } from "./google";
import { LOG_TAB, SPEND_TAB, SPEND_HEADERS, ensureControlTabs } from "./control";
import { a1, appendRow, columnLetter, readColumns, readObjects, writeRange } from "./sheets";
import { machineSpend } from "./machine/runs";
import { REPORTING_TIMEZONE, formatDateInTz, isoToReportingDate, withinRange } from "./time";
import type { SpendEntry } from "./types";

/** Reserved: derived from the Runs tab, so a manual row here would double count. */
export const DERIVED_APIFY_CATEGORY = "usage";

type Row = { rowNumber: number; values: Record<string, string> };

function toEntry(row: Row): SpendEntry {
  const v = row.values;
  const amount = Number(v.amountUsd);
  return {
    id: v.id ?? "",
    date: v.date ?? "",
    vendor: v.vendor ?? "",
    category: v.category ?? "",
    amountUsd: Number.isFinite(amount) ? amount : 0,
    folderId: v.folderId ?? "",
    campaignId: v.campaignId ?? "",
    note: v.note ?? "",
    source: v.source === "auto" ? "auto" : "manual",
    createdAt: v.createdAt ?? "",
  };
}

function toRowValues(entry: SpendEntry): string[] {
  const flat: Record<string, string> = {
    id: entry.id,
    date: entry.date,
    vendor: entry.vendor,
    category: entry.category,
    amountUsd: String(entry.amountUsd),
    folderId: entry.folderId,
    campaignId: entry.campaignId,
    note: entry.note,
    source: entry.source,
    createdAt: entry.createdAt,
  };
  return SPEND_HEADERS.map((header) => flat[header] ?? "");
}

async function loadRows(): Promise<Row[]> {
  await ensureControlTabs();
  const { rows } = await readObjects(controlSpreadsheetId(), SPEND_TAB);
  return rows.filter((row) => row.values.id);
}

export type Range = { from?: string; to?: string };

export { REPORTING_TIMEZONE, withinRange, isoToReportingDate };

export async function listSpend(filter?: Range & { folderId?: string }): Promise<SpendEntry[]> {
  let entries = (await loadRows()).map(toEntry);
  if (filter?.folderId) entries = entries.filter((entry) => entry.folderId === filter.folderId);
  if (filter?.from || filter?.to) {
    entries = entries.filter((entry) => withinRange(entry.date, filter));
  }
  return entries.sort((a, b) => b.date.localeCompare(a.date));
}

export async function addSpend(input: {
  date?: string;
  vendor: string;
  category?: string;
  amountUsd: number;
  folderId?: string;
  campaignId?: string;
  note?: string;
}): Promise<SpendEntry> {
  await ensureControlTabs();
  const entry: SpendEntry = {
    id: randomUUID(),
    date: input.date || formatDateInTz(new Date(), REPORTING_TIMEZONE),
    vendor: input.vendor.trim(),
    category: (input.category ?? "").trim(),
    amountUsd: input.amountUsd,
    folderId: input.folderId ?? "",
    campaignId: input.campaignId ?? "",
    note: input.note ?? "",
    source: "manual",
    createdAt: new Date().toISOString(),
  };
  await appendRow(controlSpreadsheetId(), SPEND_TAB, toRowValues(entry));
  return entry;
}

export async function deleteSpend(id: string): Promise<boolean> {
  const row = (await loadRows()).find((candidate) => candidate.values.id === id);
  if (!row) return false;
  const range = a1(
    SPEND_TAB,
    `A${row.rowNumber}:${columnLetter(SPEND_HEADERS.length)}${row.rowNumber}`,
  );
  await writeRange(controlSpreadsheetId(), range, [SPEND_HEADERS.map(() => "")]);
  return true;
}

/** AI spend on sends, read from the two Email Log columns and nothing else. */
export async function emailAiSpend(
  range: Range,
  campaignIds?: Set<string>,
): Promise<number> {
  await ensureControlTabs();
  const rows = await readColumns(controlSpreadsheetId(), LOG_TAB, [
    "timestamp",
    "aiCostUsd",
    "campaignId",
  ]);
  const total = rows.reduce((sum, row) => {
    // Without this the AI cost of every campaign lands in whichever folder is
    // being viewed, which inflates that client's CAC and corrupts LTGP:CAC.
    if (campaignIds && !campaignIds.has(row.campaignId)) return sum;
    const cost = Number(row.aiCostUsd);
    if (!Number.isFinite(cost) || cost === 0) return sum;
    if ((range.from || range.to) && !withinRange(isoToReportingDate(row.timestamp), range)) {
      return sum;
    }
    return sum + cost;
  }, 0);
  return Number(total.toFixed(6));
}

export type SpendSummary = {
  apify: number;
  ai: number;
  other: number;
  total: number;
  byVendor: Record<string, number>;
  /** Manual rows with no folder. Counted in the total, excluded from folder CAC. */
  unallocated: number;
};

/**
 * Merges the three sources. Apify usage and AI come from their own tabs, never
 * from the Spend tab, so each vendor has exactly one source of truth.
 *
 * The Lead Machine's Runs tab carries no date column that survives filtering
 * here, so a folder or date filter reports manual and email AI spend only for
 * that slice and leaves machine spend out. Machine spend is global by nature
 * until harvest targets carry a folder.
 */
export async function spendSummary(
  filter: Range & { folderId?: string; campaignIds?: Set<string> } = {},
): Promise<SpendSummary> {
  const scoped = Boolean(filter.folderId);
  const [manual, emailAi, machine] = await Promise.all([
    listSpend(filter),
    emailAiSpend(filter, scoped ? (filter.campaignIds ?? new Set<string>()) : undefined),
    scoped ? Promise.resolve({ apify: 0, ai: 0 }) : machineSpend().catch(() => ({ apify: 0, ai: 0 })),
  ]);

  const byVendor: Record<string, number> = {};
  let other = 0;
  let unallocated = 0;
  for (const entry of manual) {
    byVendor[entry.vendor || "Other"] = (byVendor[entry.vendor || "Other"] ?? 0) + entry.amountUsd;
    other += entry.amountUsd;
    if (!entry.folderId) unallocated += entry.amountUsd;
  }

  const ai = Number((emailAi + machine.ai).toFixed(6));
  const apify = machine.apify;
  if (apify > 0) byVendor.Apify = (byVendor.Apify ?? 0) + apify;
  if (ai > 0) byVendor.AI = (byVendor.AI ?? 0) + ai;

  return {
    apify,
    ai,
    other: Number(other.toFixed(4)),
    total: Number((apify + ai + other).toFixed(4)),
    byVendor,
    unallocated: Number(unallocated.toFixed(4)),
  };
}
