import { NextResponse } from "next/server";
import { deleteCampaign, getCampaign, updateCampaign } from "@/lib/campaigns";
import { currentQuota } from "@/lib/engine";
import { loadLeads } from "@/lib/leads";
import { formatDateInTz } from "@/lib/time";
import type { Campaign } from "@/lib/types";

export const dynamic = "force-dynamic";

const EDITABLE: (keyof Campaign)[] = [
  "name",
  "status",
  "emailColumn",
  "statusColumn",
  "firstDayVolume",
  "dailyIncrement",
  "maxDailyLimit",
  "sendWindowStart",
  "sendWindowEnd",
  "timezone",
  "startDate",
  "config",
  "sentToday",
  "folderId",
  "mode",
  "sentValue",
];

export async function GET(_request: Request, ctx: RouteContext<"/api/campaigns/[id]">) {
  const { id } = await ctx.params;
  const campaign = await getCampaign(id);
  if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

  const today = formatDateInTz(new Date(), campaign.timezone);
  let leads = { total: 0, pending: 0, sent: 0, headers: [] as string[] };
  try {
    const snapshot = await loadLeads(campaign);
    leads = {
      total: snapshot.total,
      pending: snapshot.pending,
      sent: snapshot.sent,
      headers: snapshot.headers,
    };
  } catch {
    // Keep rendering even if the leads sheet is temporarily unreachable.
  }

  return NextResponse.json({
    campaign: {
      ...campaign,
      quota: currentQuota(campaign, today),
      sentToday: campaign.lastRunDate === today ? campaign.sentToday : 0,
      leads,
    },
  });
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/campaigns/[id]">) {
  const { id } = await ctx.params;
  const body = (await request.json()) as Partial<Campaign>;

  const patch: Partial<Campaign> = {};
  for (const key of EDITABLE) {
    if (key in body) (patch as Record<string, unknown>)[key] = body[key];
  }

  const updated = await updateCampaign(id, patch);
  if (!updated) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  return NextResponse.json({ campaign: updated });
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/campaigns/[id]">) {
  const { id } = await ctx.params;
  const removed = await deleteCampaign(id);
  if (!removed) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
