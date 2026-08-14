/**
 * Tab-name helpers. Import-free on purpose so the self-test can load them
 * without pulling in the Google client chain.
 */

/** Turns "Accounting Firms Q3" into a tab name Sheets will accept. */
export function safeTabName(name: string): string {
  const cleaned = name.replace(/[:\\/?*[\]]/g, " ").replace(/\s+/g, " ").trim();
  return (cleaned || "Leads").slice(0, 90);
}

/** Appends " 2", " 3", … until the name is free inside the spreadsheet. */
export function uniqueTabName(existing: string[], desired: string): string {
  if (!existing.includes(desired)) return desired;
  for (let suffix = 2; suffix < 100; suffix += 1) {
    const candidate = `${desired} ${suffix}`;
    if (!existing.includes(candidate)) return candidate;
  }
  return `${desired} ${Date.now()}`;
}
