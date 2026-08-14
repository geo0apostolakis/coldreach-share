import { randomUUID } from "node:crypto";
import { appendRows, readObjects } from "../sheets";
import { runActor } from "./apify";
import { COMPANIES_HEADERS, COMPANIES_TAB, ensureMachineTabs } from "./schema";
import { logRun } from "./runs";
import { getTarget } from "./targets";

const ACTOR = "harvestapi~linkedin-company-search";

/** Measured 2026-07-28: one page is 50 companies and costs about $0.10 in short mode. */
const PAGE_SIZE = 50;

/** Shape returned by the actor in short mode. Verified against a live run. */
type ApifyCompany = {
  id?: string;
  name?: string;
  universalName?: string;
  linkedinUrl?: string;
  industry?: string;
  summary?: string;
  followers?: number | string;
  location?: { linkedinText?: string } | string | null;
};

/** The actor returns location as a nested object, not a string. */
function flattenLocation(value: ApifyCompany["location"]): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  return value.linkedinText ?? "";
}

export type HarvestResult = {
  runId: string;
  fetched: number;
  added: number;
  skippedExisting: number;
  skippedDenylist: number;
  costUsd: number;
};

/**
 * Stage 1. Pulls companies from LinkedIn into the Companies tab.
 *
 * Keyed on companyUrl, so a re-run adds only what is new. Note this dedupes rows,
 * not spend: Apify bills per page fetched and we always start at page 1, so a
 * re-run pays for the same pages again. Real incrementality needs startPage
 * bookkeeping in the Runs tab, which is not worth it for a search that fits in
 * 13 pages.
 */
export async function harvest(
  targetId: string,
  options: { maxItems?: number } = {},
): Promise<HarvestResult> {
  const target = getTarget(targetId);
  const spreadsheetId = await ensureMachineTabs();
  const runId = randomUUID();
  const startedAt = new Date().toISOString();

  // LinkedIn caps a single search at 1000 results across 20 pages.
  const maxItems = Math.min(options.maxItems ?? 1000, 1000);

  try {
    const { rows } = await readObjects(spreadsheetId, COMPANIES_TAB);
    const seen = new Set(rows.map((row) => row.values.companyUrl).filter(Boolean));

    const { items, runId: apifyRunId, costUsd } = await runActor<ApifyCompany>(ACTOR, {
      searchQuery: target.company.searchQuery,
      locations: target.company.locations,
      industryIds: target.company.industryIds,
      companySize: target.company.companySize,
      scraperMode: "short",
      maxItems,
      takePages: Math.ceil(maxItems / PAGE_SIZE),
    });

    const denylist = target.denylist.map((entry) => entry.toLowerCase());
    const harvestedAt = new Date().toISOString();

    let skippedExisting = 0;
    let skippedDenylist = 0;
    const fresh: string[][] = [];

    for (const item of items) {
      const companyUrl = item.linkedinUrl ?? "";
      if (!companyUrl) continue;

      if (seen.has(companyUrl)) {
        skippedExisting += 1;
        continue;
      }

      const name = item.name ?? "";
      // The actor has no NOT operator, so LinkedIn Boolean exclusions land here.
      if (denylist.some((entry) => name.toLowerCase().includes(entry))) {
        skippedDenylist += 1;
        continue;
      }

      seen.add(companyUrl);

      const row: Record<(typeof COMPANIES_HEADERS)[number], string> = {
        companyUrl,
        name,
        summary: item.summary ?? "",
        industry: item.industry ?? "",
        location: flattenLocation(item.location),
        followers: String(item.followers ?? ""),
        universalName: item.universalName ?? "",
        category: "",
        reason: "",
        confidence: "",
        peopleStatus: "",
        harvestedAt,
        qualifiedAt: "",
      };
      fresh.push(COMPANIES_HEADERS.map((header) => row[header]));
    }

    await appendRows(spreadsheetId, COMPANIES_TAB, fresh);

    await logRun({
      runId,
      targetId,
      stage: "harvest",
      startedAt,
      itemsIn: items.length,
      itemsOut: fresh.length,
      apifyRunId,
      costUsd,
    });

    return {
      runId,
      fetched: items.length,
      added: fresh.length,
      skippedExisting,
      skippedDenylist,
      costUsd,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logRun({ runId, targetId, stage: "harvest", startedAt, error: message });
    throw error;
  }
}
