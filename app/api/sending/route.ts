import { NextResponse } from "next/server";
import { sendingVolume } from "@/lib/metrics-data";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const days = Number(new URL(request.url).searchParams.get("days")) || 14;
    return NextResponse.json({ volume: await sendingVolume(days) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load sending volume" },
      { status: 500 },
    );
  }
}
