"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Banner, Spinner } from "@/components/ui";
import { api, type LogEntry } from "@/lib/client";
import { OUTCOME_TYPES, type DealType, type Outcome, type OutcomeType } from "@/lib/types";

const LABELS: Record<OutcomeType, string> = {
  positive_reply: "Positive reply",
  booked: "Booked a call",
  showed: "Showed up",
  closed: "Closed a sale",
  lost: "Lost",
};

const TONE: Record<OutcomeType, string> = {
  positive_reply: "text-brand-400",
  booked: "text-brand-400",
  showed: "text-ink-200",
  closed: "text-good-500",
  lost: "text-bad-500",
};

function money(value: number) {
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export default function OutcomePanel({
  campaignId,
  outcomes,
  logs,
  onChange,
}: {
  campaignId: string;
  outcomes: Outcome[];
  logs: LogEntry[];
  onChange: () => void;
}) {
  const [type, setType] = useState<OutcomeType>("booked");
  const [leadEmail, setLeadEmail] = useState("");
  const [dealType, setDealType] = useState<DealType>("recurring");
  const [monthlyValueUsd, setMonthlyValueUsd] = useState("");
  const [expectedMonths, setExpectedMonths] = useState("");
  const [dealValueUsd, setDealValueUsd] = useState("");
  const [grossMarginPct, setGrossMarginPct] = useState("70");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");

  // Everyone this campaign has actually emailed, newest first, de-duplicated.
  const emailed = Array.from(new Set(logs.map((entry) => entry.email).filter(Boolean)));

  async function save() {
    if (!leadEmail.trim()) {
      setError("Pick or type the lead's email first");
      return;
    }
    setBusy(true);
    setError("");
    setFlash("");
    try {
      await api("/api/outcomes", {
        method: "POST",
        body: JSON.stringify({
          campaignId,
          leadEmail: leadEmail.trim(),
          type,
          note,
          ...(type === "closed"
            ? {
                dealType,
                grossMarginPct: Number(grossMarginPct) || 0,
                ...(dealType === "recurring"
                  ? {
                      monthlyValueUsd: Number(monthlyValueUsd) || 0,
                      expectedMonths: Number(expectedMonths) || 0,
                    }
                  : { dealValueUsd: Number(dealValueUsd) || 0 }),
              }
            : {}),
        }),
      });
      setFlash(`${LABELS[type]} logged for ${leadEmail.trim()}`);
      setLeadEmail("");
      setNote("");
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that outcome");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    try {
      await api(`/api/outcomes/${id}`, { method: "DELETE" });
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete that outcome");
    }
  }

  return (
    <div className="space-y-5">
      {error && <Banner tone="error">{error}</Banner>}
      {flash && <Banner tone="good">{flash}</Banner>}

      <div className="card p-5">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">
          Log an outcome
        </div>
        <p className="mt-1 text-xs text-ink-400">
          Logging the same lead and the same step twice updates that entry rather than counting it
          again, so the funnel stays honest.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="lbl">Step</label>
            <select
              className="field"
              value={type}
              onChange={(event) => setType(event.target.value as OutcomeType)}
            >
              {OUTCOME_TYPES.map((value) => (
                <option key={value} value={value}>
                  {LABELS[value]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="lbl">Lead email</label>
            <input
              className="field"
              list="outcome-emails"
              placeholder="name@company.com"
              value={leadEmail}
              onChange={(event) => setLeadEmail(event.target.value)}
            />
            <datalist id="outcome-emails">
              {emailed.map((email) => (
                <option key={email} value={email} />
              ))}
            </datalist>
          </div>
        </div>

        {type === "closed" && (
          <div className="mt-3 grid gap-3 rounded-lg border border-ink-700 bg-ink-900/40 p-4 sm:grid-cols-3">
            <div className="sm:col-span-3">
              <label className="lbl">Deal type</label>
              <select
                className="field max-w-xs"
                value={dealType}
                onChange={(event) => setDealType(event.target.value as DealType)}
              >
                <option value="recurring">Recurring, monthly retainer</option>
                <option value="oneoff">One-off project</option>
              </select>
            </div>
            {dealType === "recurring" ? (
              <>
                <div>
                  <label className="lbl">Monthly value (USD)</label>
                  <input
                    className="field"
                    inputMode="decimal"
                    value={monthlyValueUsd}
                    onChange={(event) => setMonthlyValueUsd(event.target.value)}
                  />
                </div>
                <div>
                  <label className="lbl">Expected months</label>
                  <input
                    className="field"
                    inputMode="decimal"
                    value={expectedMonths}
                    onChange={(event) => setExpectedMonths(event.target.value)}
                  />
                </div>
              </>
            ) : (
              <div className="sm:col-span-2">
                <label className="lbl">Deal value (USD)</label>
                <input
                  className="field"
                  inputMode="decimal"
                  value={dealValueUsd}
                  onChange={(event) => setDealValueUsd(event.target.value)}
                />
              </div>
            )}
            <div>
              <label className="lbl">Gross margin %</label>
              <input
                className="field"
                inputMode="decimal"
                value={grossMarginPct}
                onChange={(event) => setGrossMarginPct(event.target.value)}
              />
            </div>
            <p className="text-xs leading-relaxed text-ink-400 sm:col-span-3">
              Margin is what is left after the cost of delivering the work. LTGP uses this, not
              revenue, which is what makes the LTGP:CAC ratio meaningful.
            </p>
          </div>
        )}

        <div className="mt-3">
          <label className="lbl">Note (optional)</label>
          <input className="field" value={note} onChange={(event) => setNote(event.target.value)} />
        </div>

        <button className="btn btn-primary mt-4" disabled={busy} onClick={() => void save()}>
          {busy ? <Spinner /> : null}
          Log {LABELS[type].toLowerCase()}
        </button>
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-ink-700 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-ink-400">
          Logged outcomes
        </div>
        {outcomes.length === 0 ? (
          <p className="px-4 py-6 text-sm text-ink-400">
            Nothing logged yet. Every ratio on the Business page stays blank until something lands
            here.
          </p>
        ) : (
          <div className="scroll-x">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-ink-700 text-ink-400">
                  <th className="px-4 py-2 font-medium">When</th>
                  <th className="px-4 py-2 font-medium">Lead</th>
                  <th className="px-4 py-2 font-medium">Step</th>
                  <th className="px-4 py-2 font-medium">Value</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {outcomes.map((outcome) => (
                  <tr key={outcome.id} className="border-b border-ink-800 last:border-0">
                    <td className="whitespace-nowrap px-4 py-2 text-ink-400">
                      {outcome.occurredAt.replace("T", " ").slice(0, 16)}
                    </td>
                    <td className="px-4 py-2">{outcome.leadEmail}</td>
                    <td className={`px-4 py-2 ${TONE[outcome.type]}`}>{LABELS[outcome.type]}</td>
                    <td className="px-4 py-2 tabular-nums text-ink-300">
                      {outcome.type !== "closed"
                        ? "n/a"
                        : outcome.dealType === "recurring"
                          ? `${money(outcome.monthlyValueUsd)}/mo × ${outcome.expectedMonths} @ ${outcome.grossMarginPct}%`
                          : `${money(outcome.dealValueUsd)} @ ${outcome.grossMarginPct}%`}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        className="text-ink-500 hover:text-bad-500"
                        title="Delete"
                        onClick={() => void remove(outcome.id)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
