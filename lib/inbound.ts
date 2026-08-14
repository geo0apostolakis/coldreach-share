import { listCampaigns } from "./campaigns";
import { addColumn, readHeaders, readObjects, writeCell } from "./sheets";
import { getMailboxAddress, listInboxSince } from "./outlook";
import { getInboundCheckpoint, setInboundCheckpoint } from "./runtime";
import { extractEmails, matchInbound } from "./inbound-classify";
import { parseRecipients } from "./recipients";
import type { Campaign } from "./types";

export type InboundResult = {
  processed: number;
  bounced: number;
  replied: number;
  skipped: number;
  note?: string;
};

type Target = { campaign: Campaign; rowNumber: number };

/** Resolves (and caches) the 1-based index of a campaign's inbound column, adding it if missing. */
async function inboundColumnIndex(
  campaign: Campaign,
  cache: Map<string, number>,
): Promise<number> {
  const key = campaign.id;
  const cached = cache.get(key);
  if (cached) return cached;
  const headers = await readHeaders(campaign.leadsSpreadsheetId, campaign.leadsSheetName);
  const column = campaign.config.inbound.column;
  const existing = headers.indexOf(column);
  const index = existing >= 0
    ? existing + 1
    : await addColumn(campaign.leadsSpreadsheetId, campaign.leadsSheetName, column);
  cache.set(key, index);
  return index;
}

/**
 * Reads new inbox mail and writes a status back onto matching leads: the
 * configured bounce text for undeliverable reports, the reply text for genuine
 * replies. Runs once per tick, from a checkpoint, so nothing is handled twice.
 */
export async function processInbound(): Promise<InboundResult> {
  const empty: InboundResult = { processed: 0, bounced: 0, replied: 0, skipped: 0 };

  const campaigns = (await listCampaigns()).filter(
    (c) => c.status === "running" && c.config.inbound.enabled && c.config.inbound.column.trim(),
  );
  if (campaigns.length === 0) return empty;

  // On first enable, start from now — don't march through the whole mailbox.
  const checkpoint = await getInboundCheckpoint();
  if (!checkpoint) {
    await setInboundCheckpoint(new Date().toISOString());
    return { ...empty, note: "Inbound started — watching mail from now on." };
  }

  const messages = await listInboxSince(checkpoint, 50);
  if (messages.length === 0) return empty;

  // One address book across every inbound campaign; first campaign to own an
  // address wins it.
  const leadIndex = new Map<string, Target>();
  for (const campaign of campaigns) {
    const { rows } = await readObjects(campaign.leadsSpreadsheetId, campaign.leadsSheetName);
    for (const row of rows) {
      // A cell can list several addresses. A reply from any one of them is a
      // reply from that lead, so every address points at the same row.
      for (const email of parseRecipients(row.values[campaign.emailColumn] ?? "")) {
        if (!leadIndex.has(email)) leadIndex.set(email, { campaign, rowNumber: row.rowNumber });
      }
    }
  }
  const leadEmails = new Set(leadIndex.keys());

  const mailbox = await getMailboxAddress().catch(() => "");
  const columnCache = new Map<string, number>();
  let newest = checkpoint;
  const result: InboundResult = { ...empty };

  for (const message of messages) {
    if (message.receivedDateTime > newest) newest = message.receivedDateTime;
    result.processed += 1;

    const candidateEmails = [
      message.fromAddress,
      ...message.toAddresses,
      ...extractEmails(message.subject),
      ...extractEmails(message.body),
    ];
    const match = matchInbound(
      { fromAddress: message.fromAddress, fromName: message.fromName, subject: message.subject, candidateEmails },
      leadEmails,
      mailbox,
    );
    if (!match) {
      result.skipped += 1;
      continue;
    }

    const target = leadIndex.get(match.email);
    if (!target) {
      result.skipped += 1;
      continue;
    }

    const value =
      match.kind === "bounce"
        ? target.campaign.config.inbound.bounceValue
        : target.campaign.config.inbound.replyValue;
    const index = await inboundColumnIndex(target.campaign, columnCache);
    await writeCell(
      target.campaign.leadsSpreadsheetId,
      target.campaign.leadsSheetName,
      index,
      target.rowNumber,
      value,
    );
    if (match.kind === "bounce") result.bounced += 1;
    else result.replied += 1;
  }

  await setInboundCheckpoint(newest);
  return result;
}
