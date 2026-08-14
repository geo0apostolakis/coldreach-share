"use client";

import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink, RefreshCw, X } from "lucide-react";
import { Banner, PageHeader, Spinner } from "@/components/ui";
import { api } from "@/lib/client";

type Health = {
  google: { ok: boolean; detail: string };
  graph: { ok: boolean; detail: string };
  openrouter: { ok: boolean; detail: string };
  googleSignedIn: boolean;
  pickerReady: boolean;
  controlSheetUrl: string;
  cronUrl: string;
  cronConfigured: boolean;
  testEmailTo: string;
};

function Row({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="flex items-center gap-2.5">
        <span
          className={`grid h-5 w-5 place-items-center rounded-full ${
            ok ? "bg-good-500/15 text-good-500" : "bg-bad-500/15 text-bad-500"
          }`}
        >
          {ok ? <Check size={12} /> : <X size={12} />}
        </span>
        <span className="text-sm font-medium">{label}</span>
      </div>
      <span className="min-w-0 flex-1 truncate text-right text-xs text-ink-400" title={detail}>
        {detail}
      </span>
    </div>
  );
}

export default function SettingsPage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [gap, setGap] = useState("");
  const [gapSaved, setGapSaved] = useState<number | null>(null);
  const [gapBusy, setGapBusy] = useState(false);
  const [gapNote, setGapNote] = useState("");

  useEffect(() => {
    let cancelled = false;
    api<Health>("/api/health")
      .then((data) => {
        if (cancelled) return;
        setHealth(data);
        setError("");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Health check failed");
      });
    api<{ minutes: number }>("/api/pacing")
      .then((data) => {
        if (cancelled) return;
        setGap(String(data.minutes));
        setGapSaved(data.minutes);
      })
      .catch(() => {
        if (!cancelled) setGapNote("Could not read the current gap.");
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  function load() {
    setHealth(null);
    setReloadKey((key) => key + 1);
  }

  async function saveGap() {
    setGapBusy(true);
    setGapNote("");
    try {
      const result = await api<{ minutes: number }>("/api/pacing", {
        method: "POST",
        body: JSON.stringify({ minutes: Number(gap) }),
      });
      setGap(String(result.minutes));
      setGapSaved(result.minutes);
      setGapNote(result.minutes === 0 ? "Pacing off." : `Saved: one email every ${result.minutes} min.`);
    } catch (err: unknown) {
      setGapNote(err instanceof Error ? err.message : "Could not save the gap");
    } finally {
      setGapBusy(false);
    }
  }

  function copy(value: string, key: string) {
    navigator.clipboard.writeText(value);
    setCopied(key);
    setTimeout(() => setCopied(""), 1500);
  }

  return (
    <>
      <PageHeader title="Settings" subtitle="Connections and the scheduler that drives sending.">
        <button className="btn btn-ghost" onClick={load}>
          <RefreshCw size={14} />
          Re-check
        </button>
      </PageHeader>

      <div className="max-w-3xl space-y-5 px-4 sm:px-8 py-6">
        {error && <Banner tone="error">{error}</Banner>}

        <div className="card p-5">
          <div className="lbl">Connections</div>
          {!health ? (
            <div className="flex items-center gap-2 py-3 text-sm text-ink-400">
              <Spinner /> Checking…
            </div>
          ) : (
            <div className="divide-y divide-ink-700">
              <Row label="Google Sheets" ok={health.google.ok} detail={health.google.detail} />
              <Row label="Outlook (Microsoft Graph)" ok={health.graph.ok} detail={health.graph.detail} />
              <Row label="OpenRouter" ok={health.openrouter.ok} detail={health.openrouter.detail} />
              <Row
                label="Cron secret"
                ok={health.cronConfigured}
                detail={health.cronConfigured ? "configured" : "CRON_SECRET is not set"}
              />
            </div>
          )}
        </div>

        {health && (
          <>
            <div className="card p-5">
              <div className="lbl">Google account</div>
              <p className="mb-3 text-sm leading-relaxed text-ink-300">
                {health.googleSignedIn
                  ? "Signed in. Any spreadsheet you choose through the picker becomes available to Automatesphere — nothing else in your Drive is readable."
                  : "Not signed in yet. Run node scripts/google-auth.mjs and put the printed GOOGLE_REFRESH_TOKEN in your environment."}
              </p>
              {!health.pickerReady && (
                <p className="text-sm text-warn-500">
                  GOOGLE_API_KEY, GOOGLE_CLIENT_ID or GOOGLE_PROJECT_NUMBER is missing, so the Drive picker
                  can&apos;t open.
                </p>
              )}
              {health.controlSheetUrl && (
                <a
                  href={health.controlSheetUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 flex w-fit items-center gap-1.5 text-sm text-brand-400 hover:underline"
                >
                  <ExternalLink size={13} />
                  Open the control spreadsheet
                </a>
              )}
            </div>

            <div className="card p-5">
              <div className="lbl">Scheduler</div>
              <p className="mb-3 text-sm leading-relaxed text-ink-300">
                Without pacing a tick sends <strong>one email per running campaign</strong>, so six
                campaigns means six emails at once. Set a gap below to send one at a time instead. Point{" "}
                <a href="https://cron-job.org" target="_blank" rel="noreferrer" className="text-brand-400 hover:underline">
                  cron-job.org
                </a>{" "}
                at the URL below, with the secret in an{" "}
                <code className="font-mono text-xs text-brand-400">x-cron-secret</code> header. Each
                campaign&apos;s Schedule tab shows the interval that spreads its volume across the
                sending window.
              </p>
              <button className="chip !text-ink-100" onClick={() => copy(health.cronUrl, "cron")}>
                {copied === "cron" ? <Check size={12} /> : <Copy size={12} />}
                {health.cronUrl}
              </button>
              <p className="mt-3 text-xs text-ink-400">
                The secret lives only in the <code className="font-mono">CRON_SECRET</code> environment
                variable — it is never shown here.
              </p>
            </div>

            <div className="card p-5">
              <div className="lbl">Gap between emails</div>
              <p className="mb-3 text-sm leading-relaxed text-ink-300">
                Minutes to wait after any email before the next one goes out, counted across every
                campaign together. <strong>0 turns pacing off.</strong> Keep the cron ticking faster than
                the gap, otherwise the cron is the real limit. Run now ignores this.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  className="field !w-28 min-w-0"
                  type="number"
                  min={0}
                  max={1440}
                  step={1}
                  value={gap}
                  onChange={(event) => setGap(event.target.value)}
                  placeholder="0"
                />
                <button className="btn btn-primary" onClick={saveGap} disabled={gapBusy || gap === ""}>
                  {gapBusy ? <Spinner /> : <Check size={14} />}
                  Save
                </button>
              </div>
              {Number(gap) > 0 && (
                <p className="mt-3 text-xs text-ink-400">
                  In an 8 hour sending window that is about{" "}
                  <span className="text-ink-100">{Math.floor(480 / Number(gap))} emails a day</span> in
                  total, shared across every running campaign.
                </p>
              )}
              {gapNote && <p className="mt-2 text-xs text-ink-400">{gapNote}</p>}
              {gapSaved !== null && gapSaved > 0 && Number(gap) !== gapSaved && (
                <p className="mt-2 text-xs text-warn-500">Not saved yet, currently {gapSaved} min.</p>
              )}
            </div>

            <div className="card p-5">
              <div className="lbl">Test emails</div>
              <p className="text-sm text-ink-300">
                “Send test to me” delivers to{" "}
                <span className="text-ink-100">{health.testEmailTo || "— set TEST_EMAIL_TO —"}</span>.
              </p>
            </div>
          </>
        )}
      </div>
    </>
  );
}
