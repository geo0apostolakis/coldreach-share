# ColdReach

Cold email campaigns that run on Google Sheets. Sign in with Google, browse your Drive, pick a spreadsheet and a tab — or upload a CSV. ColdReach reads the header row and hands every column back as a `{{variable}}` you can drop into the subject, the body, or the AI prompts. Set the ramp, press **Start**.

Replaces the n8n workflow `Cold Email - Accounting Firms v2` — same behaviour, same sheets, but changing niche is a two-minute wizard instead of surgery on a workflow.

## How it works

- **Picking leads** goes through the Google Picker. ColdReach uses the `drive.file` scope, so it can only ever open the files you explicitly choose — the rest of your Drive stays invisible to it.
- **Each campaign gets its own tab**, named after the campaign, holding a copy of the rows you picked. Sending writes `Sending …` → `Sent` / `Error` there, so the tab you chose is never modified.
- **CSV uploads** become a new spreadsheet in your Drive (`ColdReach — <name>`), then behave like any other sheet.
- **Campaigns, logs and the tick lock** live in a separate control spreadsheet you own.
- **Sending** goes through Microsoft Graph (`/me/sendMail`) from your Outlook mailbox.
- **Personalisation** is OpenRouter — one AI sentence per lead, inserted as `{{ai_output}}`. Each campaign has its own editable **system prompt** (role, tone, hard rules) and **task prompt** (the per-lead instruction), plus **custom variables** you define once and reuse anywhere. A sheet column always wins a name collision with a custom variable.
- **Scheduling** is one email per cron tick — the tick interval *is* the gap between emails, which is why there are no separate pacing knobs. Pick the interval to match your volume: 30 emails across an 09:00–17:00 window wants a tick every ~16 minutes. A faster tick isn't wrong, it just finishes the day's quota early and then idles (a 5-minute tick sends all 30 by ~11:25). The campaign's Schedule tab computes the suggested interval for you.

Daily volume: `min(firstDayVolume + dailyIncrement × (day − 1), maxDailyLimit)`.

A lead is marked `Sending <timestamp>` **before** the mail API is called, so a tick that dies mid-send can never re-email the same person. A row is only picked up again when it is blank, or when its `Sending` marker is over 15 minutes old (meaning the tick that claimed it died).

Rows already marked `Sent` — including ones the old n8n workflow sent — are never re-contacted, so pointing a campaign at an in-progress sheet is safe.

## Setup

### 1. Google

1. [Google Cloud console](https://console.cloud.google.com) → new project → enable the **Google Sheets API**, **Google Drive API** and **Google Picker API**.
2. **OAuth consent screen** → External → add yourself as the only user. Scope: `.../auth/drive.file` only.
3. **Publish the app** (status *In production*). This is not optional: while the app sits in *Testing*, Google expires its refresh tokens after 7 days and the cron silently dies. `drive.file` is a non-sensitive scope, so publishing needs no Google verification.
4. **Credentials** → OAuth client ID → *Web application* → authorised redirect URI `http://localhost:5600/callback`. Copy the id and secret into `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
5. **Credentials** → API key → restrict it to the Picker API → `GOOGLE_API_KEY`.
   If you add an HTTP-referrer restriction it must list **both** `http://localhost:3005/*` and your Vercel domain, or the Picker won't initialise.
6. Copy the project **number** (Cloud console home page — not the project *id*) into `GOOGLE_PROJECT_NUMBER`. This one is required: without it the Picker can't attach the `drive.file` grant to your OAuth client, and every sheet you pick stays unreadable to the server.
7. Sign in and create the control spreadsheet:

   ```bash
   node scripts/google-auth.mjs   # prints GOOGLE_REFRESH_TOKEN
   node scripts/init-control.mjs  # prints CONTROL_SPREADSHEET_ID
   ```

**First thing to test:** open the campaign wizard, press *Browse my Google Drive*, pick a sheet. If its tabs load, the whole chain works — Picker grant → server token → Sheets read — and the cron will be able to write to it too. If they don't, it's almost always `GOOGLE_PROJECT_NUMBER` or an API-key referrer restriction.

> Use the same Google account throughout. The refresh token is what the cron authenticates with, so files must be picked by the account that produced it.

### 2. Outlook / Microsoft Graph

1. [Azure portal](https://portal.azure.com) → App registrations → New registration (single tenant).
2. Authentication → add a **Web** platform with redirect URI `http://localhost:5599/callback`.
3. API permissions → Microsoft Graph → **Delegated**: `Mail.Send`, `offline_access`, `User.Read`.
4. Certificates & secrets → new client secret.
5. Fill `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET` in `.env.local`, then run:

   ```bash
   node scripts/ms-auth.mjs
   ```

   Open the printed URL, sign in with the sending mailbox, and copy the `MS_REFRESH_TOKEN` it prints back into `.env.local`.

### 3. Everything else

```bash
cp .env.example .env.local   # fill it in
npm install
npm run dev
```

Generate the two secrets with `openssl rand -hex 32`.

### 4. Deploy

Push to GitHub, import the repo on Vercel, paste the same environment variables in.

### 5. Scheduler

`vercel.json` ships a once-daily cron as a safety net (Vercel Hobby only fires crons once a day). For real sending, create a job on [cron-job.org](https://cron-job.org):

- URL: `https://<your-app>.vercel.app/api/cron/tick`
- Interval: the one shown on the campaign's **Schedule** tab (~16 min for 30/day over 8 hours)
- Header: `x-cron-secret: <CRON_SECRET>`

On Vercel Pro you can instead put that interval into `vercel.json` and skip the external pinger.

### 6. Import the existing campaign

```bash
APP_PASSWORD=… node scripts/seed-accounting.mjs http://localhost:3000
```

Creates the `Accounting Firms` campaign as a **draft** with both Greek variants and the AI prompt copied from the n8n workflow. Preview it, send yourself a test, then press Start.

> ⚠️ Deactivate the n8n workflow before starting this campaign, or both engines will email the same leads.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Local dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run selftest` | Ramp maths, timezone handling, template rendering, lead-claim logic, CSV parsing, tab naming |
| `node scripts/google-auth.mjs` | One-time Google refresh token |
| `node scripts/init-control.mjs` | Create the control spreadsheet |
| `node scripts/ms-auth.mjs` | One-time Graph refresh token |
| `node scripts/seed-accounting.mjs` | Import the n8n campaign |

## Layout

```
app/(app)/          dashboard, campaign wizard + detail, logs, settings
app/api/            campaigns, sheets, preview, cron, health, auth
components/         SheetPicker, ComposeEditor, ScheduleForm, Sidebar, ui primitives
lib/                google · drive · sheets · csv · campaigns · leads · engine · outlook · ai · time
proxy.ts            password gate (Next 16 renamed middleware → proxy)
```
