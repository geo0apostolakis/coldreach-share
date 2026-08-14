#!/usr/bin/env node
/**
 * Creates the ColdReach pinger on cron-job.org and verifies it.
 *
 * Vercel Hobby fires a cron once a day and the engine sends one email per tick,
 * so without an external pinger the app sends 1 email/day whatever the ramp says.
 * This is the pinger.
 *
 * Usage: APP_URL=https://your-app.vercel.app CRONJOB_API_KEY=... node scripts/create-cron-job.mjs
 * Reads CRON_SECRET from .env.local. Idempotent: updates the job if it exists.
 */
import { readFileSync } from "node:fs";

const API = "https://api.cron-job.org";
const TITLE = "ColdReach tick";
const URL_ = process.env.APP_URL
  ? `${process.env.APP_URL.replace(/\/$/, "")}/api/cron/tick`
  : null;

const apiKey = process.env.CRONJOB_API_KEY;
if (!apiKey) {
  console.error("Set CRONJOB_API_KEY. Get it from cron-job.org > Settings > API.");
  process.exit(1);
}

if (!URL_) {
  console.error("Set APP_URL to your deployed app, e.g. https://your-app.vercel.app");
  process.exit(1);
}

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const secret = env.split("\n").find((l) => l.startsWith("CRON_SECRET="))?.slice("CRON_SECRET=".length).trim();
if (!secret) {
  console.error("No CRON_SECRET in .env.local");
  process.exit(1);
}

const call = async (path, init = {}) => {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} -> ${res.status} ${text}`);
  return text ? JSON.parse(text) : {};
};

// Europe/Athens, every 15 minutes, 09:00-17:00, weekdays only. The window is
// belt and braces: each campaign also enforces its own send window server-side.
const job = {
  url: URL_,
  enabled: true,
  saveResponses: true,
  title: TITLE,
  requestMethod: 0, // GET
  extendedData: { headers: { "x-cron-secret": secret } },
  schedule: {
    timezone: "Europe/Athens",
    hours: [9, 10, 11, 12, 13, 14, 15, 16],
    minutes: [0, 15, 30, 45],
    mdays: [-1],
    months: [-1],
    wdays: [1, 2, 3, 4, 5],
  },
};

const { jobs = [] } = await call("/jobs");
const existing = jobs.find((j) => j.title === TITLE || j.url === URL_);

let jobId;
if (existing) {
  await call(`/jobs/${existing.jobId}`, { method: "PATCH", body: JSON.stringify({ job }) });
  jobId = existing.jobId;
  console.log(`Updated existing job ${jobId}`);
} else {
  const created = await call("/jobs", { method: "PUT", body: JSON.stringify({ job }) });
  jobId = created.jobId;
  console.log(`Created job ${jobId}`);
}

const { jobDetails } = await call(`/jobs/${jobId}`);
console.log(
  `\nVerified on cron-job.org:\n` +
    `  title    ${jobDetails.title}\n` +
    `  url      ${jobDetails.url}\n` +
    `  enabled  ${jobDetails.enabled}\n` +
    `  tz       ${jobDetails.schedule.timezone}\n` +
    `  hours    ${jobDetails.schedule.hours.join(",")}\n` +
    `  minutes  ${jobDetails.schedule.minutes.join(",")}\n` +
    `  wdays    ${jobDetails.schedule.wdays.join(",")}\n` +
    `  header   x-cron-secret ${jobDetails.extendedData?.headers?.["x-cron-secret"] ? "set" : "MISSING"}\n`,
);
console.log("32 ticks per weekday. The ramp, not the pinger, decides how many actually send.");
