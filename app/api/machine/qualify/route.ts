import { NextResponse } from "next/server";
import { qualify } from "@/lib/machine/qualify";
import type { CompanyCategory } from "@/lib/machine/targets";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const { targetId, model, limit, recategorise } = (await request.json()) as {
      targetId?: string;
      model?: string;
      limit?: number;
      recategorise?: CompanyCategory[];
    };
    if (!targetId) return NextResponse.json({ error: "targetId is required" }, { status: 400 });

    return NextResponse.json(await qualify(targetId, { model, limit, recategorise }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
