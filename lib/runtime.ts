import { randomUUID } from "node:crypto";
import { controlSpreadsheetId } from "./google";
import { RUNTIME_TAB, ensureControlTabs } from "./control";
import { a1, appendRow, readObjects, writeRange } from "./sheets";

const LOCK_KEY = "tickLock";
const LOCK_MS = 90_000;

type LockValue = { owner: string; until: number };

async function readKey(key: string): Promise<{ rowNumber: number; value: string } | null> {
  await ensureControlTabs();
  const { rows } = await readObjects(controlSpreadsheetId(), RUNTIME_TAB);
  const row = rows.find((candidate) => candidate.values.key === key);
  return row ? { rowNumber: row.rowNumber, value: row.values.value ?? "" } : null;
}

async function writeKey(key: string, value: string): Promise<void> {
  const existing = await readKey(key);
  if (existing) {
    await writeRange(controlSpreadsheetId(), a1(RUNTIME_TAB, `A${existing.rowNumber}:B${existing.rowNumber}`), [
      [key, value],
    ]);
    return;
  }
  await appendRow(controlSpreadsheetId(), RUNTIME_TAB, [key, value]);
}

function parseLock(raw: string): LockValue | null {
  try {
    const parsed = JSON.parse(raw) as LockValue;
    return typeof parsed?.until === "number" ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Best-effort mutual exclusion. Google Sheets has no compare-and-swap, so two
 * genuinely simultaneous ticks could both claim this. The real duplicate-send
 * guard is claim-before-send in the engine; this just keeps ticks tidy.
 */
export async function tryAcquireLock(): Promise<string | null> {
  const existing = await readKey(LOCK_KEY);
  const current = existing ? parseLock(existing.value) : null;
  if (current && current.until > Date.now()) return null;

  const owner = randomUUID();
  await writeKey(LOCK_KEY, JSON.stringify({ owner, until: Date.now() + LOCK_MS }));
  return owner;
}

export async function releaseLock(owner: string): Promise<void> {
  const existing = await readKey(LOCK_KEY);
  const current = existing ? parseLock(existing.value) : null;
  if (current && current.owner !== owner) return;
  await writeKey(LOCK_KEY, JSON.stringify({ owner: "", until: 0 }));
}

const INBOUND_CHECKPOINT_KEY = "inboundCheckpoint";

/** ISO timestamp of the newest inbound message already processed, or "" if none. */
export async function getInboundCheckpoint(): Promise<string> {
  const existing = await readKey(INBOUND_CHECKPOINT_KEY);
  return existing?.value ?? "";
}

export async function setInboundCheckpoint(iso: string): Promise<void> {
  await writeKey(INBOUND_CHECKPOINT_KEY, iso);
}

const SEND_GAP_KEY = "sendGapMinutes";
const LAST_SEND_KEY = "lastSendAt";

/**
 * Minutes the whole app waits between two emails, across every campaign. 0 is
 * off, which restores the original behaviour of one email per campaign per tick.
 *
 * Pacing has to be global rather than per campaign because the thing being
 * protected is the mailbox's reputation, and every campaign sends from the same
 * mailbox. Six campaigns each firing on their own gap is still a burst.
 */
export async function getSendGapMinutes(): Promise<number> {
  const raw = await getRuntimeValue(SEND_GAP_KEY);
  const minutes = Number(raw);
  return Number.isFinite(minutes) && minutes > 0 ? Math.floor(minutes) : 0;
}

export async function setSendGapMinutes(minutes: number): Promise<void> {
  await setRuntimeValue(SEND_GAP_KEY, String(Math.max(0, Math.floor(minutes))));
}

/** ISO timestamp of the last email the engine sent, or "" before the first one. */
export async function getLastSendAt(): Promise<string> {
  return getRuntimeValue(LAST_SEND_KEY);
}

export async function setLastSendAt(iso: string): Promise<void> {
  await setRuntimeValue(LAST_SEND_KEY, iso);
}

/**
 * Generic Runtime-tab access, used by the Lead Machine for values George needs to
 * change from the UI without a redeploy (the Apify token, the machine
 * spreadsheet id). Deliberately thin wrappers over the private helpers above.
 */
export async function getRuntimeValue(key: string): Promise<string> {
  const existing = await readKey(key);
  return existing?.value ?? "";
}

export async function setRuntimeValue(key: string, value: string): Promise<void> {
  await writeKey(key, value);
}

export async function readRuntime(): Promise<{ locked: boolean; until: number }> {
  const existing = await readKey(LOCK_KEY);
  const current = existing ? parseLock(existing.value) : null;
  return { locked: Boolean(current && current.until > Date.now()), until: current?.until ?? 0 };
}
