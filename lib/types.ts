export type CampaignStatus = "draft" | "running" | "paused" | "done";

/**
 * Test mode sends every email to TEST_EMAIL_TO instead of the lead, and does
 * not touch the lead's row or the daily counter. So a campaign can be dry-run
 * end to end without burning a single prospect or a day of the ramp.
 */
export type CampaignMode = "production" | "test";

export type Variant = {
  name: string;
  subject: string;
  body: string;
  weight: number;
};

export type AiConfig = {
  enabled: boolean;
  /** The AI's standing role and rules — sent as the system message. */
  systemPrompt: string;
  /** The per-lead task, rendered with the lead's variables. */
  prompt: string;
  model: string;
};

export type SenderConfig = {
  replyTo: string;
  /**
   * The address to send as. Empty means the signed-in mailbox. Set this once
   * extra aliases or subdomain mailboxes exist, so volume can be spread across
   * several senders instead of burning one.
   */
  fromAddress?: string;
};

/**
 * Writes a status back into the leads sheet when mail comes in: a bounce (dead
 * address) or a real reply from the prospect. Both land in the same column,
 * with different text, since a lead is one or the other.
 */
export type InboundConfig = {
  enabled: boolean;
  /** Which column in the leads sheet to write into. */
  column: string;
  /** Text written when the address bounced (undeliverable / doesn't exist). */
  bounceValue: string;
  /** Text written when the prospect actually replied. */
  replyValue: string;
};

/**
 * A variable you define yourself rather than one that comes from a sheet
 * column. Usable in the subject, the body and both prompts.
 */
import type { CustomVariable } from "./variables";
export type { CustomVariable };
export { variableMap } from "./variables";

/**
 * Automatic follow-ups. Steps are separate emails sent to leads that already
 * got the first one and have not replied or bounced. Capped at three, which is
 * both George's rule and roughly where a sequence starts costing more in
 * reputation than it returns.
 */
export type FollowUpStep = {
  /** Blank means reply to the previous subject, as "Re: ...". */
  subject: string;
  body: string;
};

export type FollowUpConfig = {
  enabled: boolean;
  /** Calendar days to wait after the previous email to this lead. */
  dayGap: number;
  /** 0 to 3. */
  maxFollowUps: number;
  steps: FollowUpStep[];
};

export type CampaignConfig = {
  variants: Variant[];
  ai: AiConfig;
  sender: SenderConfig;
  signature: string;
  variables: CustomVariable[];
  inbound: InboundConfig;
  followUp: FollowUpConfig;
};

/**
 * A funnel event for one lead. Append-only across types, but only ever one row
 * per (campaignId, leadEmail, type): logging "booked" twice must not make the
 * booking rate read double.
 */
export type OutcomeType = "positive_reply" | "booked" | "showed" | "closed" | "lost";

/** Empty string on any outcome that is not a close. */
export type DealType = "oneoff" | "recurring" | "";

export type Outcome = {
  id: string;
  campaignId: string;
  folderId: string;
  leadEmail: string;
  leadName: string;
  company: string;
  type: OutcomeType;
  occurredAt: string;
  dealType: DealType;
  /** One-off deals only. */
  dealValueUsd: number;
  /** Recurring deals only. */
  monthlyValueUsd: number;
  expectedMonths: number;
  grossMarginPct: number;
  note: string;
  createdAt: string;
};

export const OUTCOME_TYPES: OutcomeType[] = [
  "positive_reply",
  "booked",
  "showed",
  "closed",
  "lost",
];

/**
 * A manually entered cost. Apify usage and AI spend are never stored here:
 * they are derived from the Runs tab and the Email Log at read time, and
 * writing them here as well would double count them.
 */
export type SpendEntry = {
  id: string;
  /** YYYY-MM-DD, in the reporting timezone. */
  date: string;
  vendor: string;
  category: string;
  amountUsd: number;
  folderId: string;
  campaignId: string;
  note: string;
  source: "manual" | "auto";
  createdAt: string;
};

/** A client or vertical. One level only, no nesting. */
export type Folder = {
  id: string;
  name: string;
  color: string;
  note: string;
  createdAt: string;
  archivedAt: string;
};

export type Campaign = {
  id: string;
  name: string;
  status: CampaignStatus;
  leadsSpreadsheetId: string;
  leadsSpreadsheetName: string;
  leadsSheetName: string;
  emailColumn: string;
  statusColumn: string;
  firstDayVolume: number;
  dailyIncrement: number;
  maxDailyLimit: number;
  sendWindowStart: string; // "09:00"
  sendWindowEnd: string; // "17:00"
  timezone: string;
  startDate: string; // "YYYY-MM-DD"
  currentDay: number;
  sentToday: number;
  lastRunDate: string;
  totalSent: number;
  lastError: string;
  createdAt: string;
  updatedAt: string;
  config: CampaignConfig;
  /** Empty string means the campaign is not filed under any folder. */
  folderId: string;
  mode: CampaignMode;
  /** Written into the status column on a successful send. Defaults to "Sent". */
  sentValue: string;
};

export type LogEntry = {
  timestamp: string;
  campaignId: string;
  campaignName: string;
  leadRow: string;
  email: string;
  name: string;
  company: string;
  variant: string;
  subject: string;
  body: string;
  status: string;
  messageId: string;
  error: string;
  /** USD spent on the AI sentence for this one email. Blank when AI was off. */
  aiCostUsd: string;
  /** Which mailbox or alias this went out from, for per-sender daily volume. */
  fromAddress: string;
};

export type Lead = {
  rowNumber: number;
  values: Record<string, string>;
};

export {
  LEAD_STATUS_SENDING,
  LEAD_STATUS_SENT,
  LEAD_STATUS_ERROR,
} from "./lead-status";

export const DEFAULT_MODEL = "anthropic/claude-sonnet-4.5";

export const AI_PLACEHOLDER = "ai_output";

export const DEFAULT_SYSTEM_PROMPT =
  "You write one short, specific opening line for a cold email. " +
  "Reply with the sentence only — no greeting, no sign-off, no quotation marks.";

export const DEFAULT_BOUNCE_VALUE = "You Have to Sent On LinkedIn";
export const DEFAULT_REPLY_VALUE = "Replied";

export function emptyConfig(): CampaignConfig {
  return {
    variants: [{ name: "Variant A", subject: "", body: "", weight: 1 }],
    ai: { enabled: false, systemPrompt: DEFAULT_SYSTEM_PROMPT, prompt: "", model: DEFAULT_MODEL },
    sender: { replyTo: "" },
    signature: "",
    variables: [],
    inbound: {
      enabled: false,
      column: "",
      bounceValue: DEFAULT_BOUNCE_VALUE,
      replyValue: DEFAULT_REPLY_VALUE,
    },
    followUp: {
      enabled: false,
      dayGap: 5,
      maxFollowUps: 2,
      steps: [{ subject: "", body: "" }],
    },
  };
}
