import { readHeaders, readObjects, writeCell } from "./sheets";
import { isClaimable } from "./lead-status";
import { hasRecipient, parseRecipients } from "./recipients";
import { isFollowUpCandidate, isSentStatus } from "./selection";
import type { Campaign, Lead } from "./types";

export type LeadsSnapshot = {
  headers: string[];
  total: number;
  pending: number;
  sent: number;
  rows: Lead[];
};

export async function loadLeads(campaign: Campaign): Promise<LeadsSnapshot> {
  const { headers, rows } = await readObjects(campaign.leadsSpreadsheetId, campaign.leadsSheetName);
  const withEmail = rows.filter((row) => hasRecipient(row.values[campaign.emailColumn] ?? ""));
  const now = Date.now();
  return {
    headers,
    total: withEmail.length,
    pending: withEmail.filter((row) => isClaimable(row.values[campaign.statusColumn] ?? "", now)).length,
    sent: withEmail.filter((row) =>
      isSentStatus(row.values[campaign.statusColumn] ?? "", campaign.sentValue),
    ).length,
    rows: withEmail,
  };
}

async function statusColumnIndex(campaign: Campaign): Promise<number> {
  const headers = await readHeaders(campaign.leadsSpreadsheetId, campaign.leadsSheetName);
  const index = headers.indexOf(campaign.statusColumn);
  if (index < 0) {
    throw new Error(`Status column "${campaign.statusColumn}" is missing from the leads sheet`);
  }
  return index + 1;
}

export async function markLeadStatus(
  campaign: Campaign,
  rowNumber: number,
  status: string,
): Promise<void> {
  const index = await statusColumnIndex(campaign);
  await writeCell(campaign.leadsSpreadsheetId, campaign.leadsSheetName, index, rowNumber, status);
}


export type LeadRow = { rowNumber: number; values: Record<string, string> };

/** One read of the leads tab, shared by every decision a tick has to make. */
export async function loadLeadRows(campaign: Campaign): Promise<LeadRow[]> {
  const { rows } = await readObjects(campaign.leadsSpreadsheetId, campaign.leadsSheetName);
  return rows;
}

/**
 * Rows that already had an email and could still take another one.
 *
 * Deliberately skips anyone the inbound processor has written a value against:
 * a lead who replied or bounced must never receive a follow-up. That check is
 * the whole reason follow-ups are safe to automate. "Sending" is in flight and
 * an Error row failed, so neither is chased.
 */
export function followUpCandidates(
  campaign: Campaign,
  rows: LeadRow[],
): { row: LeadRow; emails: string[] }[] {
  const inboundColumn = campaign.config.inbound.enabled
    ? campaign.config.inbound.column.trim()
    : "";

  const out: { row: LeadRow; emails: string[] }[] = [];
  for (const row of rows) {
    const emails = parseRecipients(row.values[campaign.emailColumn] ?? "");
    const facts = {
      emails,
      status: row.values[campaign.statusColumn] ?? "",
      inboundValue: inboundColumn ? (row.values[inboundColumn] ?? "") : "",
      sentValue: campaign.sentValue,
    };
    if (isFollowUpCandidate(facts)) out.push({ row, emails });
  }
  return out;
}

/** First row nobody has contacted, from an already-loaded snapshot. */
export function firstClaimable(campaign: Campaign, rows: LeadRow[], now = Date.now()): Lead | null {
  const row = rows.find(
    (candidate) =>
      hasRecipient(candidate.values[campaign.emailColumn] ?? "") &&
      isClaimable(candidate.values[campaign.statusColumn] ?? "", now),
  );
  return row ? { rowNumber: row.rowNumber, values: row.values } : null;
}
