import { NextResponse } from "next/server";
import { checkApifyToken } from "@/lib/machine/apify";
import { totalSpend } from "@/lib/machine/runs";
import {
  COMPANIES_TAB,
  PEOPLE_TAB,
  QUALIFIED_TAB,
  ensureMachineTabs,
} from "@/lib/machine/schema";
import { CATEGORY_LISTS, TARGETS } from "@/lib/machine/targets";
import { readObjects } from "@/lib/sheets";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const spreadsheetId = await ensureMachineTabs();

    const listTabs = [...new Set(Object.values(CATEGORY_LISTS))];
    const [companies, people, ...lists] = await Promise.all([
      readObjects(spreadsheetId, COMPANIES_TAB),
      readObjects(spreadsheetId, PEOPLE_TAB),
      ...listTabs.map((tab) => readObjects(spreadsheetId, tab)),
    ]);

    const listCounts: Record<string, number> = {};
    listTabs.forEach((tab, index) => {
      listCounts[tab] = lists[index].rows.length;
    });

    const byCategory: Record<string, number> = {};
    let unclassified = 0;
    for (const row of companies.rows) {
      const category = row.values.category;
      if (!category) {
        unclassified += 1;
        continue;
      }
      byCategory[category] = (byCategory[category] ?? 0) + 1;
    }

    // A missing or spent token must not blank the whole page.
    let account = null;
    let accountError = "";
    try {
      account = await checkApifyToken();
    } catch (error) {
      accountError = error instanceof Error ? error.message : String(error);
    }

    return NextResponse.json({
      spreadsheetId,
      spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
      targets: TARGETS.map((target) => ({ id: target.id, label: target.label })),
      counts: {
        companies: companies.rows.length,
        qualified: listCounts[QUALIFIED_TAB] ?? 0,
        people: people.rows.length,
        unclassified,
        byCategory,
        lists: listCounts,
      },
      account,
      accountError,
      recordedSpendUsd: await totalSpend(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
