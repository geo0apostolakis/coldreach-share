import { NextResponse } from "next/server";
import { createCampaign, listCampaigns } from "@/lib/campaigns";
import { loadLeads } from "@/lib/leads";
import { currentQuota } from "@/lib/engine";
import { formatDateInTz } from "@/lib/time";
import { addColumn, readHeaders } from "@/lib/sheets";
import { createWorkingTab } from "@/lib/drive";
import { LEAD_STATUS_SENT, emptyConfig, type Campaign } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const campaigns = await listCampaigns();
    const enriched = await Promise.all(
      campaigns.map(async (campaign) => {
        const today = formatDateInTz(new Date(), campaign.timezone);
        let leads = { total: 0, pending: 0, sent: 0 };
        try {
          const snapshot = await loadLeads(campaign);
          leads = { total: snapshot.total, pending: snapshot.pending, sent: snapshot.sent };
        } catch {
          // A campaign pointing at a sheet that lost access should still render.
        }
        return {
          ...campaign,
          quota: currentQuota(campaign, today),
          sentToday: campaign.lastRunDate === today ? campaign.sentToday : 0,
          leads,
        };
      }),
    );
    return NextResponse.json({ campaigns: enriched });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load campaigns" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<Campaign> & {
      createStatusColumn?: boolean;
      createWorkingTab?: boolean;
    };

    if (!body.name?.trim()) {
      return NextResponse.json({ error: "Campaign name is required" }, { status: 400 });
    }
    if (!body.leadsSpreadsheetId || !body.leadsSheetName) {
      return NextResponse.json({ error: "Pick a spreadsheet and a tab first" }, { status: 400 });
    }
    if (!body.emailColumn || !body.statusColumn) {
      return NextResponse.json({ error: "Pick an email column and a status column" }, { status: 400 });
    }

    // The campaign gets its own tab, named after itself, holding a copy of the
    // chosen rows — so sending never writes into the tab the user picked.
    // Opting out keeps the old in-place behaviour.
    let sheetName = body.leadsSheetName;
    let statusColumn = body.statusColumn;
    if (body.createWorkingTab !== false) {
      const working = await createWorkingTab(
        body.leadsSpreadsheetId,
        body.leadsSheetName,
        body.name.trim(),
        body.statusColumn,
        body.emailColumn,
      );
      sheetName = working.tab;
      statusColumn = working.statusColumn;
    } else {
      // A brand-new status column has to exist in the sheet before the engine writes to it.
      const headers = await readHeaders(body.leadsSpreadsheetId, sheetName);
      if (!headers.includes(statusColumn)) {
        await addColumn(body.leadsSpreadsheetId, sheetName, statusColumn);
      }
    }

    const today = formatDateInTz(new Date(), body.timezone || "Europe/Athens");
    const campaign = await createCampaign({
      name: body.name.trim(),
      status: body.status === "running" ? "running" : "draft",
      leadsSpreadsheetId: body.leadsSpreadsheetId,
      leadsSpreadsheetName: body.leadsSpreadsheetName ?? "",
      leadsSheetName: sheetName,
      emailColumn: body.emailColumn,
      statusColumn,
      firstDayVolume: Number(body.firstDayVolume) || 5,
      dailyIncrement: Number(body.dailyIncrement) || 0,
      maxDailyLimit: Number(body.maxDailyLimit) || 30,
      sendWindowStart: body.sendWindowStart || "09:00",
      sendWindowEnd: body.sendWindowEnd || "17:00",
      timezone: body.timezone || "Europe/Athens",
      startDate: body.startDate || today,
      config: body.config ?? emptyConfig(),
      folderId: body.folderId ?? "",
      mode: body.mode === "test" ? "test" : "production",
      sentValue: body.sentValue?.trim() || LEAD_STATUS_SENT,
    });

    return NextResponse.json({ campaign });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create campaign" },
      { status: 500 },
    );
  }
}
