import { NextResponse } from "next/server";
import { runTick } from "@/lib/engine";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Sends one email immediately, ignoring the send window but honouring the daily quota. */
export async function POST(_request: Request, ctx: RouteContext<"/api/campaigns/[id]/run-now">) {
  const { id } = await ctx.params;
  try {
    const result = await runTick({ campaignId: id, force: true });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Run failed" },
      { status: 500 },
    );
  }
}
