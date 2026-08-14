import { NextResponse } from "next/server";
import { buildMetrics } from "@/lib/metrics-data";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const metrics = await buildMetrics({
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
      folderId: url.searchParams.get("folderId") ?? undefined,
      campaignId: url.searchParams.get("campaignId") ?? undefined,
    });
    return NextResponse.json({ metrics });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to build metrics" },
      { status: 500 },
    );
  }
}
