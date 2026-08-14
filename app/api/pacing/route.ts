import { NextResponse } from "next/server";
import { getLastSendAt, getSendGapMinutes, setSendGapMinutes } from "@/lib/runtime";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({
      minutes: await getSendGapMinutes(),
      lastSendAt: await getLastSendAt(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to read the send gap" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const { minutes } = (await request.json().catch(() => ({}))) as { minutes?: unknown };
  const value = Number(minutes);
  // A whole day is the ceiling: anything larger is a typo, not a schedule.
  if (!Number.isFinite(value) || value < 0 || value > 1440) {
    return NextResponse.json({ error: "Minutes must be between 0 and 1440" }, { status: 400 });
  }

  try {
    await setSendGapMinutes(value);
    return NextResponse.json({ minutes: await getSendGapMinutes() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save the send gap" },
      { status: 500 },
    );
  }
}
