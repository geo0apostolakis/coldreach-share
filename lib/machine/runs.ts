import { appendRows, readColumns } from "../sheets";
import { RUNS_HEADERS, RUNS_TAB, ensureMachineTabs, existingMachineSpreadsheetId } from "./schema";

export type RunLog = {
  runId: string;
  targetId: string;
  stage: "harvest" | "qualify" | "people" | "rank";
  startedAt: string;
  itemsIn?: number;
  itemsOut?: number;
  apifyRunId?: string;
  costUsd?: number;
  aiCostUsd?: number;
  error?: string;
};

/** Append-only audit trail. The only record of what a run actually cost. */
export async function logRun(entry: RunLog): Promise<void> {
  const spreadsheetId = await ensureMachineTabs();
  const row: Record<(typeof RUNS_HEADERS)[number], string> = {
    runId: entry.runId,
    targetId: entry.targetId,
    stage: entry.stage,
    startedAt: entry.startedAt,
    finishedAt: new Date().toISOString(),
    itemsIn: String(entry.itemsIn ?? ""),
    itemsOut: String(entry.itemsOut ?? ""),
    apifyRunId: entry.apifyRunId ?? "",
    costUsd: String(entry.costUsd ?? ""),
    aiCostUsd: String(entry.aiCostUsd ?? ""),
    error: entry.error ?? "",
  };
  await appendRows(spreadsheetId, RUNS_TAB, [RUNS_HEADERS.map((header) => row[header])]);
}

/**
 * Apify and AI spend recorded by the Lead Machine. Reads only the two cost
 * columns rather than the whole tab, because the Runs tab grows with every
 * harvest and nothing else here is needed.
 */
export async function machineSpend(): Promise<{ apify: number; ai: number }> {
  // Never ensureMachineTabs here: that creates the spreadsheet and sweeps every
  // tab, and this runs on every page render.
  const spreadsheetId = await existingMachineSpreadsheetId();
  if (!spreadsheetId) return { apify: 0, ai: 0 };

  let rows: Record<string, string>[];
  try {
    rows = await readColumns(spreadsheetId, RUNS_TAB, ["costUsd", "aiCostUsd"]);
  } catch {
    // The Runs tab does not exist until the first harvest.
    return { apify: 0, ai: 0 };
  }
  const apify = rows.reduce((sum, row) => sum + (Number(row.costUsd) || 0), 0);
  const ai = rows.reduce((sum, row) => sum + (Number(row.aiCostUsd) || 0), 0);
  return { apify: Number(apify.toFixed(4)), ai: Number(ai.toFixed(4)) };
}

/** Total Apify spend recorded so far, so the UI can show it beside the plan limit. */
export async function totalSpend(): Promise<number> {
  return (await machineSpend()).apify;
}
