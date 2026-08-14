"use client";

import { minutesOfDay, quotaForDay } from "@/lib/time";

/**
 * Half-hour slots instead of <input type="time">. The native control renders
 * as 09:00 AM with separate hour, minute and AM/PM segments, which is fiddly
 * to change and ambiguous next to a 24 hour timezone field. The stored value
 * is unchanged: "HH:MM", 24 hour.
 */
const TIME_SLOTS = Array.from({ length: 48 }, (_, index) => {
  const hour = String(Math.floor(index / 2)).padStart(2, "0");
  const minute = index % 2 === 0 ? "00" : "30";
  return `${hour}:${minute}`;
});

export type ScheduleValue = {
  firstDayVolume: number;
  dailyIncrement: number;
  maxDailyLimit: number;
  sendWindowStart: string;
  sendWindowEnd: string;
  timezone: string;
  startDate: string;
};

const TIMEZONES = [
  "Europe/Athens",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Los_Angeles",
  "UTC",
];

export default function ScheduleForm({
  value,
  onChange,
}: {
  value: ScheduleValue;
  onChange: (next: ScheduleValue) => void;
}) {
  function patch(next: Partial<ScheduleValue>) {
    onChange({ ...value, ...next });
  }

  const quota = (day: number) =>
    quotaForDay(day, value.firstDayVolume, value.dailyIncrement, value.maxDailyLimit);

  const capDay =
    value.dailyIncrement > 0
      ? Math.max(1, Math.ceil((value.maxDailyLimit - value.firstDayVolume) / value.dailyIncrement) + 1)
      : 1;

  const curve = [1, 5, 10, 20, 30, 60].map((day) => ({ day, count: quota(day) }));
  const peak = Math.max(...curve.map((point) => point.count), 1);

  // The cron interval is the only pacing knob: one email per tick. To fill the
  // window rather than front-load it, the interval has to match peak volume.
  const windowMinutes = Math.max(
    0,
    minutesOfDay(value.sendWindowEnd) - minutesOfDay(value.sendWindowStart),
  );
  const suggestedInterval =
    value.maxDailyLimit > 0 ? Math.floor(windowMinutes / value.maxDailyLimit) : 0;

  return (
    <div className="grid max-w-4xl gap-5 lg:grid-cols-2">
      <div className="card space-y-5 p-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="lbl">First day</label>
            <input
              type="number"
              min={1}
              className="field"
              value={value.firstDayVolume}
              onChange={(e) => patch({ firstDayVolume: Number(e.target.value) })}
            />
          </div>
          <div>
            <label className="lbl">Add per day</label>
            <input
              type="number"
              min={0}
              className="field"
              value={value.dailyIncrement}
              onChange={(e) => patch({ dailyIncrement: Number(e.target.value) })}
            />
          </div>
          <div>
            <label className="lbl">Daily limit</label>
            <input
              type="number"
              min={1}
              className="field"
              value={value.maxDailyLimit}
              onChange={(e) => patch({ maxDailyLimit: Number(e.target.value) })}
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="lbl">Send from</label>
            <select
              className="field"
              value={value.sendWindowStart}
              onChange={(e) => patch({ sendWindowStart: e.target.value })}
            >
              {TIME_SLOTS.map((slot) => (
                <option key={slot} value={slot}>
                  {slot}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="lbl">Send until</label>
            <select
              className="field"
              value={value.sendWindowEnd}
              onChange={(e) => patch({ sendWindowEnd: e.target.value })}
            >
              {TIME_SLOTS.map((slot) => (
                <option key={slot} value={slot}>
                  {slot}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="lbl">Timezone</label>
            <select
              className="field"
              value={value.timezone}
              onChange={(e) => patch({ timezone: e.target.value })}
            >
              {TIMEZONES.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="lbl">Start date</label>
            <input
              type="date"
              className="field"
              value={value.startDate}
              onChange={(e) => patch({ startDate: e.target.value })}
            />
          </div>
        </div>
      </div>

      <div className="card p-6">
        <div className="lbl">What this means</div>
        <p className="text-sm leading-relaxed text-ink-300">
          Day 1 sends <span className="font-semibold text-ink-100">{quota(1)}</span> emails
          {value.dailyIncrement > 0 ? (
            <>
              , then <span className="font-semibold text-ink-100">+{value.dailyIncrement}</span> more each
              day until it caps at{" "}
              <span className="font-semibold text-ink-100">{value.maxDailyLimit}/day</span> on day{" "}
              <span className="font-semibold text-ink-100">{capDay}</span>.
            </>
          ) : (
            <> every day — no ramp.</>
          )}
        </p>
        <p className="mt-2 text-sm leading-relaxed text-ink-300">
          Sends happen between {value.sendWindowStart} and {value.sendWindowEnd} ({value.timezone}),{" "}
          <span className="font-semibold text-ink-100">one email per cron tick</span> — so the tick
          interval is what spaces them out.
        </p>
        {suggestedInterval > 0 && (
          <p className="mt-2 text-sm leading-relaxed text-ink-300">
            To spread {value.maxDailyLimit} emails evenly across the window, run the cron every{" "}
            <span className="font-semibold text-ink-100">~{suggestedInterval} minutes</span>. A faster
            tick isn&apos;t wrong — it just finishes the day&apos;s quota earlier and then idles.
          </p>
        )}

        <div className="mt-6 space-y-2">
          {curve.map(({ day, count }) => (
            <div key={day} className="flex items-center gap-3 text-xs">
              <span className="w-12 text-ink-400">Day {day}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink-800">
                <div
                  className="h-full rounded-full bg-brand-500"
                  style={{ width: `${(count / peak) * 100}%` }}
                />
              </div>
              <span className="w-8 text-right tabular-nums text-ink-300">{count}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
