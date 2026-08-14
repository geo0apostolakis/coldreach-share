"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { api } from "@/lib/client";

type Summary = {
  apify: number;
  ai: number;
  other: number;
  total: number;
  unallocated: number;
};

function money(value: number) {
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Fetched after mount, never during render, so a slow Sheets read cannot hold
 * up the page this sits on top of.
 */
export default function SpendStrip() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [open, setOpen] = useState(false);
  const [vendor, setVendor] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<{ summary: Summary }>("/api/spend?summary=1")
      .then((data) => setSummary(data.summary))
      .catch(() => setSummary(null));
  }, []);

  useEffect(load, [load]);

  async function save() {
    setBusy(true);
    setError("");
    try {
      await api("/api/spend", {
        method: "POST",
        body: JSON.stringify({ vendor, amountUsd: Number(amount), category, note }),
      });
      setVendor("");
      setAmount("");
      setCategory("");
      setNote("");
      setOpen(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that cost");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-b border-ink-700 bg-ink-950/60">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 px-4 py-2.5 text-xs sm:gap-x-7 sm:px-8">
        <span className="hidden text-[11px] font-semibold uppercase tracking-wider text-ink-500 sm:inline">
          Spend, all time
        </span>
        {summary === null ? (
          <span className="text-ink-500">Loading…</span>
        ) : (
          <>
            <span className="text-ink-400">
              Total <span className="ml-1 text-sm font-semibold tabular-nums text-ink-100">{money(summary.total)}</span>
            </span>
            <span className="text-ink-400">
              Apify <span className="ml-1 tabular-nums text-ink-200">{money(summary.apify)}</span>
            </span>
            <span className="text-ink-400">
              AI <span className="ml-1 tabular-nums text-ink-200">{money(summary.ai)}</span>
            </span>
            <span className="text-ink-400">
              Other <span className="ml-1 tabular-nums text-ink-200">{money(summary.other)}</span>
            </span>
          </>
        )}
        <button
          className="ml-auto flex items-center gap-1.5 text-ink-400 transition-colors hover:text-ink-100"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <X size={13} /> : <Plus size={13} />}
          {open ? "Cancel" : "Add cost"}
        </button>
      </div>

      {open && (
        <div className="border-t border-ink-800 px-4 sm:px-8 py-3">
          {error && <p className="mb-2 text-xs text-bad-500">{error}</p>}
          <div className="grid gap-2 sm:flex sm:flex-wrap sm:items-end">
            <div>
              <label className="lbl">Vendor</label>
              <input
                className="field sm:w-40"
                placeholder="Mailboxes"
                value={vendor}
                onChange={(event) => setVendor(event.target.value)}
              />
            </div>
            <div>
              <label className="lbl">Category</label>
              <input
                className="field sm:w-36"
                placeholder="subscription"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
              />
            </div>
            <div>
              <label className="lbl">Amount USD</label>
              <input
                className="field sm:w-28"
                inputMode="decimal"
                placeholder="49"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </div>
            <div className="sm:min-w-48 sm:flex-1">
              <label className="lbl">Note</label>
              <input className="field" value={note} onChange={(event) => setNote(event.target.value)} />
            </div>
            <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>
              Save
            </button>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-500">
            Apify usage and AI cost are recorded automatically per run and per email. Add the things
            they miss here: Apify and n8n plan fees, mailboxes, domains, Workspace. CAC is only as
            honest as these.
          </p>
        </div>
      )}
    </div>
  );
}
