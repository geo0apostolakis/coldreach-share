import { randomUUID } from "node:crypto";
import { generateText } from "../ai";
import { DEFAULT_MODEL } from "../types";
import { a1, appendRows, batchWriteRanges, readObjects } from "../sheets";
import { COMPANIES_TAB, LIST_HEADERS, QUALIFIED_TAB, ensureMachineTabs } from "./schema";
import { logRun } from "./runs";
import { CATEGORY_LISTS, getTarget, type CompanyCategory } from "./targets";

/** Small enough that one bad row cannot poison a large batch, big enough to cut overhead. */
const BATCH_SIZE = 20;

const CATEGORIES: CompanyCategory[] = [
  "firm",
  "association",
  "network",
  "vendor",
  "service",
  "unsure",
];

const SYSTEM_PROMPT = `You classify companies found in a LinkedIn industry search.
You return only JSON. No prose, no markdown fence, no commentary.`;

/**
 * The classifier routes, it does not gate. "association" is a deliberate keeper:
 * a Σύλλογος Λογιστών is not a client but it is a room full of them, which is a
 * channel worth its own list.
 */
function buildPrompt(targetPrompt: string, batch: { name: string; summary: string; industry: string; location: string }[]): string {
  const list = batch
    .map((company, index) => {
      const parts = [
        `${index + 1}.`,
        `name: ${company.name || "(none)"}`,
        `summary: ${company.summary || "(none)"}`,
        `industry: ${company.industry || "(none)"}`,
        `location: ${company.location || "(none)"}`,
      ];
      return parts.join("\n   ");
    })
    .join("\n\n");

  return `${targetPrompt}

Classify each company below into exactly one category:

- "firm": actually sells accounting or tax services to businesses. The target.
- "association": professional body, syllogos, chamber, union, institute, or
  regulator. Not a client, but a group of the people we want, so it is kept.
- "network": member or affiliate of an international accounting network or a Big
  Four firm.
- "vendor": sells software, SaaS, or fintech products, including products aimed
  at accountants.
- "service": recruiter, training provider, academy, consultancy that is not
  accounting, media, or community.
- "unsure": genuinely not enough information to decide.

Rules:
- Text arrives in Greek, English, or both. Judge both equally.
- An empty or missing summary means "unsure". It never means a rejection.
- Judge what the company sells and to whom, not what its name resembles.
- Use a category string exactly as written above. Never invent a synonym.
- confidence is 0 to 1, one decimal place.
- reason is at most 12 words, in English.

Companies:

${list}

Return a JSON array of exactly ${batch.length} objects, in the same order:
[{"n":1,"category":"firm","reason":"...","confidence":0.9}]`;
}

type Verdict = { n: number; category: string; reason: string; confidence: number };

function parseVerdicts(raw: string, expected: number): Verdict[] {
  // Models sometimes fence JSON despite instructions.
  const cleaned = raw.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start === -1 || end === -1) throw new Error("Classifier returned no JSON array");

  const parsed = JSON.parse(cleaned.slice(start, end + 1)) as Verdict[];
  if (!Array.isArray(parsed) || parsed.length !== expected) {
    throw new Error(`Classifier returned ${parsed?.length ?? 0} verdicts, expected ${expected}`);
  }
  return parsed;
}

function normalise(category: string): CompanyCategory {
  const value = (category ?? "").trim().toLowerCase();
  return (CATEGORIES as string[]).includes(value) ? (value as CompanyCategory) : "unsure";
}

export type QualifyResult = {
  runId: string;
  classified: number;
  qualified: number;
  /** Rows appended per list tab this run, keyed by tab name. */
  addedToLists: Record<string, number>;
  byCategory: Record<string, number>;
  failedBatches: number;
};

/**
 * Stage 2. Classifies every Companies row that has no category yet, stamps the
 * verdict back, and copies the qualifying subset into the Qualified tab.
 *
 * Nothing is ever deleted. Qualified is a copy, so the raw harvest stays intact
 * and a prompt change can be re-run over the same data.
 */
export async function qualify(
  targetId: string,
  options: { model?: string; limit?: number; recategorise?: CompanyCategory[] } = {},
): Promise<QualifyResult> {
  const target = getTarget(targetId);
  const spreadsheetId = await ensureMachineTabs();
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  const model = options.model || DEFAULT_MODEL;

  try {
    const { rows } = await readObjects(spreadsheetId, COMPANIES_TAB);

    /**
     * Without this, a row stamped "unsure" is stranded forever: it has a
     * category so it is never picked up again, and harvest skips it as already
     * seen. Passing recategorise lets a better prompt or model take another pass
     * over exactly those rows.
     */
    /**
     * A category that owns a list tab can never be re-rolled. Rows are copied into
     * lists and never deleted from them, so re-classifying "firm" would leave the
     * Qualified tab disagreeing with Companies. Measured: re-running 37 settled
     * rows moved 3 of them, purely because the model is not deterministic on
     * companies with no description.
     */
    const requested = options.recategorise ?? [];
    const blocked = requested.filter((category) => CATEGORY_LISTS[category]);
    if (blocked.length) {
      throw new Error(
        `Cannot re-classify ${blocked.join(", ")}: those already have a working list. Only unsettled categories can be re-run.`,
      );
    }
    const recategorise = new Set<string>(requested);
    const pending = rows
      .filter((row) => {
        if (!row.values.companyUrl) return false;
        const category = row.values.category;
        return category ? recategorise.has(category) : true;
      })
      .slice(0, options.limit ?? Number.MAX_SAFE_INTEGER);

    // One dedupe set and one pending-append buffer per list tab, so a re-run
    // never double-adds a company to a list it already sits in.
    const listTabs = [...new Set(Object.values(CATEGORY_LISTS))];
    const existing = new Map<string, Set<string>>();
    const pendingAppends = new Map<string, string[][]>();
    for (const tab of listTabs) {
      const { rows: listRows } = await readObjects(spreadsheetId, tab);
      existing.set(tab, new Set(listRows.map((row) => row.values.companyUrl).filter(Boolean)));
      pendingAppends.set(tab, []);
    }

    const byCategory: Record<string, number> = {};
    const updates: { range: string; values: string[][] }[] = [];
    const stampedAt = new Date().toISOString();
    let failedBatches = 0;
    let classified = 0;
    let aiCostUsd = 0;

    for (let i = 0; i < pending.length; i += BATCH_SIZE) {
      const batch = pending.slice(i, i + BATCH_SIZE);
      const payload = batch.map((row) => ({
        name: row.values.name ?? "",
        summary: row.values.summary ?? "",
        industry: row.values.industry ?? "",
        location: row.values.location ?? "",
      }));

      let verdicts: Verdict[];
      try {
        const generation = await generateText(
          buildPrompt(target.qualifyPrompt, payload),
          model,
          SYSTEM_PROMPT,
        );
        aiCostUsd += generation.costUsd;
        verdicts = parseVerdicts(generation.text, batch.length);
      } catch {
        // A malformed batch is left unclassified rather than guessed at, so a
        // re-run picks it up untouched.
        failedBatches += 1;
        continue;
      }

      batch.forEach((row, index) => {
        const verdict = verdicts[index];
        const category = normalise(verdict?.category ?? "");
        const reason = String(verdict?.reason ?? "").slice(0, 120);
        const confidence = String(verdict?.confidence ?? "");

        byCategory[category] = (byCategory[category] ?? 0) + 1;
        classified += 1;

        // Columns H to M: category, reason, confidence, peopleStatus, harvestedAt, qualifiedAt.
        updates.push({
          range: a1(COMPANIES_TAB, `H${row.rowNumber}:M${row.rowNumber}`),
          values: [
            [
              category,
              reason,
              confidence,
              row.values.peopleStatus ?? "",
              row.values.harvestedAt ?? "",
              stampedAt,
            ],
          ],
        });

        const companyUrl = row.values.companyUrl;
        const listTab = CATEGORY_LISTS[category];
        if (listTab && !existing.get(listTab)?.has(companyUrl)) {
          existing.get(listTab)?.add(companyUrl);
          const listRow: Record<(typeof LIST_HEADERS)[number], string> = {
            companyUrl,
            name: row.values.name ?? "",
            summary: row.values.summary ?? "",
            industry: row.values.industry ?? "",
            location: row.values.location ?? "",
            category,
            confidence,
            peopleStatus: "",
            addedAt: stampedAt,
          };
          pendingAppends.get(listTab)?.push(LIST_HEADERS.map((header) => listRow[header]));
        }
      });
    }

    await batchWriteRanges(spreadsheetId, updates);

    const addedToLists: Record<string, number> = {};
    for (const [tab, rowsToAppend] of pendingAppends) {
      await appendRows(spreadsheetId, tab, rowsToAppend);
      if (rowsToAppend.length) addedToLists[tab] = rowsToAppend.length;
    }
    const qualified = addedToLists[QUALIFIED_TAB] ?? 0;

    await logRun({
      runId,
      targetId,
      stage: "qualify",
      startedAt,
      itemsIn: pending.length,
      itemsOut: qualified,
      aiCostUsd: Number(aiCostUsd.toFixed(6)),
    });

    return { runId, classified, qualified, addedToLists, byCategory, failedBatches };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logRun({ runId, targetId, stage: "qualify", startedAt, error: message });
    throw error;
  }
}
