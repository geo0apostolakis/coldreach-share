"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { Banner, PageHeader, Spinner, Stat } from "@/components/ui";
import { api } from "@/lib/client";

type Status = {
  spreadsheetUrl: string;
  targets: { id: string; label: string }[];
  counts: {
    companies: number;
    qualified: number;
    people: number;
    unclassified: number;
    byCategory: Record<string, number>;
    lists: Record<string, number>;
  };
  account: {
    username: string;
    plan: string;
    monthlyLimitUsd: number;
    spentUsd: number;
    remainingUsd: number;
  } | null;
  accountError: string;
  recordedSpendUsd: number;
};

type HarvestResult = {
  fetched: number;
  added: number;
  skippedExisting: number;
  costUsd: number;
};

type QualifyResult = {
  classified: number;
  qualified: number;
  byCategory: Record<string, number>;
  failedBatches: number;
};

const CATEGORY_LABELS: Record<string, string> = {
  firm: "Accounting firms",
  association: "Associations",
  network: "International networks",
  vendor: "Software vendors",
  service: "Recruiters and training",
  unsure: "Unsure, needs an eyeball",
};

export default function MachinePage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [targetId, setTargetId] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [token, setToken] = useState("");
  const [maxItems, setMaxItems] = useState(50);

  const load = useCallback(() => {
    api<Status>("/api/machine/status")
      .then((data) => {
        setStatus(data);
        setTargetId((current) => current || data.targets[0]?.id || "");
        setError("");
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load"));
  }, []);

  useEffect(() => {
    let cancelled = false;
    api<Status>("/api/machine/status")
      .then((data) => {
        if (cancelled) return;
        setStatus(data);
        setTargetId(data.targets[0]?.id ?? "");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function run<T>(path: string, body: unknown, label: string): Promise<T | null> {
    setBusy(label);
    setMessage("");
    setError("");
    try {
      return await api<T>(path, { method: "POST", body: JSON.stringify(body) });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
      return null;
    } finally {
      setBusy("");
    }
  }

  async function runHarvest() {
    const data = await run<HarvestResult>("/api/machine/harvest", { targetId, maxItems }, "harvest");
    if (!data) return;
    setMessage(
      `Harvested ${data.fetched}, added ${data.added} new, skipped ${data.skippedExisting} already in the sheet. Cost $${data.costUsd}.`,
    );
    load();
  }

  async function runQualify(recategorise?: string[]) {
    const data = await run<QualifyResult>(
      "/api/machine/qualify",
      { targetId, recategorise },
      recategorise ? "recategorise" : "qualify",
    );
    if (!data) return;
    const parts = Object.entries(data.byCategory)
      .map(([key, count]) => `${CATEGORY_LABELS[key] ?? key}: ${count}`)
      .join(", ");
    setMessage(
      `Classified ${data.classified}. ${parts}. ${data.qualified} copied to Qualified.` +
        (data.failedBatches ? ` ${data.failedBatches} batches failed and stayed unclassified.` : ""),
    );
    load();
  }

  async function saveToken() {
    const data = await run<{ account: Status["account"] }>(
      "/api/machine/token",
      { token, save: true },
      "token",
    );
    if (!data?.account) return;
    setMessage(`Key saved. Plan ${data.account.plan}, $${data.account.remainingUsd} left this month.`);
    setToken("");
    load();
  }

  const counts = status?.counts;
  const unsureCount = counts?.byCategory.unsure ?? 0;
  const lowCredit = (status?.account?.remainingUsd ?? 1) < 1;

  return (
    <div>
      <PageHeader title="Lead Machine" subtitle="LinkedIn company search to a named decision maker.">
        {status?.spreadsheetUrl && (
          <a
            href={status.spreadsheetUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 rounded-lg border border-ink-700 px-2.5 py-1.5 text-xs text-ink-300 hover:text-ink-100"
          >
            Open sheet <ExternalLink size={12} />
          </a>
        )}
        <button
          onClick={load}
          className="flex items-center gap-1.5 rounded-lg border border-ink-700 px-2.5 py-1.5 text-xs text-ink-300 hover:text-ink-100"
        >
          <RefreshCw size={13} />
          Refresh
        </button>
      </PageHeader>

      <div className="mx-auto max-w-3xl space-y-5 px-4 sm:px-8 py-7">
        {error && <Banner tone="error">{error}</Banner>}
        {message && <Banner tone="info">{message}</Banner>}

        <section className="rounded-xl border border-ink-700 bg-ink-900/60 p-5">
          <h2 className="mb-3.5 text-sm font-medium">Apify account</h2>

          {status?.account ? (
            <p className="mb-3.5 text-sm text-ink-300">
              <span className="text-ink-100">{status.account.username}</span> on{" "}
              <span className="text-ink-100">{status.account.plan}</span>. Spent $
              {status.account.spentUsd} of ${status.account.monthlyLimitUsd},{" "}
              <span className={lowCredit ? "text-bad-500" : "text-ink-100"}>
                ${status.account.remainingUsd} left
              </span>
              .
            </p>
          ) : (
            <p className="mb-3.5 text-sm text-ink-400">{status?.accountError || "Checking..."}</p>
          )}

          <div className="flex gap-2">
            <input
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="Paste a new Apify token to swap keys"
              className="w-full min-w-0 flex-1 rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm outline-none placeholder:text-ink-500 focus:border-ink-600"
            />
            <button
              onClick={() => void saveToken()}
              disabled={!token.trim() || Boolean(busy)}
              className="flex items-center gap-2 rounded-lg bg-ink-100 px-3.5 py-2 text-sm font-medium text-ink-950 disabled:opacity-40"
            >
              {busy === "token" && <Spinner size={14} />}
              Verify and save
            </button>
          </div>
          <p className="mt-2 text-xs text-ink-400">
            Verified against Apify before it is stored, so a typo cannot break the next run.
          </p>
        </section>

        <section className="rounded-xl border border-ink-700 bg-ink-900/60 p-5">
          <h2 className="mb-3.5 text-sm font-medium">Target</h2>
          <select
            value={targetId}
            onChange={(event) => setTargetId(event.target.value)}
            className="w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm outline-none focus:border-ink-600"
          >
            {status?.targets.map((target) => (
              <option key={target.id} value={target.id}>
                {target.label}
              </option>
            ))}
          </select>
        </section>

        <section className="rounded-xl border border-ink-700 bg-ink-900/60 p-5">
          <h2 className="text-sm font-medium">Stage 1, harvest</h2>
          <p className="mb-4 mt-1 text-xs text-ink-400">
            About $0.10 per 50 companies. Apify bills per page fetched, so a re-run pays for the
            same pages again even though duplicates are discarded before they reach the sheet.
          </p>
          <div className="flex items-center gap-2.5">
            <label htmlFor="maxItems" className="text-sm text-ink-300">
              Max companies
            </label>
            <input
              id="maxItems"
              type="number"
              value={maxItems}
              min={50}
              max={1000}
              step={50}
              onChange={(event) => setMaxItems(Number(event.target.value))}
              className="w-24 rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm outline-none focus:border-ink-600"
            />
            <button
              onClick={() => void runHarvest()}
              disabled={!targetId || Boolean(busy)}
              className="ml-auto flex items-center gap-2 rounded-lg bg-ink-100 px-4 py-2 text-sm font-medium text-ink-950 disabled:opacity-40"
            >
              {busy === "harvest" && <Spinner size={14} />}
              {busy === "harvest" ? "Harvesting" : "Run harvest"}
            </button>
          </div>
        </section>

        <section className="rounded-xl border border-ink-700 bg-ink-900/60 p-5">
          <h2 className="text-sm font-medium">Stage 2, classify</h2>
          <p className="mb-4 mt-1 text-xs text-ink-400">
            Routes every company into a category. Nothing is deleted, and associations are kept
            because they are rooms full of accountants.
          </p>
          <div className="flex items-center gap-3">
            <span className="text-sm text-ink-300">
              {counts?.unclassified ?? 0} waiting to be classified
            </span>
            <button
              onClick={() => void runQualify()}
              disabled={!targetId || Boolean(busy) || !counts?.unclassified}
              className="ml-auto flex items-center gap-2 rounded-lg bg-ink-100 px-4 py-2 text-sm font-medium text-ink-950 disabled:opacity-40"
            >
              {busy === "qualify" && <Spinner size={14} />}
              {busy === "qualify" ? "Classifying" : "Run classifier"}
            </button>
          </div>

          {Boolean(unsureCount) && (
            <div className="mt-4 flex items-center gap-3 border-t border-ink-700 pt-4">
              <span className="text-sm text-ink-300">
                {unsureCount} came back unsure, almost always a missing description
              </span>
              <button
                onClick={() => void runQualify(["unsure"])}
                disabled={!targetId || Boolean(busy)}
                className="ml-auto flex items-center gap-2 rounded-lg border border-ink-700 px-3.5 py-2 text-sm text-ink-200 disabled:opacity-40"
              >
                {busy === "recategorise" && <Spinner size={14} />}
                Re-run the unsure ones
              </button>
            </div>
          )}
        </section>

        <section className="rounded-xl border border-ink-700 bg-ink-900/60 p-5">
          <div className="grid grid-cols-3 gap-4">
            <Stat label="Harvested" value={String(counts?.companies ?? 0)} />
            <Stat label="Qualified" value={String(counts?.qualified ?? 0)} />
            <Stat label="Decision makers" value={String(counts?.people ?? 0)} />
          </div>

          {counts && Object.keys(counts.lists).length > 0 && (
            <div className="mt-5 border-t border-ink-700 pt-4">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                Working lists
              </p>
              <ul className="space-y-1.5">
                {Object.entries(counts.lists).map(([tab, count]) => (
                  <li key={tab} className="flex justify-between text-sm">
                    <span className="text-ink-300">{tab}</span>
                    <span className="tabular-nums text-ink-200">{count}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {counts && Object.keys(counts.byCategory).length > 0 && (
            <div className="mt-5 border-t border-ink-700 pt-4">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                Every harvested company
              </p>
              <ul className="space-y-1.5">
                {Object.entries(counts.byCategory)
                  .sort((a, b) => b[1] - a[1])
                  .map(([key, count]) => (
                    <li key={key} className="flex justify-between text-sm">
                      <span className="text-ink-400">{CATEGORY_LABELS[key] ?? key}</span>
                      <span className="tabular-nums text-ink-200">{count}</span>
                    </li>
                  ))}
              </ul>
            </div>
          )}

          <p className="mt-4 text-xs text-ink-400">
            Recorded Apify spend across all runs: ${status?.recordedSpendUsd ?? 0}
          </p>
        </section>
      </div>
    </div>
  );
}
