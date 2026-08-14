import { sheetsClient } from "../google";
import { getRuntimeValue, setRuntimeValue } from "../runtime";
import { ensureTabs } from "../sheets";
import { CATEGORY_LISTS } from "./targets";

/**
 * The Lead Machine keeps its own spreadsheet rather than adding tabs to the cold
 * email control sheet. Two reasons: George asked for a separate environment, and
 * the control sheet holds live send state that a harvest run should never sit
 * beside. drive.file lets the app create a file it owns, so no scope change.
 */
const SPREADSHEET_KEY = "machineSpreadsheetId";
const SPREADSHEET_TITLE = "Automatesphere Lead Machine";

/** Everything harvested. Nothing is ever deleted from here. */
export const COMPANIES_TAB = "Companies";
/** The subset stage 3 reads. A copy, not a move. See CATEGORY_LISTS for the rest. */
export const QUALIFIED_TAB = "Qualified";
/** Decision makers. Written by stage 3, which is not built yet. */
export const PEOPLE_TAB = "People";
/** Audit trail, and the only place actual Apify spend is recorded. */
export const RUNS_TAB = "Runs";

export const COMPANIES_HEADERS = [
  "companyUrl",
  "name",
  "summary",
  "industry",
  "location",
  "followers",
  "universalName",
  "category",
  "reason",
  "confidence",
  "peopleStatus",
  "harvestedAt",
  "qualifiedAt",
] as const;

/** Shared by every per-category list tab (Qualified, Networks, Associations). */
export const LIST_HEADERS = [
  "companyUrl",
  "name",
  "summary",
  "industry",
  "location",
  "category",
  "confidence",
  "peopleStatus",
  "addedAt",
] as const;

/**
 * Written empty now on purpose. Adding a column later means migrating live data,
 * and the last three belong to the writer agent that does not exist yet.
 */
export const PEOPLE_HEADERS = [
  "companyUrl",
  "companyName",
  "fullName",
  "firstName",
  "jobTitle",
  "headline",
  "profileUrl",
  "location",
  "titleScore",
  "isPrimary",
  "draftMessage",
  "draftStatus",
  "sent",
  "foundAt",
] as const;

export const RUNS_HEADERS = [
  "runId",
  "targetId",
  "stage",
  "startedAt",
  "finishedAt",
  "itemsIn",
  "itemsOut",
  "apifyRunId",
  "costUsd",
  "aiCostUsd",
  "error",
] as const;

/**
 * The stored id, or "" when the Lead Machine has never run. Read-only on
 * purpose: the spend summary runs on every page render, and a read path must
 * never provision a Drive file as a side effect.
 */
export async function existingMachineSpreadsheetId(): Promise<string> {
  return (await getRuntimeValue(SPREADSHEET_KEY)).trim();
}

/** Creates the spreadsheet on first use, then remembers it in the Runtime tab. */
export async function machineSpreadsheetId(): Promise<string> {
  const existing = (await getRuntimeValue(SPREADSHEET_KEY)).trim();
  if (existing) return existing;

  const created = await sheetsClient().spreadsheets.create({
    requestBody: { properties: { title: SPREADSHEET_TITLE } },
  });
  const id = created.data.spreadsheetId;
  if (!id) throw new Error("Google did not return a spreadsheet id");

  await setRuntimeValue(SPREADSHEET_KEY, id);
  return id;
}

let ensured = false;

/** Idempotent, and safe to call at the top of every stage. */
export async function ensureMachineTabs(force = false): Promise<string> {
  const id = await machineSpreadsheetId();
  if (ensured && !force) return id;

  await ensureTabs(id, [
    { tab: COMPANIES_TAB, headers: [...COMPANIES_HEADERS] },
    ...Object.values(CATEGORY_LISTS).map((tab) => ({ tab, headers: [...LIST_HEADERS] })),
    { tab: PEOPLE_TAB, headers: [...PEOPLE_HEADERS] },
    { tab: RUNS_TAB, headers: [...RUNS_HEADERS] },
  ]);

  ensured = true;
  return id;
}
