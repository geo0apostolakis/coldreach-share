import { NextResponse } from "next/server";
import { addOutcome, listOutcomes, type OutcomeInput } from "@/lib/outcomes";
import { getCampaign } from "@/lib/campaigns";
import { OUTCOME_TYPES, type OutcomeType } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const outcomes = await listOutcomes({
      campaignId: url.searchParams.get("campaignId") ?? undefined,
      folderId: url.searchParams.get("folderId") ?? undefined,
    });
    return NextResponse.json({ outcomes });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load outcomes" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<OutcomeInput>;
    if (!body.campaignId) {
      return NextResponse.json({ error: "campaignId is required" }, { status: 400 });
    }
    if (!body.leadEmail?.trim()) {
      return NextResponse.json({ error: "Pick a lead first" }, { status: 400 });
    }
    if (!body.type || !OUTCOME_TYPES.includes(body.type as OutcomeType)) {
      return NextResponse.json({ error: "Unknown outcome type" }, { status: 400 });
    }
    if (body.type === "closed" && body.dealType !== "oneoff" && body.dealType !== "recurring") {
      return NextResponse.json(
        { error: "A closed deal must be one-off or recurring" },
        { status: 400 },
      );
    }

    // The folder is taken from the campaign rather than the client, so a
    // campaign moved between folders cannot leave its outcomes behind.
    const campaign = await getCampaign(body.campaignId);
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

    const outcome = await addOutcome({
      ...(body as OutcomeInput),
      leadEmail: body.leadEmail.trim(),
      folderId: campaign.folderId,
    });
    return NextResponse.json({ outcome });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save outcome" },
      { status: 500 },
    );
  }
}
