import { randomUUID } from "node:crypto";
import { controlSpreadsheetId } from "./google";
import { CAMPAIGNS_TAB, CAMPAIGN_HEADERS, ensureControlTabs } from "./control";
import { a1, appendRow, columnLetter, readObjects, writeRange } from "./sheets";
import { LEAD_STATUS_SENT, emptyConfig, type Campaign, type CampaignConfig, type CampaignStatus } from "./types";

type Row = { rowNumber: number; values: Record<string, string> };

function parseConfig(raw: string): CampaignConfig {
  if (!raw) return emptyConfig();
  try {
    const parsed = JSON.parse(raw) as Partial<CampaignConfig>;
    const base = emptyConfig();
    return {
      variants: parsed.variants?.length ? parsed.variants : base.variants,
      ai: { ...base.ai, ...parsed.ai },
      sender: { ...base.sender, ...parsed.sender },
      signature: parsed.signature ?? base.signature,
      // Campaigns saved before custom variables existed have no array at all.
      variables: parsed.variables ?? base.variables,
      // Campaigns saved before inbound handling existed have no object at all.
      inbound: { ...base.inbound, ...parsed.inbound },
      // Same for follow-ups. A campaign that predates them stays off.
      followUp: {
        ...base.followUp,
        ...parsed.followUp,
        steps: parsed.followUp?.steps?.length ? parsed.followUp.steps : base.followUp.steps,
      },
    };
  } catch {
    return emptyConfig();
  }
}

function toCampaign(row: Row): Campaign {
  const v = row.values;
  const num = (key: string, fallback = 0) => {
    const parsed = Number(v[key]);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  return {
    id: v.id ?? "",
    name: v.name ?? "",
    status: (v.status || "draft") as CampaignStatus,
    leadsSpreadsheetId: v.leadsSpreadsheetId ?? "",
    leadsSpreadsheetName: v.leadsSpreadsheetName ?? "",
    leadsSheetName: v.leadsSheetName ?? "",
    emailColumn: v.emailColumn ?? "",
    statusColumn: v.statusColumn ?? "",
    firstDayVolume: num("firstDayVolume", 5),
    dailyIncrement: num("dailyIncrement", 0),
    maxDailyLimit: num("maxDailyLimit", 30),
    sendWindowStart: v.sendWindowStart || "09:00",
    sendWindowEnd: v.sendWindowEnd || "17:00",
    timezone: v.timezone || "Europe/Athens",
    startDate: v.startDate ?? "",
    currentDay: num("currentDay", 0),
    sentToday: num("sentToday", 0),
    lastRunDate: v.lastRunDate ?? "",
    totalSent: num("totalSent", 0),
    lastError: v.lastError ?? "",
    createdAt: v.createdAt ?? "",
    updatedAt: v.updatedAt ?? "",
    config: parseConfig(v.config ?? ""),
    folderId: v.folderId ?? "",
    mode: v.mode === "test" ? "test" : "production",
    sentValue: v.sentValue || LEAD_STATUS_SENT,
  };
}

function toRowValues(campaign: Campaign): string[] {
  const flat: Record<string, string> = {
    id: campaign.id,
    name: campaign.name,
    status: campaign.status,
    leadsSpreadsheetId: campaign.leadsSpreadsheetId,
    leadsSpreadsheetName: campaign.leadsSpreadsheetName,
    leadsSheetName: campaign.leadsSheetName,
    emailColumn: campaign.emailColumn,
    statusColumn: campaign.statusColumn,
    firstDayVolume: String(campaign.firstDayVolume),
    dailyIncrement: String(campaign.dailyIncrement),
    maxDailyLimit: String(campaign.maxDailyLimit),
    sendWindowStart: campaign.sendWindowStart,
    sendWindowEnd: campaign.sendWindowEnd,
    timezone: campaign.timezone,
    startDate: campaign.startDate,
    currentDay: String(campaign.currentDay),
    sentToday: String(campaign.sentToday),
    lastRunDate: campaign.lastRunDate,
    totalSent: String(campaign.totalSent),
    lastError: campaign.lastError,
    createdAt: campaign.createdAt,
    updatedAt: campaign.updatedAt,
    config: JSON.stringify(campaign.config),
    folderId: campaign.folderId,
    mode: campaign.mode,
    sentValue: campaign.sentValue,
  };
  return CAMPAIGN_HEADERS.map((header) => flat[header] ?? "");
}

async function loadRows(): Promise<Row[]> {
  await ensureControlTabs();
  const { rows } = await readObjects(controlSpreadsheetId(), CAMPAIGNS_TAB);
  return rows.filter((row) => row.values.id);
}

export async function listCampaigns(): Promise<Campaign[]> {
  return (await loadRows()).map(toCampaign);
}

export async function getCampaign(id: string): Promise<Campaign | null> {
  const row = (await loadRows()).find((candidate) => candidate.values.id === id);
  return row ? toCampaign(row) : null;
}

export async function createCampaign(
  input: Omit<Campaign, "id" | "createdAt" | "updatedAt" | "currentDay" | "sentToday" | "lastRunDate" | "totalSent" | "lastError">,
): Promise<Campaign> {
  await ensureControlTabs();
  const now = new Date().toISOString();
  const campaign: Campaign = {
    ...input,
    id: randomUUID(),
    currentDay: 0,
    sentToday: 0,
    lastRunDate: "",
    totalSent: 0,
    lastError: "",
    createdAt: now,
    updatedAt: now,
  };
  await appendRow(controlSpreadsheetId(), CAMPAIGNS_TAB, toRowValues(campaign));
  return campaign;
}

export async function updateCampaign(id: string, patch: Partial<Campaign>): Promise<Campaign | null> {
  const rows = await loadRows();
  const row = rows.find((candidate) => candidate.values.id === id);
  if (!row) return null;

  const merged: Campaign = {
    ...toCampaign(row),
    ...patch,
    id,
    updatedAt: new Date().toISOString(),
  };
  const range = a1(
    CAMPAIGNS_TAB,
    `A${row.rowNumber}:${columnLetter(CAMPAIGN_HEADERS.length)}${row.rowNumber}`,
  );
  await writeRange(controlSpreadsheetId(), range, [toRowValues(merged)]);
  return merged;
}

export async function deleteCampaign(id: string): Promise<boolean> {
  const rows = await loadRows();
  const row = rows.find((candidate) => candidate.values.id === id);
  if (!row) return false;
  const range = a1(
    CAMPAIGNS_TAB,
    `A${row.rowNumber}:${columnLetter(CAMPAIGN_HEADERS.length)}${row.rowNumber}`,
  );
  await writeRange(controlSpreadsheetId(), range, [CAMPAIGN_HEADERS.map(() => "")]);
  return true;
}
