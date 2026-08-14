import { controlSpreadsheetId } from "./google";
import { LOG_HEADERS, LOG_TAB, ensureControlTabs } from "./control";
import { appendRow, readColumns, readObjects } from "./sheets";
import type { LogEntry } from "./types";

export async function appendLog(entry: Partial<LogEntry>): Promise<void> {
  await ensureControlTabs();
  const row = LOG_HEADERS.map((header) => {
    const value = (entry as Record<string, unknown>)[header];
    return value == null ? "" : String(value);
  });
  await appendRow(controlSpreadsheetId(), LOG_TAB, row);
}

export async function readLogs(campaignId?: string, limit = 200): Promise<LogEntry[]> {
  await ensureControlTabs();
  const { rows } = await readObjects(controlSpreadsheetId(), LOG_TAB);
  const entries = rows
    .filter((row) => row.values.timestamp)
    .map((row) => row.values as unknown as LogEntry)
    .filter((entry) => !campaignId || entry.campaignId === campaignId);
  return entries.slice(-limit).reverse();
}

/**
 * Per-lead send history for one campaign, keyed by recipient address.
 *
 * The Email Log is the source of truth for follow-up timing rather than a new
 * column in the leads sheet: it already records every send, it needs no schema
 * change on tabs that already exist, and a lead with no row here is correctly
 * treated as unknown rather than as freshly contacted. Reads four narrow
 * columns, never the bodies.
 */
export async function sendHistory(
  campaignId: string,
): Promise<Map<string, { count: number; lastIso: string; lastSubject: string }>> {
  await ensureControlTabs();
  const rows = await readColumns(controlSpreadsheetId(), LOG_TAB, [
    "campaignId",
    "email",
    "status",
    "timestamp",
    "subject",
  ]);

  const history = new Map<string, { count: number; lastIso: string; lastSubject: string }>();
  for (const row of rows) {
    // Test sends went to George's own inbox and must never age a real lead.
    if (row.campaignId !== campaignId || row.status !== "Sent") continue;
    // One log row can carry several addresses; each one was really emailed.
    for (const email of (row.email ?? "").split(",").map((part) => part.trim().toLowerCase())) {
      if (!email) continue;
      const current = history.get(email);
      if (!current) {
        history.set(email, { count: 1, lastIso: row.timestamp, lastSubject: row.subject ?? "" });
        continue;
      }
      current.count += 1;
      if (row.timestamp > current.lastIso) {
        current.lastIso = row.timestamp;
        current.lastSubject = row.subject ?? "";
      }
    }
  }
  return history;
}
