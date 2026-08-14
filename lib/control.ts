import { controlSpreadsheetId } from "./google";
import { ensureTabs } from "./sheets";

export const CAMPAIGNS_TAB = "Campaigns";
export const LOG_TAB = "Email Log";
export const RUNTIME_TAB = "Runtime";
export const FOLDERS_TAB = "Folders";
export const OUTCOMES_TAB = "Outcomes";
export const SPEND_TAB = "Spend";

export const CAMPAIGN_HEADERS = [
  "id",
  "name",
  "status",
  "leadsSpreadsheetId",
  "leadsSpreadsheetName",
  "leadsSheetName",
  "emailColumn",
  "statusColumn",
  "firstDayVolume",
  "dailyIncrement",
  "maxDailyLimit",
  "sendWindowStart",
  "sendWindowEnd",
  "timezone",
  "startDate",
  "currentDay",
  "sentToday",
  "lastRunDate",
  "totalSent",
  "lastError",
  "createdAt",
  "updatedAt",
  "config",
  "folderId",
  "mode",
  "sentValue",
] as const;

export const LOG_HEADERS = [
  "timestamp",
  "campaignId",
  "campaignName",
  "leadRow",
  "email",
  "name",
  "company",
  "variant",
  "subject",
  "body",
  "status",
  "messageId",
  "error",
  "aiCostUsd",
  "fromAddress",
] as const;

export const FOLDER_HEADERS = [
  "id",
  "name",
  "color",
  "note",
  "createdAt",
  "archivedAt",
] as const;

export const OUTCOME_HEADERS = [
  "id",
  "campaignId",
  "folderId",
  "leadEmail",
  "leadName",
  "company",
  "type",
  "occurredAt",
  "dealType",
  "dealValueUsd",
  "monthlyValueUsd",
  "expectedMonths",
  "grossMarginPct",
  "note",
  "createdAt",
] as const;

export const SPEND_HEADERS = [
  "id",
  "date",
  "vendor",
  "category",
  "amountUsd",
  "folderId",
  "campaignId",
  "note",
  "source",
  "createdAt",
] as const;

export const RUNTIME_HEADERS = ["key", "value"] as const;

let ensured = false;

/** Idempotent: creates the control tabs inside the spreadsheet George owns. */
export async function ensureControlTabs(force = false): Promise<void> {
  if (ensured && !force) return;
  const id = controlSpreadsheetId();
  await ensureTabs(id, [
    { tab: CAMPAIGNS_TAB, headers: [...CAMPAIGN_HEADERS] },
    { tab: LOG_TAB, headers: [...LOG_HEADERS] },
    { tab: RUNTIME_TAB, headers: [...RUNTIME_HEADERS] },
    { tab: FOLDERS_TAB, headers: [...FOLDER_HEADERS] },
    { tab: OUTCOMES_TAB, headers: [...OUTCOME_HEADERS] },
    { tab: SPEND_TAB, headers: [...SPEND_HEADERS] },
  ]);
  ensured = true;
}
