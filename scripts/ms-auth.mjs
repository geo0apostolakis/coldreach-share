#!/usr/bin/env node
/**
 * One-time Microsoft Graph consent flow.
 *
 * Prereq: an Azure app registration with delegated permissions
 * Mail.Send, offline_access, User.Read and the redirect URI
 * http://localhost:5599/callback registered as a "Web" platform.
 *
 * Usage:  MS_TENANT_ID=… MS_CLIENT_ID=… MS_CLIENT_SECRET=… node scripts/ms-auth.mjs
 * (or put those three in .env.local first)
 */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";

const PORT = 5599;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;
// Must match SCOPE in lib/outlook.ts exactly — a mismatch between the consent
// and the refresh grant is a classic source of AADSTS errors on the first send.
const SCOPE = "https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/Mail.Read offline_access User.Read";

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

const tenant = process.env.MS_TENANT_ID;
const clientId = process.env.MS_CLIENT_ID;
const clientSecret = process.env.MS_CLIENT_SECRET;

if (!tenant || !clientId || !clientSecret) {
  console.error("Set MS_TENANT_ID, MS_CLIENT_ID and MS_CLIENT_SECRET first.");
  process.exit(1);
}

const authUrl =
  `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize?` +
  new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    response_mode: "query",
    scope: SCOPE,
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
    res.end(`No code: ${url.searchParams.get("error_description") ?? "unknown error"}`);
    return;
  }

  const tokenRes = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      scope: SCOPE,
    }),
  });

  const data = await tokenRes.json();
  if (!tokenRes.ok) {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end(JSON.stringify(data, null, 2));
    console.error(data);
    server.close();
    return;
  }

  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end("<h2>Done — the refresh token is printed in your terminal. You can close this tab.</h2>");

  console.log("\nAdd this to .env.local and to Vercel:\n");
  console.log(`MS_REFRESH_TOKEN=${data.refresh_token}\n`);
  server.close();
  process.exit(0);
});

server.listen(PORT, () => {
  console.log("Open this URL in your browser and sign in with the sending mailbox:\n");
  console.log(authUrl);
  console.log("\nWaiting for the redirect…");
});
