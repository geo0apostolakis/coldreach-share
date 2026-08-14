"use client";

import { useEffect, useState } from "react";
import { use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Pause, Play, RotateCcw, Save, Square, Trash2, Zap } from "lucide-react";
import ComposeEditor from "@/components/ComposeEditor";
import ScheduleForm, { type ScheduleValue } from "@/components/ScheduleForm";
import OutcomePanel from "@/components/OutcomePanel";
import { Banner, ProgressBar, Spinner, StatusPill } from "@/components/ui";
import { api, type CampaignView, type LogEntry } from "@/lib/client";
import type { CampaignConfig, CampaignStatus, Folder, Outcome } from "@/lib/types";

const TABS = ["Overview", "Email", "Schedule", "Outcomes"] as const;

export default function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [campaign, setCampaign] = useState<CampaignView | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [sentValue, setSentValue] = useState("");
  const [tab, setTab] = useState<(typeof TABS)[number]>("Overview");
  const [config, setConfig] = useState<CampaignConfig | null>(null);
  const [schedule, setSchedule] = useState<ScheduleValue | null>(null);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");
  const [busy, setBusy] = useState(false);

  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((key) => key + 1);

  useEffect(() => {
    let cancelled = false;
    api<{ campaign: CampaignView }>(`/api/campaigns/${id}`)
      .then((data) => {
        if (cancelled) return;
        setCampaign(data.campaign);
        setConfig(data.campaign.config);
        setSentValue(data.campaign.sentValue);
        setSchedule({
          firstDayVolume: data.campaign.firstDayVolume,
          dailyIncrement: data.campaign.dailyIncrement,
          maxDailyLimit: data.campaign.maxDailyLimit,
          sendWindowStart: data.campaign.sendWindowStart,
          sendWindowEnd: data.campaign.sendWindowEnd,
          timezone: data.campaign.timezone,
          startDate: data.campaign.startDate,
        });
        setError("");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load campaign");
      });

    api<{ outcomes: Outcome[] }>(`/api/outcomes?campaignId=${id}`)
      .then((data) => !cancelled && setOutcomes(data.outcomes))
      .catch(() => !cancelled && setOutcomes([]));

    api<{ folders: Folder[] }>("/api/folders")
      .then((data) => !cancelled && setFolders(data.folders))
      .catch(() => !cancelled && setFolders([]));

    api<{ logs: LogEntry[] }>(`/api/logs?campaignId=${id}&limit=50`)
      .then((data) => !cancelled && setLogs(data.logs))
      .catch(() => !cancelled && setLogs([]));

    return () => {
      cancelled = true;
    };
  }, [id, reloadKey]);

  async function patch(body: Record<string, unknown>, note?: string) {
    setBusy(true);
    setFlash("");
    try {
      await api(`/api/campaigns/${id}`, { method: "PATCH", body: JSON.stringify(body) });
      reload();
      if (note) setFlash(note);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  async function runNow() {
    setBusy(true);
    setFlash("");
    try {
      const result = await api<{ busy?: boolean; results: { action: string; reason?: string; email?: string }[] }>(
        `/api/campaigns/${id}/run-now`,
        { method: "POST" },
      );
      const first = result.results[0];
      setFlash(
        result.busy
          ? "Another run is in progress."
          : !first
            ? "Nothing to send — the campaign isn't running."
            : first.action === "sent"
              ? `Sent to ${first.email}`
              : `${first.action}: ${first.reason ?? ""}`,
      );
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Run failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm("Delete this campaign? Leads and logs in your sheets are kept.")) return;
    await api(`/api/campaigns/${id}`, { method: "DELETE" });
    router.push("/");
  }

  if (!campaign || !config || !schedule) {
    return (
      <div className="flex items-center gap-2 px-4 sm:px-8 py-8 text-sm text-ink-400">
        {error ? <Banner tone="error">{error}</Banner> : <><Spinner /> Loading…</>}
      </div>
    );
  }

  const statusButton = (status: CampaignStatus, label: string, icon: React.ReactNode) => (
    <button className="btn btn-ghost" disabled={busy} onClick={() => patch({ status }, label)}>
      {icon}
      {label}
    </button>
  );

  return (
    <>
      <div className="border-b border-ink-700 px-4 sm:px-8 py-6">
        <Link href="/" className="mb-4 flex w-fit items-center gap-1.5 text-sm text-ink-400 hover:text-ink-100">
          <ArrowLeft size={15} />
          Campaigns
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-xl font-semibold tracking-tight">{campaign.name}</h1>
              <StatusPill status={campaign.status} />
              {campaign.mode === "test" && (
                <span className="rounded-full border border-warn-500/30 bg-warn-500/12 px-2 py-0.5 text-[11px] font-semibold text-warn-500">
                  TEST
                </span>
              )}
            </div>
            <p className="mt-1 break-words text-sm text-ink-400">
              {campaign.leadsSpreadsheetName} → {campaign.leadsSheetName} · writes to “
              {campaign.statusColumn}”
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {campaign.status === "running"
              ? statusButton("paused", "Pause", <Pause size={14} />)
              : statusButton("running", campaign.status === "draft" ? "Start" : "Resume", <Play size={14} />)}
            <button className="btn btn-ghost" disabled={busy || campaign.status !== "running"} onClick={runNow}>
              {busy ? <Spinner /> : <Zap size={14} />}
              Run now
            </button>
            {campaign.status !== "draft" && statusButton("draft", "Stop", <Square size={14} />)}
            <button className="btn btn-danger" onClick={remove}>
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      </div>

      <div className="scroll-x flex gap-1 border-b border-ink-700 px-4 sm:px-8">
        {TABS.map((name) => (
          <button
            key={name}
            onClick={() => setTab(name)}
            className={`-mb-px shrink-0 border-b-2 px-3 py-2.5 text-sm transition-colors ${
              tab === name
                ? "border-brand-500 font-medium text-ink-100"
                : "border-transparent text-ink-400 hover:text-ink-100"
            }`}
          >
            {name}
          </button>
        ))}
      </div>

      <div className="space-y-5 px-4 sm:px-8 py-6">
        {error && <Banner tone="error">{error}</Banner>}
        {flash && <Banner tone="good">{flash}</Banner>}

        {tab === "Outcomes" && (
          <OutcomePanel
            campaignId={id}
            outcomes={outcomes}
            logs={logs}
            onChange={reload}
          />
        )}

        {tab === "Overview" && (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <div className="card p-5">
                <div className="mb-1.5 flex items-baseline justify-between text-xs">
                  <span className="text-ink-400">Sent today</span>
                  <span className="tabular-nums text-ink-400">
                    <span className="text-base font-semibold text-ink-100">{campaign.sentToday}</span> /{" "}
                    {campaign.quota}
                  </span>
                </div>
                <ProgressBar value={campaign.sentToday} max={campaign.quota} />
                <button
                  className="mt-3 flex items-center gap-1.5 text-xs text-ink-400 hover:text-ink-100"
                  onClick={() => patch({ sentToday: 0 }, "Today's counter reset")}
                >
                  <RotateCcw size={12} />
                  Reset counter
                </button>
              </div>
              {[
                ["Total sent", campaign.totalSent],
                ["Leads waiting", campaign.leads.pending],
                ["Ramp day", campaign.currentDay || 1],
              ].map(([label, value]) => (
                <div key={String(label)} className="card p-5">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                    {label}
                  </div>
                  <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
                </div>
              ))}
            </div>

            <div className="card p-5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                Mode
              </div>
              <p className="mt-1 text-xs text-ink-400">
                Test mode sends every email to your own inbox and leaves the leads sheet completely
                alone: no status written, no counter moved, no lead used up. Test campaigns are
                skipped by the schedule, so use Run now.
              </p>
              <div className="mt-3 flex gap-2">
                {(["production", "test"] as const).map((value) => (
                  <button
                    key={value}
                    className={campaign.mode === value ? "btn btn-primary" : "btn btn-ghost"}
                    disabled={busy}
                    onClick={() => patch({ mode: value }, `Switched to ${value}`)}
                  >
                    {value === "production" ? "Production" : "Test"}
                  </button>
                ))}
              </div>

              <div className="mt-5 text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                Status written on send
              </div>
              <p className="mt-1 text-xs text-ink-400">
                Goes into the &ldquo;{campaign.statusColumn}&rdquo; column when an email goes out.
              </p>
              <div className="mt-2 flex gap-2">
                <input
                  className="field max-w-xs"
                  value={sentValue}
                  onChange={(event) => setSentValue(event.target.value)}
                  placeholder="Sent"
                />
                <button
                  className="btn btn-ghost"
                  disabled={busy || sentValue === campaign.sentValue}
                  onClick={() => patch({ sentValue }, "Status value saved")}
                >
                  <Save size={14} />
                  Save
                </button>
              </div>
            </div>

            <div className="card p-5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                Folder
              </div>
              <p className="mt-1 text-xs text-ink-400">
                Filing this campaign under a client groups its spend and metrics with the rest of that
                client&apos;s work.
              </p>
              <select
                className="field mt-3 max-w-xs"
                value={campaign.folderId ?? ""}
                onChange={(event) => patch({ folderId: event.target.value }, "Folder updated")}
              >
                <option value="">Not in a folder</option>
                {folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="card overflow-hidden">
              <div className="border-b border-ink-700 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-ink-400">
                Recent sends
              </div>
              {logs.length === 0 ? (
                <p className="px-4 py-6 text-sm text-ink-400">Nothing sent yet.</p>
              ) : (
                <div className="scroll-x">
                  <table className="w-full text-left text-[13px]">
                    <thead>
                      <tr className="border-b border-ink-700 text-ink-400">
                        <th className="px-4 py-2 font-medium">When</th>
                        <th className="px-4 py-2 font-medium">To</th>
                        <th className="px-4 py-2 font-medium">Variant</th>
                        <th className="px-4 py-2 font-medium">Subject</th>
                        <th className="px-4 py-2 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {logs.map((entry, index) => (
                        <tr key={index} className="border-b border-ink-800 last:border-0">
                          <td className="whitespace-nowrap px-4 py-2 text-ink-400">
                            {entry.timestamp?.replace("T", " ").slice(0, 16)}
                          </td>
                          <td className="px-4 py-2">{entry.email}</td>
                          <td className="px-4 py-2 text-ink-400">{entry.variant}</td>
                          <td className="max-w-72 truncate px-4 py-2 text-ink-300">{entry.subject}</td>
                          <td className="px-4 py-2">
                            <span className={entry.status === "Sent" ? "text-good-500" : "text-bad-500"}>
                              {entry.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}

        {tab === "Email" && (
          <>
            <ComposeEditor
              config={config}
              onChange={setConfig}
              headers={campaign.leads.headers ?? []}
              source={{
                spreadsheetId: campaign.leadsSpreadsheetId,
                tab: campaign.leadsSheetName,
                emailColumn: campaign.emailColumn,
                statusColumn: campaign.statusColumn,
              }}
            />
            <button className="btn btn-primary" disabled={busy} onClick={() => patch({ config }, "Email saved")}>
              {busy ? <Spinner /> : <Save size={14} />}
              Save email
            </button>
          </>
        )}

        {tab === "Schedule" && (
          <>
            <ScheduleForm value={schedule} onChange={setSchedule} />
            <button
              className="btn btn-primary"
              disabled={busy}
              onClick={() => patch({ ...schedule }, "Schedule saved")}
            >
              {busy ? <Spinner /> : <Save size={14} />}
              Save schedule
            </button>
          </>
        )}
      </div>
    </>
  );
}
