/**
 * A single sheet cell can hold several addresses: "a@x.com, b@x.com" is common
 * when a firm lists a general inbox and a partner. Everything downstream has to
 * treat that cell as a list, not a string, or Graph is handed one malformed
 * address and the whole row fails.
 *
 * Dependency-free so the self-test can import it directly.
 */

const SPLIT_RE = /[,;\n]+/;
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

/**
 * Every address in a cell, trimmed, lowercased and de-duplicated, in the order
 * written. Anything that is not shaped like an address is dropped rather than
 * passed to the mail API, where it would fail the whole send.
 */
export function parseRecipients(cell: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of (cell || "").split(SPLIT_RE)) {
    // Tolerates "Name <a@x.com>", which some exports produce.
    const angled = part.match(/<([^>]+)>/);
    const candidate = (angled ? angled[1] : part).trim().toLowerCase();
    if (!candidate || !EMAIL_RE.test(candidate) || seen.has(candidate)) continue;
    seen.add(candidate);
    out.push(candidate);
  }
  return out;
}

/** True when the cell holds at least one usable address. */
export function hasRecipient(cell: string): boolean {
  return parseRecipients(cell).length > 0;
}

/** How the row is shown in logs and the UI: every address, comma separated. */
export function formatRecipients(cell: string): string {
  return parseRecipients(cell).join(", ");
}
