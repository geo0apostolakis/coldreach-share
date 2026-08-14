#!/usr/bin/env node
/**
 * Creates the ColdReach control spreadsheet in your own Drive and prints its id.
 *
 * Run this after scripts/google-auth.mjs. Because ColdReach signs in as you (not
 * as a service account) it has real Drive storage, so it can create the file
 * itself — no manual sharing step.
 */
import { readFileSync } from "node:fs";
import { google } from "googleapis";

function loadEnvLocal() {
  try {
    for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
      const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    // Optional when the vars are already exported.
  }
}

loadEnvLocal();

const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = process.env;
if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
  console.error("Run scripts/google-auth.mjs first — GOOGLE_REFRESH_TOKEN is missing.");
  process.exit(1);
}

const auth = new google.auth.OAuth2({
  clientId: GOOGLE_CLIENT_ID,
  clientSecret: GOOGLE_CLIENT_SECRET,
});
auth.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });

const sheets = google.sheets({ version: "v4", auth });

// Same tabs and headers as lib/control.ts.
const TABS = {
  Campaigns: [
    "id", "name", "status", "leadsSpreadsheetId", "leadsSpreadsheetName", "leadsSheetName",
    "emailColumn", "statusColumn", "firstDayVolume", "dailyIncrement", "maxDailyLimit",
    "sendWindowStart", "sendWindowEnd", "timezone", "startDate", "currentDay", "sentToday",
    "lastRunDate", "totalSent", "lastError", "createdAt", "updatedAt", "config",
  ],
  "Email Log": [
    "timestamp", "campaignId", "campaignName", "leadRow", "email", "name", "company",
    "variant", "subject", "body", "status", "messageId", "error",
  ],
  Runtime: ["key", "value"],
};

const created = await sheets.spreadsheets.create({
  requestBody: {
    properties: { title: "ColdReach Control" },
    sheets: Object.keys(TABS).map((title) => ({ properties: { title } })),
  },
  fields: "spreadsheetId",
});

const spreadsheetId = created.data.spreadsheetId;

await sheets.spreadsheets.values.batchUpdate({
  spreadsheetId,
  requestBody: {
    valueInputOption: "RAW",
    data: Object.entries(TABS).map(([title, headers]) => ({
      range: `'${title}'!A1`,
      values: [headers],
    })),
  },
});

console.log("\nControl spreadsheet created:");
console.log(`https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit\n`);
console.log("Add this to .env.local and to Vercel:\n");
console.log(`CONTROL_SPREADSHEET_ID=${spreadsheetId}\n`);
