import { generateText } from "./ai";
import { getCampaign, listCampaigns, updateCampaign } from "./campaigns";
import { firstClaimable, followUpCandidates, loadLeadRows, markLeadStatus } from "./leads";
import { parseRecipients } from "./recipients";
import { appendLog, sendHistory } from "./log";
import {
  clampMaxFollowUps,
  followUpDue,
  followUpStepIndex,
  followUpSubject,
  stepAt,
  type SendRecord,
} from "./follow-up";
import { sendingMarker } from "./lead-status";
import { defaultSender, sendMail } from "./outlook";
import { render } from "./template";
import { formatDateInTz, hasStarted, isWithinWindow, quotaForDay, daysBetween } from "./time";
import {
  getLastSendAt,
  getSendGapMinutes,
  readRuntime,
  releaseLock,
  setLastSendAt,
  tryAcquireLock,
} from "./runtime";
import { processInbound, type InboundResult } from "./inbound";
import {
  AI_PLACEHOLDER,
  LEAD_STATUS_ERROR,
  LEAD_STATUS_SENT,
  variableMap,
  type Campaign,
  type Lead,
  type Variant,
} from "./types";

export type CampaignTickResult = {
  campaignId: string;
  campaignName: string;
  action: "sent" | "skipped" | "error" | "finished";
  reason?: string;
  email?: string;
  variant?: string;
  quota?: number;
  sentToday?: number;
};

function pickVariant(variants: Variant[]): Variant {
  const usable = variants.filter((variant) => variant.subject.trim() || variant.body.trim());
  const pool = usable.length > 0 ? usable : variants;
  const total = pool.reduce((sum, variant) => sum + Math.max(0, variant.weight || 0), 0);
  if (total <= 0) return pool[Math.floor(Math.random() * pool.length)];
  let ticket = Math.random() * total;
  for (const variant of pool) {
    ticket -= Math.max(0, variant.weight || 0);
    if (ticket <= 0) return variant;
  }
  return pool[pool.length - 1];
}

/** Rolls the day counter over when the campaign's local date has changed. */
function rollDay(campaign: Campaign, today: string): Partial<Campaign> | null {
  if (campaign.lastRunDate === today) return null;
  const startDate = campaign.startDate || today;
  const elapsed = Math.max(0, daysBetween(startDate, today));
  return { currentDay: elapsed + 1, sentToday: 0, lastRunDate: today };
}

export function currentQuota(campaign: Campaign, today: string): number {
  const day =
    campaign.lastRunDate === today
      ? campaign.currentDay
      : Math.max(0, daysBetween(campaign.startDate || today, today)) + 1;
  return quotaForDay(day, campaign.firstDayVolume, campaign.dailyIncrement, campaign.maxDailyLimit);
}

export async function buildEmail(
  campaign: Campaign,
  lead: Lead,
  variant: Variant,
): Promise<{ subject: string; body: string; aiCostUsd: number }> {
  // Sheet columns override custom variables, so per-lead data always wins a
  // name collision.
  const vars: Record<string, string> = { ...variableMap(campaign.config.variables), ...lead.values };

  let aiCostUsd = 0;

  const usesAi =
    campaign.config.ai.enabled &&
    (variant.body.includes(`{{${AI_PLACEHOLDER}}}`) ||
      variant.subject.includes(`{{${AI_PLACEHOLDER}}}`));

  if (usesAi) {
    const prompt = render(campaign.config.ai.prompt, vars);
    const systemPrompt = render(campaign.config.ai.systemPrompt, vars);
    const generation = await generateText(prompt, campaign.config.ai.model, systemPrompt);
    vars[AI_PLACEHOLDER] = generation.text;
    aiCostUsd = generation.costUsd;
  }

  const signature = campaign.config.signature ? `\n\n${render(campaign.config.signature, vars)}` : "";
  return {
    subject: render(variant.subject, vars),
    body: `${render(variant.body, vars)}${signature}`,
    aiCostUsd,
  };
}

/**
 * Picks the one email this tick should send: a due follow-up first, otherwise a
 * lead nobody has contacted yet.
 *
 * Follow-ups win because they are time sensitive. A new lead is equally good
 * tomorrow; a follow-up that slips past its gap keeps slipping, and the whole
 * point of the gap is that it is deliberate.
 */
type Work = { lead: Lead; followUpStep: number; lastSubject: string };
/** "later" means nothing to send now but the campaign is not finished either. */
type Pick = Work | "later" | null;

/**
 * Picks the one email this tick should send: a due follow-up first, otherwise a
 * lead nobody has contacted yet.
 *
 * Follow-ups win because they are time sensitive. A new lead is equally good
 * tomorrow; a follow-up that slips past its gap keeps slipping, and the whole
 * point of the gap is that it is deliberate.
 *
 * The leads tab is read once and the Email Log once, then every decision below
 * runs in memory. Sheets has a per-minute read quota that this app has already
 * hit once, so a tick must not re-read the same tab per question it asks.
 */
async function pickWork(campaign: Campaign, today: string): Promise<Pick> {
  const { enabled, dayGap, maxFollowUps } = campaign.config.followUp;
  const max = clampMaxFollowUps(maxFollowUps);
  const followUpsOn = enabled && max > 0;

  const rows = await loadLeadRows(campaign);
  // A step with nothing written in it cannot be sent. Treat follow-ups as off
  // rather than letting a blank step stall the campaign: without this, ticking
  // the box before writing the copy stops the fresh leads going out too.
  const hasCopy = campaign.config.followUp.steps.some((step) => step.body.trim());
  const history = followUpsOn && hasCopy ? await sendHistory(campaign.id) : null;

  if (history) {
    let owedLater = false;

    for (const { row, emails } of followUpCandidates(campaign, rows)) {
      // A row can hold several addresses. Use the one contacted most recently,
      // so a second address added later cannot reset the sequence.
      let best: SendRecord | undefined;
      for (const email of emails) {
        const entry = history.get(email);
        if (!entry) continue;
        const record: SendRecord = {
          count: entry.count,
          lastDate: formatDateInTz(new Date(entry.lastIso), campaign.timezone),
          lastSubject: entry.lastSubject,
        };
        if (!best || record.lastDate > best.lastDate) best = record;
      }
      if (!best) continue;

      if (followUpDue(best, { dayGap, maxFollowUps }, daysBetween(best.lastDate, today))) {
        const stepIndex = followUpStepIndex(best);
        // This particular step is blank, so move on rather than abandoning the
        // tick. A later candidate, or a fresh lead, can still be sent.
        if ((stepAt(campaign.config.followUp.steps, stepIndex)?.body ?? "").trim()) {
          return {
            lead: { rowNumber: row.rowNumber, values: row.values },
            followUpStep: stepIndex,
            lastSubject: best.lastSubject,
          };
        }
      }
      // Not due yet, but still owed one. Remembering this is what stops the
      // campaign being marked done while follow-ups are still pending.
      if (best.count - 1 < max) owedLater = true;
    }

    const fresh = firstClaimable(campaign, rows);
    if (fresh) return { lead: fresh, followUpStep: -1, lastSubject: "" };
    return owedLater ? "later" : null;
  }

  const fresh = firstClaimable(campaign, rows);
  return fresh ? { lead: fresh, followUpStep: -1, lastSubject: "" } : null;
}

/** Sends exactly one email for one campaign. Claims the lead before sending. */
async function sendOne(campaign: Campaign, today: string): Promise<CampaignTickResult> {
  const work = await pickWork(campaign, today);
  if (work === "later") {
    return {
      campaignId: campaign.id,
      campaignName: campaign.name,
      action: "skipped",
      reason: "Everyone contacted, waiting on follow-up gaps",
    };
  }
  if (!work) {
    await updateCampaign(campaign.id, { status: "done", lastError: "" });
    return {
      campaignId: campaign.id,
      campaignName: campaign.name,
      action: "finished",
      reason: "No leads left to contact",
    };
  }

  const { lead, followUpStep, lastSubject } = work;
  const isFollowUp = followUpStep >= 0;
  const recipients = parseRecipients(lead.values[campaign.emailColumn] ?? "");
  const email = recipients.join(", ");

  const step = isFollowUp
    ? stepAt(campaign.config.followUp.steps, followUpStep)
    : undefined;

  const variant: Variant = isFollowUp
    ? {
        name: `Follow-up ${followUpStep + 1}`,
        subject: followUpSubject(step?.subject ?? "", lastSubject),
        body: step?.body ?? "",
        weight: 1,
      }
    : pickVariant(campaign.config.variants);
  const testing = campaign.mode === "test";

  // In test mode the lead is left completely untouched: no claim, no status,
  // no counter. Otherwise a dry run would eat prospects and a day of the ramp.
  //
  // A follow-up is deliberately NOT claimed. Claiming overwrites a "Sent" cell
  // with a "Sending" marker, and if the process dies before the catch block
  // runs, that marker goes stale and isClaimable turns the row back into a
  // fresh lead, which would send the FIRST email again to someone who already
  // had it. The tick lock in runtime.ts is the mutual exclusion here, and a
  // crash simply retries the same follow-up step, which costs nothing because
  // sendHistory never recorded it.
  if (!testing && !isFollowUp) {
    // Claim first: a crash after this point leaves a recoverable "Sending" marker
    // rather than a blank cell that would be picked up and emailed again.
    await markLeadStatus(campaign, lead.rowNumber, sendingMarker());
  }

  try {
    const { subject, body, aiCostUsd } = await buildEmail(campaign, lead, variant);

    // Every address in the cell gets the same email, on one message, so a firm
    // that lists an inbox and a partner is contacted once rather than twice.
    const testAddress = (process.env.TEST_EMAIL_TO ?? "").trim();
    if (testing && !testAddress) {
      throw new Error("Test mode needs TEST_EMAIL_TO to be set");
    }
    const recipient = testing ? [testAddress] : recipients;
    const fromAddress = (campaign.config.sender.fromAddress ?? "").trim();
    await sendMail({
      to: recipient,
      subject: testing ? `[TEST to ${email}] ${subject}` : subject,
      body,
      replyTo: campaign.config.sender.replyTo,
      from: fromAddress || undefined,
    });

    if (!testing) {
      await markLeadStatus(
        campaign,
        lead.rowNumber,
        isFollowUp
          ? `${campaign.sentValue || LEAD_STATUS_SENT} +${followUpStep + 1}`
          : campaign.sentValue || LEAD_STATUS_SENT,
      );
    }

    const sentToday = testing ? campaign.sentToday : campaign.sentToday + 1;
    const totalSent = testing ? campaign.totalSent : campaign.totalSent + 1;
    if (!testing) {
      await updateCampaign(campaign.id, { sentToday, totalSent, lastError: "" });
    }
    await appendLog({
      timestamp: new Date().toISOString(),
      campaignId: campaign.id,
      campaignName: campaign.name,
      leadRow: String(lead.rowNumber),
      email,
      name: lead.values["Greek Name"] ?? lead.values["Full Name"] ?? lead.values["First Name"] ?? "",
      company: lead.values.Company ?? "",
      variant: variant.name,
      subject,
      body,
      status: testing ? "Test" : "Sent",
      messageId: "",
      error: "",
      aiCostUsd: String(aiCostUsd || ""),
      fromAddress: fromAddress || (await defaultSender()),
    });

    return {
      campaignId: campaign.id,
      campaignName: campaign.name,
      action: "sent",
      email: recipient.join(", "),
      variant: variant.name,
      sentToday,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Only a first touch needs its claim cleared. A follow-up was never
    // claimed, so its row still reads Sent and must be left alone.
    if (!testing && !isFollowUp) {
      await markLeadStatus(campaign, lead.rowNumber, LEAD_STATUS_ERROR);
    }
    await updateCampaign(campaign.id, { lastError: message });
    await appendLog({
      timestamp: new Date().toISOString(),
      campaignId: campaign.id,
      campaignName: campaign.name,
      leadRow: String(lead.rowNumber),
      email,
      variant: variant.name,
      status: "Error",
      error: message,
    });
    return {
      campaignId: campaign.id,
      campaignName: campaign.name,
      action: "error",
      email,
      reason: message,
    };
  }
}

type RunOptions = {
  /** Ignore the send window and run even outside working hours. */
  force?: boolean;
  /** Restrict the tick to one campaign. */
  campaignId?: string;
};

export async function runTick(options: RunOptions = {}): Promise<{
  busy?: boolean;
  results: CampaignTickResult[];
  inbound?: InboundResult;
}> {
  const lock = await tryAcquireLock();
  if (!lock) return { busy: true, results: [] };

  const results: CampaignTickResult[] = [];
  let inbound: InboundResult | undefined;
  try {
    const all = options.campaignId
      ? [await getCampaign(options.campaignId)].filter((c): c is Campaign => c !== null)
      : await listCampaigns();
    const active = all.filter((campaign) => campaign.status === "running");

    // Pacing turns the tick into "at most one email, and only if enough time has
    // passed since the last one". "Run now" ignores it, the same way it ignores
    // the send window: a deliberate manual send is not the thing being paced.
    const gapMinutes = options.force ? 0 : await getSendGapMinutes();
    // Minutes still to wait, or 0 when a slot is open. Never an early return:
    // inbound below has to run on every tick regardless.
    let pacedWait = 0;
    if (gapMinutes > 0) {
      const lastSendAt = Date.parse(await getLastSendAt());
      const waitedMs = Number.isNaN(lastSendAt) ? Infinity : Date.now() - lastSendAt;
      pacedWait = Math.max(0, Math.ceil((gapMinutes * 60_000 - waitedMs) / 60_000));
      // Fewest sent today goes first, so one campaign cannot take every slot.
      active.sort((a, b) => a.sentToday - b.sentToday || a.name.localeCompare(b.name));
    }
    let slotTaken = false;

    for (const original of active) {
      if (pacedWait > 0 || slotTaken) {
        results.push({
          campaignId: original.id,
          campaignName: original.name,
          action: "skipped",
          reason:
            pacedWait > 0
              ? `Paced: next email in ${pacedWait} min`
              : `Paced: one email per ${gapMinutes} min, another campaign took this slot`,
        });
        continue;
      }
      let campaign = original;
      const today = formatDateInTz(new Date(), campaign.timezone);

      // A campaign scheduled to begin later must wait, even if it is "running".
      // "run now" (force) overrides this so a scheduled campaign can be tested.
      if (!options.force && !hasStarted(campaign.startDate, today)) {
        results.push({
          campaignId: campaign.id,
          campaignName: campaign.name,
          action: "skipped",
          reason: `Starts on ${campaign.startDate}`,
        });
        continue;
      }

      // A test campaign never runs on the schedule. Test mode deliberately
      // leaves the lead unclaimed, so the next tick would pick the same lead
      // again and again and fill the test inbox. "Run now" still works.
      if (campaign.mode === "test" && !options.force) {
        results.push({
          campaignId: campaign.id,
          campaignName: campaign.name,
          action: "skipped",
          reason: "Test mode: use Run now to send a test",
        });
        continue;
      }

      const roll = rollDay(campaign, today);
      if (roll) {
        campaign = { ...campaign, ...roll };
        await updateCampaign(campaign.id, roll);
      }

      if (
        !options.force &&
        !isWithinWindow(new Date(), campaign.timezone, campaign.sendWindowStart, campaign.sendWindowEnd)
      ) {
        results.push({
          campaignId: campaign.id,
          campaignName: campaign.name,
          action: "skipped",
          reason: `Outside ${campaign.sendWindowStart}–${campaign.sendWindowEnd} ${campaign.timezone}`,
        });
        continue;
      }

      const quota = quotaForDay(
        campaign.currentDay,
        campaign.firstDayVolume,
        campaign.dailyIncrement,
        campaign.maxDailyLimit,
      );
      if (campaign.sentToday >= quota) {
        results.push({
          campaignId: campaign.id,
          campaignName: campaign.name,
          action: "skipped",
          reason: `Daily quota reached (${campaign.sentToday}/${quota})`,
          quota,
          sentToday: campaign.sentToday,
        });
        continue;
      }

      const result = await sendOne(campaign, today);
      results.push({ ...result, quota });

      // Only a real send closes the slot. A campaign that had nothing to send
      // must not eat the gap, or a finished campaign would stall the others.
      if (gapMinutes > 0 && result.action === "sent") {
        slotTaken = true;
        await setLastSendAt(new Date().toISOString());
      }
    }

    // Inbound runs regardless of send windows/quotas — bounces and replies
    // arrive whenever. It no-ops fast if no running campaign has it enabled,
    // and its own failure must never break sending.
    try {
      inbound = await processInbound();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      inbound = { processed: 0, bounced: 0, replied: 0, skipped: 0, note: `Inbound error: ${message}` };
    }
  } finally {
    await releaseLock(lock);
  }

  return { results, inbound };
}

export async function lockState() {
  return readRuntime();
}
