import { NextResponse } from "next/server";
import { readLogs } from "@/lib/log";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const campaignId = url.searchParams.get("campaignId") ?? undefined;
  const limit = Number(url.searchParams.get("limit")) || 200;
  try {
    return NextResponse.json({ logs: await readLogs(campaignId, limit) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to read logs" },
      { status: 500 },
    );
  }
}
