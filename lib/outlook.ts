import { textToHtml } from "./template";

type TokenCache = { token: string; expiresAt: number };
let cache: TokenCache | null = null;

// Must match SCOPE in scripts/ms-auth.mjs exactly. Mail.Read lets the inbound
// processor read bounces and replies back out of the mailbox.
const SCOPE = "https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/Mail.Read offline_access User.Read";

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/**
 * Delegated Graph access using the one-time refresh token produced by
 * scripts/ms-auth.mjs. Access tokens live ~1h and are cached in module memory.
 */
export async function getAccessToken(): Promise<string> {
  if (cache && cache.expiresAt > Date.now() + 60_000) return cache.token;

  const params = new URLSearchParams({
    client_id: env("MS_CLIENT_ID"),
    client_secret: env("MS_CLIENT_SECRET"),
    grant_type: "refresh_token",
    refresh_token: env("MS_REFRESH_TOKEN"),
    scope: SCOPE,
  });

  const res = await fetch(
    `https://login.microsoftonline.com/${env("MS_TENANT_ID")}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    },
  );

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Microsoft token refresh failed (${res.status}): ${detail.slice(0, 300)}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  cache = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

// Delegated Graph sends always come from the signed-in mailbox, so there is no
// "from name" knob here — only Reply-To can be overridden.
export type SendInput = {
  /** One address, or several when a sheet cell lists more than one. */
  to: string | string[];
  subject: string;
  body: string;
  replyTo?: string;
  /** Alias to send as. Empty means the signed-in mailbox. */
  from?: string;
};

export async function sendMail(input: SendInput): Promise<void> {
  const token = await getAccessToken();
  const recipients = (Array.isArray(input.to) ? input.to : [input.to])
    .map((address) => address.trim())
    .filter(Boolean);
  if (recipients.length === 0) throw new Error("sendMail called with no recipient");

  const message: Record<string, unknown> = {
    subject: input.subject,
    body: { contentType: "HTML", content: textToHtml(input.body) },
    toRecipients: recipients.map((address) => ({ emailAddress: { address } })),
  };
  if (input.replyTo) {
    message.replyTo = [{ emailAddress: { address: input.replyTo } }];
  }
  // Sending as an alias of the same mailbox. Exchange Online allows this when
  // SendFromAliasEnabled is on, or when the mailbox holds SendAs rights for the
  // address. Left unset, Graph uses the signed-in mailbox.
  if (input.from) {
    message.from = { emailAddress: { address: input.from } };
  }

  const res = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message, saveToSentItems: true }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Graph sendMail failed (${res.status}): ${detail.slice(0, 300)}`);
  }
}

export type InboxMessage = {
  id: string;
  subject: string;
  fromAddress: string;
  fromName: string;
  toAddresses: string[];
  body: string;
  receivedDateTime: string;
};

let cachedMailbox = "";

/**
 * The signed-in mailbox's address, resolved once per instance. Used to label
 * sends in the Email Log when a campaign has not overridden the sender.
 */
export async function defaultSender(): Promise<string> {
  if (cachedMailbox) return cachedMailbox;
  cachedMailbox = await getMailboxAddress().catch(() => "");
  return cachedMailbox;
}

/** The signed-in mailbox's own address, so it can be excluded from lead matching. */
export async function getMailboxAddress(): Promise<string> {
  const token = await getAccessToken();
  const res = await fetch("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return "";
  const me = (await res.json()) as { mail?: string; userPrincipalName?: string };
  return me.mail ?? me.userPrincipalName ?? "";
}

/**
 * Inbox messages received strictly after `sinceIso`, oldest first. Pulls the
 * full body so the failed address inside a bounce report can be extracted.
 */
export async function listInboxSince(sinceIso: string, limit = 50): Promise<InboxMessage[]> {
  const token = await getAccessToken();
  const params = new URLSearchParams({
    $filter: `receivedDateTime gt ${sinceIso}`,
    $orderby: "receivedDateTime asc",
    $top: String(limit),
    $select: "id,subject,from,toRecipients,receivedDateTime,body",
  });
  const res = await fetch(`https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Graph inbox read failed (${res.status}): ${detail.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    value?: {
      id: string;
      subject?: string;
      from?: { emailAddress?: { address?: string; name?: string } };
      toRecipients?: { emailAddress?: { address?: string } }[];
      body?: { content?: string };
      receivedDateTime?: string;
    }[];
  };
  return (data.value ?? []).map((m) => ({
    id: m.id,
    subject: m.subject ?? "",
    fromAddress: m.from?.emailAddress?.address ?? "",
    fromName: m.from?.emailAddress?.name ?? "",
    toAddresses: (m.toRecipients ?? []).map((r) => r.emailAddress?.address ?? "").filter(Boolean),
    body: m.body?.content ?? "",
    receivedDateTime: m.receivedDateTime ?? "",
  }));
}

export async function checkGraph(): Promise<{ ok: boolean; detail: string }> {
  try {
    const token = await getAccessToken();
    const res = await fetch("https://graph.microsoft.com/v1.0/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    const me = (await res.json()) as { userPrincipalName?: string; mail?: string };
    return { ok: true, detail: me.mail ?? me.userPrincipalName ?? "connected" };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}
