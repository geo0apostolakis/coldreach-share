import { LOG_TAB, ensureControlTabs } from "./control";
import { controlSpreadsheetId } from "./google";
import { readColumns } from "./sheets";
import { listCampaigns } from "./campaigns";
import { loadLeads } from "./leads";
import { listOutcomes } from "./outcomes";
import { spendSummary, type Range } from "./spend";
import { isoToReportingDate, withinRange } from "./time";
import { computeMetrics, dailyVolume, type Metrics, type Volume } from "./metrics";
import type { Campaign } from "./types";

/**
 * Bounces and replies are not stored as counters anywhere: the inbound
 * processor writes a configured word into a column of the leads sheet. So they
 * are counted by reading that column back, which is why this only works for
 * campaigns that have inbound handling switched on.
 */
function inboundCounts(
  campaign: Campaign,
  rows: { values: Record<string, string> }[],
): { bounced: number; replied: number } {
  const { enabled, column, bounceValue, replyValue } = campaign.config.inbound;
  if (!enabled || !column) return { bounced: 0, replied: 0 };
  const bounce = bounceValue.trim().toLowerCase();
  const reply = replyValue.trim().toLowerCase();

  let bounced = 0;
  let replied = 0;
  for (const row of rows) {
    const value = (row.values[column] ?? "").trim().toLowerCase();
    if (!value) continue;
    if (bounce && value === bounce) bounced += 1;
    else if (reply && value === reply) replied += 1;
  }
  return { bounced, replied };
}

/**
 * Emails per day per sender, straight from the Email Log. Test sends are
 * excluded: they go to your own inbox and cost no domain reputation.
 */
export async function sendingVolume(days = 14) {
  await ensureControlTabs();
  const rows = await readColumns(controlSpreadsheetId(), LOG_TAB, [
    "status",
    "timestamp",
    "fromAddress",
  ]);
  return dailyVolume(
    rows
      .filter((row) => row.status === "Sent")
      .map((row) => ({ date: isoToReportingDate(row.timestamp), sender: row.fromAddress })),
    days,
  );
}

/** Emails actually sent, read from three Email Log columns rather than the whole tab. */
async function sentCounts(range: Range): Promise<Map<string, number>> {
  await ensureControlTabs();
  const rows = await readColumns(controlSpreadsheetId(), LOG_TAB, [
    "campaignId",
    "status",
    "timestamp",
  ]);
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.status !== "Sent") continue;
    if ((range.from || range.to) && !withinRange(isoToReportingDate(row.timestamp), range)) continue;
    counts.set(row.campaignId, (counts.get(row.campaignId) ?? 0) + 1);
  }
  return counts;
}

export type MetricsFilter = Range & { folderId?: string; campaignId?: string };

export async function buildMetrics(filter: MetricsFilter = {}): Promise<Metrics & {
  campaignCount: number;
  scope: MetricsFilter;
}> {
  const all = await listCampaigns();
  const scoped = all.filter((campaign) => {
    if (filter.campaignId) return campaign.id === filter.campaignId;
    if (filter.folderId) return campaign.folderId === filter.folderId;
    return true;
  });

  // Scope spend by the campaigns actually in this folder, not by the folderId
  // stamped on a row, so a campaign that moved folders takes its costs with it.
  const scopedIds = new Set(scoped.map((campaign) => campaign.id));

  const [sent, outcomes, spend] = await Promise.all([
    sentCounts(filter),
    // Filtered by campaign membership, not by the folderId stamped on the row
    // when it was logged, so moving a campaign moves its closed deals with it.
    listOutcomes({ campaignId: filter.campaignId }).then((all) =>
      filter.folderId ? all.filter((outcome) => scopedIds.has(outcome.campaignId)) : all,
    ),
    spendSummary({ ...filter, campaignIds: scopedIds }),
  ]);

  const volume: Volume = {
    leadsTotal: 0,
    leadsContacted: 0,
    emailsSent: 0,
    bounced: 0,
    replied: 0,
  };

  const snapshots = await Promise.all(
    scoped.map(async (campaign) => {
      try {
        return { campaign, snapshot: await loadLeads(campaign) };
      } catch {
        // A campaign pointing at a sheet that lost access must not blank the
        // whole dashboard.
        return { campaign, snapshot: null };
      }
    }),
  );

  for (const { campaign, snapshot } of snapshots) {
    volume.emailsSent += sent.get(campaign.id) ?? 0;
    if (!snapshot) continue;
    volume.leadsTotal += snapshot.total;
    volume.leadsContacted += snapshot.sent;
    const counts = inboundCounts(campaign, snapshot.rows);
    volume.bounced += counts.bounced;
    volume.replied += counts.replied;
  }

  return {
    ...computeMetrics(volume, outcomes, spend),
    campaignCount: scoped.length,
    scope: filter,
  };
}
