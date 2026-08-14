#!/usr/bin/env node
/**
 * One-time Google consent flow — the "Sign in with Google" step.
 *
 * Prereq: an OAuth 2.0 Client ID of type "Web application" in Google Cloud,
 * with http://localhost:5600/callback registered as an authorised redirect URI,
 * and the Google Sheets + Google Drive APIs enabled on the project.
 *
 * Usage:  node scripts/google-auth.mjs
 * (reads GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET from .env.local)
 */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";

const PORT = 5600;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;
// Must match GOOGLE_SCOPES in lib/google.ts exactly. drive.file keeps the app
// non-sensitive, so it can go In production without Google verification —
// which is what stops refresh tokens expiring after 7 days.
const SCOPE = "https://www.googleapis.com/auth/drive.file";

function loadEnvLocal() {
  try {
    for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
      const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    // .env.local is optional when the vars are already exported.
  }
}

loadEnvLocal();

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.local first.");
  process.exit(1);
}

const authUrl =
  "https://accounts.google.com/o/oauth2/v2/auth?" +
  new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: SCOPE,
    // Both are required to get a refresh token back at all.
    access_type: "offline",
    prompt: "consent",
  });

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname !== "/callback") {
    res.writeHead(404).end();
    return;
  }

  const code = url.searchParams.get("code");
  if (!code) {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end(`No code: ${url.searchParams.get("error") ?? "unknown error"}`);
    return;
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
    }),
  });

  const data = await tokenRes.json();
  if (!tokenRes.ok || !data.refresh_token) {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end(JSON.stringify(data, null, 2));
    console.error(data);
    server.close();
    process.exit(1);
  }

  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end("<h2>Done — the refresh token is printed in your terminal. You can close this tab.</h2>");

  console.log("\nAdd this to .env.local and to Vercel:\n");
  console.log(`GOOGLE_REFRESH_TOKEN=${data.refresh_token}\n`);
  server.close();
  process.exit(0);
});

server.listen(PORT, () => {
  console.log("Open this URL and sign in with the Google account that owns your sheets:\n");
  console.log(authUrl);
  console.log("\nWaiting for the redirect…");
});
