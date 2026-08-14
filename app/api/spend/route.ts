import { NextResponse } from "next/server";
import { DERIVED_APIFY_CATEGORY, addSpend, listSpend, spendSummary } from "@/lib/spend";
import { listCampaigns } from "@/lib/campaigns";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const folderId = url.searchParams.get("folderId") ?? undefined;
    // AI cost lives on campaigns, not on spend rows, so a folder view needs the
    // ids of the campaigns in it or it would report zero.
    const campaignIds = folderId
      ? new Set(
          (await listCampaigns())
            .filter((campaign) => campaign.folderId === folderId)
            .map((campaign) => campaign.id),
        )
      : undefined;
    const filter = {
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
      folderId,
      campaignIds,
    };
    // The strip in the app shell only needs the totals, and it renders on
    // every navigation.
    if (url.searchParams.get("summary") === "1") {
      return NextResponse.json({ summary: await spendSummary(filter) });
    }
    const [entries, summary] = await Promise.all([listSpend(filter), spendSummary(filter)]);
    return NextResponse.json({ entries, summary });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load spend" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      date?: string;
      vendor?: string;
      category?: string;
      amountUsd?: number | string;
      folderId?: string;
      campaignId?: string;
      note?: string;
    };

    const vendor = (body.vendor ?? "").trim();
    if (!vendor) return NextResponse.json({ error: "Vendor is required" }, { status: 400 });

    const amount = Number(body.amountUsd);
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: "Enter an amount above zero" }, { status: 400 });
    }

    // Apify usage and AI spend are derived from the Runs tab and the Email Log.
    // Letting them be typed in as well would count them twice. The Apify plan
    // fee is a different thing and is allowed, which is why only the usage
    // category is blocked rather than the whole vendor.
    const category = (body.category ?? "").trim().toLowerCase();
    if (vendor.toLowerCase() === "apify" && category === DERIVED_APIFY_CATEGORY) {
      return NextResponse.json(
        {
          error:
            "Apify usage is recorded automatically from each run. Log the plan fee as category 'subscription' instead.",
        },
        { status: 400 },
      );
    }
    if (["ai", "openrouter"].includes(vendor.toLowerCase())) {
      return NextResponse.json(
        { error: "AI spend is recorded automatically per generation. Nothing to add by hand." },
        { status: 400 },
      );
    }

    const entry = await addSpend({ ...body, vendor, amountUsd: amount });
    return NextResponse.json({ entry });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save spend" },
      { status: 500 },
    );
  }
}
