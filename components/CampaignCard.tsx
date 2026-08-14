"use client";

import Link from "next/link";
import { Pause, Play, Zap } from "lucide-react";
import { ProgressBar, Spinner, StatusPill } from "@/components/ui";
import type { CampaignView } from "@/lib/client";

export default function CampaignCard({
  campaign,
  busy,
  onSetStatus,
  onRunNow,
}: {
  campaign: CampaignView;
  busy: boolean;
  onSetStatus: (campaign: CampaignView, status: "running" | "paused") => void;
  onRunNow: (campaign: CampaignView) => void;
}) {
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Link
            href={`/campaigns/${campaign.id}`}
            className="truncate text-[15px] font-semibold hover:text-brand-400"
          >
            {campaign.name}
          </Link>
          <p className="mt-0.5 truncate text-xs text-ink-400">
            {campaign.leadsSpreadsheetName} → {campaign.leadsSheetName}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {campaign.mode === "test" && (
            <span className="rounded-full border border-warn-500/30 bg-warn-500/12 px-2 py-0.5 text-[11px] font-semibold text-warn-500">
              TEST
            </span>
          )}
          <StatusPill status={campaign.status} />
        </div>
      </div>

      <div className="mt-5">
        <div className="mb-1.5 flex items-baseline justify-between text-xs">
          <span className="text-ink-400">Today</span>
          <span className="tabular-nums">
            <span className="text-sm font-semibold text-ink-100">{campaign.sentToday}</span>
            <span className="text-ink-400"> / {campaign.quota}</span>
          </span>
        </div>
        <ProgressBar value={campaign.sentToday} max={campaign.quota} />
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3 border-t border-ink-700 pt-4 text-center">
        <div>
          <div className="text-sm font-semibold tabular-nums">{campaign.totalSent}</div>
          <div className="text-[11px] uppercase tracking-wider text-ink-400">Sent</div>
        </div>
        <div>
          <div className="text-sm font-semibold tabular-nums">{campaign.leads.pending}</div>
          <div className="text-[11px] uppercase tracking-wider text-ink-400">Waiting</div>
        </div>
        <div>
          <div className="text-sm font-semibold tabular-nums">Day {campaign.currentDay || 1}</div>
          <div className="text-[11px] uppercase tracking-wider text-ink-400">Ramp</div>
        </div>
      </div>

      {campaign.lastError && (
        <p className="mt-3 truncate text-xs text-bad-500" title={campaign.lastError}>
          {campaign.lastError}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {campaign.status === "running" ? (
          <button className="btn btn-ghost" disabled={busy} onClick={() => onSetStatus(campaign, "paused")}>
            <Pause size={14} />
            Pause
          </button>
        ) : (
          <button
            className="btn btn-primary"
            disabled={busy || campaign.leads.pending === 0}
            onClick={() => onSetStatus(campaign, "running")}
          >
            <Play size={14} />
            {campaign.status === "draft" ? "Start" : "Resume"}
          </button>
        )}
        <button
          className="btn btn-ghost"
          disabled={busy || campaign.status !== "running"}
          onClick={() => onRunNow(campaign)}
          title="Send one email right now"
        >
          {busy ? <Spinner /> : <Zap size={14} />}
          Run now
        </button>
        <Link href={`/campaigns/${campaign.id}`} className="btn btn-ghost ml-auto">
          Open
        </Link>
      </div>
    </div>
  );
}
