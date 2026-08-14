import { NextResponse } from "next/server";
import { harvest } from "@/lib/machine/harvest";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const { targetId, maxItems } = (await request.json()) as {
      targetId?: string;
      maxItems?: number;
    };
    if (!targetId) return NextResponse.json({ error: "targetId is required" }, { status: 400 });

    return NextResponse.json(await harvest(targetId, { maxItems }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
