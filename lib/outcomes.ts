import { randomUUID } from "node:crypto";
import { controlSpreadsheetId } from "./google";
import { OUTCOMES_TAB, OUTCOME_HEADERS, ensureControlTabs } from "./control";
import { a1, appendRow, columnLetter, readObjects, writeRange } from "./sheets";
import type { DealType, Outcome, OutcomeType } from "./types";

type Row = { rowNumber: number; values: Record<string, string> };

function num(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toOutcome(row: Row): Outcome {
  const v = row.values;
  return {
    id: v.id ?? "",
    campaignId: v.campaignId ?? "",
    folderId: v.folderId ?? "",
    leadEmail: (v.leadEmail ?? "").toLowerCase(),
    leadName: v.leadName ?? "",
    company: v.company ?? "",
    type: (v.type || "positive_reply") as OutcomeType,
    occurredAt: v.occurredAt ?? "",
    dealType: (v.dealType ?? "") as DealType,
    dealValueUsd: num(v.dealValueUsd),
    monthlyValueUsd: num(v.monthlyValueUsd),
    expectedMonths: num(v.expectedMonths),
    grossMarginPct: num(v.grossMarginPct),
    note: v.note ?? "",
    createdAt: v.createdAt ?? "",
  };
}

function toRowValues(outcome: Outcome): string[] {
  const flat: Record<string, string> = {
    id: outcome.id,
    campaignId: outcome.campaignId,
    folderId: outcome.folderId,
    leadEmail: outcome.leadEmail,
    leadName: outcome.leadName,
    company: outcome.company,
    type: outcome.type,
    occurredAt: outcome.occurredAt,
    dealType: outcome.dealType,
    dealValueUsd: String(outcome.dealValueUsd || ""),
    monthlyValueUsd: String(outcome.monthlyValueUsd || ""),
    expectedMonths: String(outcome.expectedMonths || ""),
    grossMarginPct: String(outcome.grossMarginPct || ""),
    note: outcome.note,
    createdAt: outcome.createdAt,
  };
  return OUTCOME_HEADERS.map((header) => flat[header] ?? "");
}

async function loadRows(): Promise<Row[]> {
  await ensureControlTabs();
  const { rows } = await readObjects(controlSpreadsheetId(), OUTCOMES_TAB);
  return rows.filter((row) => row.values.id);
}

export async function listOutcomes(filter?: {
  campaignId?: string;
  folderId?: string;
}): Promise<Outcome[]> {
  let outcomes = (await loadRows()).map(toOutcome);
  if (filter?.campaignId) {
    outcomes = outcomes.filter((outcome) => outcome.campaignId === filter.campaignId);
  }
  if (filter?.folderId) {
    outcomes = outcomes.filter((outcome) => outcome.folderId === filter.folderId);
  }
  return outcomes;
}

export type OutcomeInput = {
  campaignId: string;
  folderId?: string;
  leadEmail: string;
  leadName?: string;
  company?: string;
  type: OutcomeType;
  occurredAt?: string;
  dealType?: DealType;
  dealValueUsd?: number;
  monthlyValueUsd?: number;
  expectedMonths?: number;
  grossMarginPct?: number;
  note?: string;
};

/**
 * Idempotent on (campaignId, leadEmail, type). Two clicks of "Booked" for the
 * same lead must not read as two booked calls: that would inflate the booking
 * rate, the cost per booked call and the show rate all at once.
 */
export async function addOutcome(input: OutcomeInput): Promise<Outcome> {
  await ensureControlTabs();
  const email = input.leadEmail.trim().toLowerCase();
  const rows = await loadRows();
  const existing = rows.find(
    (row) =>
      row.values.campaignId === input.campaignId &&
      (row.values.leadEmail ?? "").toLowerCase() === email &&
      row.values.type === input.type,
  );

  const base = existing ? toOutcome(existing) : null;
  const outcome: Outcome = {
    id: base?.id ?? randomUUID(),
    campaignId: input.campaignId,
    folderId: input.folderId ?? base?.folderId ?? "",
    leadEmail: email,
    leadName: input.leadName ?? base?.leadName ?? "",
    company: input.company ?? base?.company ?? "",
    type: input.type,
    occurredAt: input.occurredAt || base?.occurredAt || new Date().toISOString(),
    dealType: input.dealType ?? base?.dealType ?? "",
    dealValueUsd: input.dealValueUsd ?? base?.dealValueUsd ?? 0,
    monthlyValueUsd: input.monthlyValueUsd ?? base?.monthlyValueUsd ?? 0,
    expectedMonths: input.expectedMonths ?? base?.expectedMonths ?? 0,
    grossMarginPct: input.grossMarginPct ?? base?.grossMarginPct ?? 0,
    note: input.note ?? base?.note ?? "",
    createdAt: base?.createdAt ?? new Date().toISOString(),
  };

  if (existing) {
    const range = a1(
      OUTCOMES_TAB,
      `A${existing.rowNumber}:${columnLetter(OUTCOME_HEADERS.length)}${existing.rowNumber}`,
    );
    await writeRange(controlSpreadsheetId(), range, [toRowValues(outcome)]);
    return outcome;
  }

  await appendRow(controlSpreadsheetId(), OUTCOMES_TAB, toRowValues(outcome));
  return outcome;
}

export async function deleteOutcome(id: string): Promise<boolean> {
  const row = (await loadRows()).find((candidate) => candidate.values.id === id);
  if (!row) return false;
  const range = a1(
    OUTCOMES_TAB,
    `A${row.rowNumber}:${columnLetter(OUTCOME_HEADERS.length)}${row.rowNumber}`,
  );
  await writeRange(controlSpreadsheetId(), range, [OUTCOME_HEADERS.map(() => "")]);
  return true;
}
