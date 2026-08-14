import { google, type sheets_v4, type drive_v3 } from "googleapis";

/**
 * drive.file is deliberately the only scope.
 *
 * It grants access to files the user picks through the Google Picker plus any
 * file this app creates — which is everything ColdReach needs — and unlike
 * `spreadsheets` or `drive.readonly` it is a non-sensitive scope, so the OAuth
 * app never needs Google verification to leave Testing mode. That matters:
 * refresh tokens issued by an app in Testing die after 7 days, which would
 * silently kill the cron.
 */
export const GOOGLE_SCOPES = ["https://www.googleapis.com/auth/drive.file"];

type Clients = { sheets: sheets_v4.Sheets; drive: drive_v3.Drive };
let cached: Clients | null = null;

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export function controlSpreadsheetId(): string {
  return env("CONTROL_SPREADSHEET_ID");
}

/**
 * Delegated access using the long-lived refresh token produced once by
 * scripts/google-auth.mjs. The googleapis client refreshes the access token on
 * demand, so nothing here expires as long as the OAuth app is In production.
 */
export function oauthClient() {
  const client = new google.auth.OAuth2({
    clientId: env("GOOGLE_CLIENT_ID"),
    clientSecret: env("GOOGLE_CLIENT_SECRET"),
  });
  client.setCredentials({ refresh_token: env("GOOGLE_REFRESH_TOKEN") });
  return client;
}

function clients(): Clients {
  if (cached) return cached;
  const auth = oauthClient();
  cached = {
    sheets: google.sheets({ version: "v4", auth }),
    drive: google.drive({ version: "v3", auth }),
  };
  return cached;
}

export function sheetsClient(): sheets_v4.Sheets {
  return clients().sheets;
}

export function driveClient(): drive_v3.Drive {
  return clients().drive;
}

/**
 * A short-lived access token for the browser, so the Google Picker can run as
 * the same account the server uses. Never hand the refresh token to the client.
 */
export async function browserAccessToken(): Promise<string> {
  const { token } = await oauthClient().getAccessToken();
  if (!token) throw new Error("Could not mint a Google access token");
  return token;
}

/** Accepts a full Google Sheets URL or a bare spreadsheet ID. */
export function extractSpreadsheetId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match) return match[1];
  if (/^[a-zA-Z0-9-_]{20,}$/.test(trimmed)) return trimmed;
  return null;
}

export function isPermissionError(error: unknown): boolean {
  const status = (error as { code?: number; status?: number })?.code ?? (error as { status?: number })?.status;
  return status === 403 || status === 404;
}
