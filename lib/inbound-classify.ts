/**
 * Pure inbound-mail logic — bounce detection, address extraction, lead
 * matching. Import-free on purpose so the self-test can load it directly.
 */

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

/** Every distinct, lowercased email address found anywhere in the text. */
export function extractEmails(text: string): string[] {
  const found = new Set<string>();
  for (const match of (text || "").matchAll(EMAIL_RE)) {
    found.add(match[0].toLowerCase());
  }
  return [...found];
}

export function normalizeEmail(email: string): string {
  return (email || "").trim().toLowerCase();
}

// Senders that only ever send delivery failures, and subject fragments Outlook
// and other mail servers use for non-delivery reports (English + Greek).
const BOUNCE_SENDER_RE = /postmaster|mailer-daemon|mail delivery (subsystem|system)|microsoft outlook/i;
const BOUNCE_SUBJECT_RE =
  /undeliverable|delivery status notification|delivery has failed|mail delivery failed|could not be delivered|returned mail|failure notice|delivery incomplete|Δεν παραδόθηκε/i;

/**
 * True when a message is a bounce / non-delivery report rather than a human
 * reply, based on who sent it and what the subject says.
 */
export function isBounce(input: { fromAddress?: string; fromName?: string; subject?: string }): boolean {
  const sender = `${input.fromName ?? ""} ${input.fromAddress ?? ""}`;
  if (BOUNCE_SENDER_RE.test(sender)) return true;
  return BOUNCE_SUBJECT_RE.test(input.subject ?? "");
}

export type InboundKind = "bounce" | "reply";

/**
 * Given a message and a set of known lead addresses, decides whether it maps to
 * a lead and how. `candidateEmails` should be every address on the message
 * (from, to, and any pulled out of the subject/body). Returns the matched lead
 * address (lowercased) and the kind, or null if no lead is involved.
 *
 * A message from a bounce sender that also contains the lead address is a
 * bounce; anything else that carries a lead address is treated as a reply.
 */
export function matchInbound(
  message: { fromAddress?: string; fromName?: string; subject?: string; candidateEmails: string[] },
  leadEmails: Set<string>,
  mailboxAddress?: string,
): { email: string; kind: InboundKind } | null {
  const self = normalizeEmail(mailboxAddress ?? "");
  const bounce = isBounce(message);
  for (const raw of message.candidateEmails) {
    const email = normalizeEmail(raw);
    if (!email || email === self) continue;
    if (leadEmails.has(email)) {
      return { email, kind: bounce ? "bounce" : "reply" };
    }
  }
  return null;
}
