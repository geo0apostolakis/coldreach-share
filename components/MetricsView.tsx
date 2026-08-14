"use client";

import type { Metrics } from "@/lib/metrics";
import { DEFAULT_LTGP_CAC_BANDS, ltgpCacHealth } from "@/lib/metrics";

export type MetricsPayload = Metrics & { campaignCount: number };

const NO_DATA = "not enough data";

function money(value: number | null) {
  if (value === null) return NO_DATA;
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function pct(value: number | null) {
  if (value === null) return NO_DATA;
  return `${value.toFixed(1)}%`;
}

function num(value: number | null, digits = 1) {
  if (value === null) return NO_DATA;
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function Tile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "good" | "warn" | "bad";
}) {
  const colour =
    tone === "good"
      ? "text-good-500"
      : tone === "warn"
        ? "text-warn-500"
        : tone === "bad"
          ? "text-bad-500"
          : "text-ink-100";
  const dim = value === NO_DATA;
  return (
    <div className="card p-3 sm:p-4">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-400 sm:text-[11px]">
        {label}
      </div>
      <div
        className={`mt-1.5 font-semibold tabular-nums ${dim ? "text-xs text-ink-500 sm:text-sm" : `text-lg sm:text-xl ${colour}`}`}
      >
        {value}
      </div>
      {hint && <div className="mt-0.5 text-[11px] leading-snug text-ink-500">{hint}</div>}
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">{title}</h2>
      {note && <p className="mt-1 text-xs text-ink-500">{note}</p>}
      <div className="mt-3 grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">{children}</div>
    </section>
  );
}

export default function MetricsView({
  metrics,
  scopedToFolder = false,
}: {
  metrics: MetricsPayload;
  scopedToFolder?: boolean;
}) {
  const { volume, funnel, spend, money: cash, rates } = metrics;
  const health = ltgpCacHealth(cash.ltgpToCac);
  const healthTone = health === "good" ? "good" : health === "ok" ? "warn" : health === "bad" ? "bad" : undefined;

  return (
    <div className="space-y-7">
      <Section
        title="The ratio that decides everything"
        note={`Target ${DEFAULT_LTGP_CAC_BANDS.target}:1 for a business that sells through a human call. Below ${DEFAULT_LTGP_CAC_BANDS.bad}:1 the model does not work.`}
      >
        <Tile
          label="LTGP : CAC"
          value={cash.ltgpToCac === null ? NO_DATA : `${num(cash.ltgpToCac, 2)} : 1`}
          hint={
            health === "good"
              ? "Healthy. Push LTGP, not CAC: LTGP has no ceiling."
              : health === "ok"
                ? "Works, but thin for a human-touch sale."
                : health === "bad"
                  ? "Below 3:1. Acquisition is eating the profit."
                  : "Close a deal and log it to see this."
          }
          tone={healthTone}
        />
        <Tile label="CAC" value={money(cash.cac)} hint="Total spend divided by customers closed" />
        <Tile label="LTGP per customer" value={money(cash.ltgpPerCustomer)} hint="Gross profit, not revenue" />
        <Tile
          label="Contribution margin"
          value={money(cash.contributionMargin)}
          hint="What one customer leaves after acquisition"
          tone={cash.contributionMargin !== null && cash.contributionMargin < 0 ? "bad" : undefined}
        />
      </Section>

      <Section
        title="Money"
        note={
          scopedToFolder
            ? "Scoped to this folder. Apify and Lead Machine costs are global and excluded here."
            : "Apify usage and AI cost are recorded automatically. Everything else is what you typed in."
        }
      >
        <Tile label="Total spend" value={money(spend.total)} hint={`Apify ${money(spend.apify)} · AI ${money(spend.ai)} · Other ${money(spend.other)}`} />
        <Tile label="Revenue closed" value={money(cash.revenue)} />
        <Tile label="LTGP" value={money(cash.ltgp)} hint="Lifetime gross profit across all closes" />
        <Tile label="ROAS" value={cash.roas === null ? NO_DATA : `${num(cash.roas, 2)}x`} hint="Revenue per dollar spent" />
        <Tile
          label="Payback"
          value={cash.paybackMonths === null ? NO_DATA : `${num(cash.paybackMonths, 1)} months`}
          hint="Recurring deals only. How long until a client repays their CAC."
        />
        <Tile label="Cost per lead" value={money(cash.costPerLead)} />
        <Tile label="Cost per positive reply" value={money(cash.costPerPositiveReply)} />
        <Tile label="Cost per booked call" value={money(cash.costPerBookedCall)} />
        <Tile label="Cost per show" value={money(cash.costPerShow)} />
        <Tile label="Gross profit per lead" value={money(cash.grossProfitPerLead)} hint="The number to grow" />
      </Section>

      <Section title="Funnel">
        <Tile label="Leads in lists" value={num(volume.leadsTotal, 0)} />
        <Tile label="Leads contacted" value={num(volume.leadsContacted, 0)} />
        <Tile label="Emails sent" value={num(volume.emailsSent, 0)} />
        <Tile label="Delivered" value={num(volume.delivered, 0)} hint="Sent minus bounced" />
        <Tile label="Bounced" value={num(volume.bounced, 0)} />
        <Tile label="Replied" value={num(volume.replied, 0)} />
        <Tile label="Positive replies" value={num(funnel.positive_reply, 0)} hint="Logged by hand for now" />
        <Tile label="Booked calls" value={num(funnel.booked, 0)} />
        <Tile label="Showed up" value={num(funnel.showed, 0)} />
        <Tile label="Closed" value={num(funnel.closed, 0)} />
        <Tile label="Lost" value={num(funnel.lost, 0)} />
      </Section>

      <Section title="Conversion" note="Each step measured against the step before it, not against the top of the funnel.">
        <Tile label="Contacted" value={pct(rates.contactRate)} hint="Of every lead in the lists" />
        <Tile
          label="Bounce rate"
          value={pct(rates.bounceRate)}
          hint="Pause and re-verify above 2%"
          tone={rates.bounceRate !== null && rates.bounceRate > 2 ? "bad" : undefined}
        />
        <Tile label="Reply rate" value={pct(rates.replyRate)} hint="Per lead, not per email" />
        <Tile label="Positive reply rate" value={pct(rates.positiveReplyRate)} />
        <Tile label="Booking rate" value={pct(rates.bookingRate)} hint="Booked out of positive replies" />
        <Tile label="Show rate" value={pct(rates.showRate)} hint="Showed out of booked" />
        <Tile label="Close rate" value={pct(rates.closeRate)} hint="Closed out of shows" />
        <Tile label="Lead to close" value={pct(rates.leadToCloseRate)} hint="End to end" />
        <Tile label="Emails per close" value={num(rates.emailsPerClose, 0)} />
        <Tile label="Leads per close" value={num(rates.leadsPerClose, 0)} hint="How many to contact for one sale" />
      </Section>
    </div>
  );
}
