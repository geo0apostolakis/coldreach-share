"use client";

import { useEffect, useState } from "react";
import { Spinner } from "@/components/ui";
import { api } from "@/lib/client";
import { SAFE_DAILY_PER_MAILBOX, senderHealth } from "@/lib/metrics";

type Volume = {
  dates: string[];
  senders: string[];
  counts: Record<string, Record<string, number>>;
  perDayTotal: Record<string, number>;
};

const TONE = {
  ok: "text-ink-200",
  warn: "text-warn-500",
  bad: "text-bad-500",
} as const;

export default function SendingVolume() {
  const [volume, setVolume] = useState<Volume | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<{ volume: Volume }>("/api/sending?days=14")
      .then((data) => !cancelled && setVolume(data.volume))
      .catch(() => !cancelled && setVolume(null));
    return () => {
      cancelled = true;
    };
  }, []);

  if (!volume) {
    return (
      <div className="flex items-center gap-2 text-sm text-ink-400">
        <Spinner /> Loading sending volume…
      </div>
    );
  }

  if (volume.dates.length === 0) {
    return (
      <div className="card p-5 text-sm text-ink-400">
        Nothing sent yet. Once emails go out, this shows how many left each address each day, which
        is the number that decides whether a domain stays out of spam.
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-ink-700 px-4 py-2.5">
        <span className="text-xs font-semibold uppercase tracking-wider text-ink-400">
          Emails per day, per sending address
        </span>
        <span className="text-[11px] text-ink-500">
          Amber over {SAFE_DAILY_PER_MAILBOX.steadyCap} per address per day, red over{" "}
          {SAFE_DAILY_PER_MAILBOX.hardCap}
        </span>
      </div>
      <div className="scroll-x">
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="border-b border-ink-700 text-ink-400">
              <th className="px-4 py-2 font-medium">Day</th>
              {volume.senders.map((sender) => (
                <th key={sender} className="px-4 py-2 font-medium">
                  {sender}
                </th>
              ))}
              <th className="px-4 py-2 font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {volume.dates.map((date) => (
              <tr key={date} className="border-b border-ink-800 last:border-0">
                <td className="whitespace-nowrap px-4 py-2 text-ink-400">{date}</td>
                {volume.senders.map((sender) => {
                  const count = volume.counts[date]?.[sender] ?? 0;
                  return (
                    <td
                      key={sender}
                      className={`px-4 py-2 tabular-nums ${count ? TONE[senderHealth(count)] : "text-ink-600"}`}
                    >
                      {count || "0"}
                    </td>
                  );
                })}
                <td className="px-4 py-2 font-semibold tabular-nums">{volume.perDayTotal[date]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
