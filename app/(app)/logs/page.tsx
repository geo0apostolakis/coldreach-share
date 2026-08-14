"use client";

import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Banner, PageHeader, Spinner } from "@/components/ui";
import { api, type CampaignView, type LogEntry } from "@/lib/client";

export default function LogsPage() {
  const [logs, setLogs] = useState<LogEntry[] | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignView[]>([]);
  const [campaignId, setCampaignId] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [open, setOpen] = useState<LogEntry | null>(null);

  useEffect(() => {
    api<{ campaigns: CampaignView[] }>("/api/campaigns")
      .then((data) => setCampaigns(data.campaigns))
      .catch(() => setCampaigns([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    api<{ logs: LogEntry[] }>(`/api/logs?limit=500${campaignId ? `&campaignId=${campaignId}` : ""}`)
      .then((data) => !cancelled && setLogs(data.logs))
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load logs");
        setLogs([]);
      });
    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  const filtered = useMemo(() => {
    if (!logs) return [];
    const needle = query.trim().toLowerCase();
    if (!needle) return logs;
    return logs.filter((entry) =>
      [entry.email, entry.company, entry.subject, entry.campaignName, entry.status]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [logs, query]);

  return (
    <>
      <PageHeader title="Activity" subtitle="Every email Automatesphere has sent, straight from the Email Log tab." />

      <div className="space-y-4 px-4 sm:px-8 py-6">
        {error && <Banner tone="error">{error}</Banner>}

        <div className="flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-56">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <input
              className="field !pl-9"
              placeholder="Search email, company, subject…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {/* A select is sized by its widest option, and a campaign name is
              long enough to push the row past a phone, so cap it at the row. */}
          <select
            className="field !w-auto max-w-full min-w-0"
            value={campaignId}
            onChange={(e) => setCampaignId(e.target.value)}
          >
            <option value="">All campaigns</option>
            {campaigns.map((campaign) => (
              <option key={campaign.id} value={campaign.id}>
                {campaign.name}
              </option>
            ))}
          </select>
        </div>

        {logs === null ? (
          <div className="flex items-center gap-2 text-sm text-ink-400">
            <Spinner /> Loading…
          </div>
        ) : (
          <div className="card overflow-hidden">
            <div className="scroll-x">
              <table className="w-full text-left text-[13px]">
                <thead>
                  <tr className="border-b border-ink-700 text-ink-400">
                    <th className="px-4 py-2.5 font-medium">When</th>
                    <th className="px-4 py-2.5 font-medium">Campaign</th>
                    <th className="px-4 py-2.5 font-medium">To</th>
                    <th className="px-4 py-2.5 font-medium">Company</th>
                    <th className="px-4 py-2.5 font-medium">Variant</th>
                    <th className="px-4 py-2.5 font-medium">Subject</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((entry, index) => (
                    <tr
                      key={index}
                      onClick={() => setOpen(entry)}
                      className="cursor-pointer border-b border-ink-800 last:border-0 hover:bg-ink-800/60"
                    >
                      <td className="whitespace-nowrap px-4 py-2 text-ink-400">
                        {entry.timestamp?.replace("T", " ").slice(0, 16)}
                      </td>
                      <td className="px-4 py-2 text-ink-300">{entry.campaignName}</td>
                      <td className="px-4 py-2">{entry.email}</td>
                      <td className="px-4 py-2 text-ink-300">{entry.company}</td>
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
            {filtered.length === 0 && <p className="px-4 py-8 text-sm text-ink-400">No matching activity.</p>}
          </div>
        )}
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-4"
          onClick={() => setOpen(null)}
        >
          <div className="card max-h-[80vh] w-full max-w-2xl overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <div className="text-xs text-ink-400">
              {open.timestamp} · {open.campaignName} · {open.variant}
            </div>
            <div className="mt-2 text-sm text-ink-300">To {open.email}</div>
            <div className="mt-4 border-t border-ink-700 pt-4 text-sm font-medium">{open.subject}</div>
            <pre className="mt-3 whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-ink-300">
              {open.body}
            </pre>
            {open.error && (
              <div className="mt-4">
                <Banner tone="error">{open.error}</Banner>
              </div>
            )}
            <button className="btn btn-ghost mt-5" onClick={() => setOpen(null)}>
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}
