"use client";

import { Loader2 } from "lucide-react";
import type { CampaignStatus } from "@/lib/types";

const STATUS_STYLE: Record<CampaignStatus, string> = {
  running: "bg-good-500/12 text-good-500 border-good-500/30",
  paused: "bg-warn-500/12 text-warn-500 border-warn-500/30",
  draft: "bg-ink-700/60 text-ink-300 border-ink-600",
  done: "bg-brand-500/12 text-brand-400 border-brand-500/30",
};

export function StatusPill({ status }: { status: CampaignStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold capitalize ${STATUS_STYLE[status] ?? STATUS_STYLE.draft}`}
    >
      {status === "running" && (
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-good-500" />
      )}
      {status}
    </span>
  );
}

export function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-800">
      <div
        className="h-full rounded-full bg-brand-500 transition-[width] duration-500"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="text-xs text-ink-400">{hint}</div>}
    </div>
  );
}

export function Spinner({ size = 15 }: { size?: number }) {
  return <Loader2 size={size} className="animate-spin" />;
}

export function PageHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-ink-700 px-4 py-5 sm:gap-4 sm:px-8 sm:py-6">
      <div className="min-w-0">
        <h1 className="text-lg font-semibold tracking-tight sm:text-xl">{title}</h1>
        {subtitle && <p className="mt-1 text-[13px] text-ink-400 sm:text-sm">{subtitle}</p>}
      </div>
      {/* Actions go full width on a phone so they are easy to hit. */}
      {children && <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">{children}</div>}
    </div>
  );
}

export function Banner({ tone, children }: { tone: "error" | "info" | "good"; children: React.ReactNode }) {
  const style =
    tone === "error"
      ? "border-bad-500/35 bg-bad-500/10 text-bad-500"
      : tone === "good"
        ? "border-good-500/35 bg-good-500/10 text-good-500"
        : "border-ink-600 bg-ink-800 text-ink-300";
  return <div className={`rounded-lg border px-3.5 py-2.5 text-sm ${style}`}>{children}</div>;
}

export function EmptyState({
  icon,
  title,
  body,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="card grid place-items-center px-6 py-16 text-center">
      <div className="mb-3 grid h-11 w-11 place-items-center rounded-xl bg-ink-800 text-ink-400">
        {icon}
      </div>
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-ink-400">{body}</p>
      {children && <div className="mt-5">{children}</div>}
    </div>
  );
}
