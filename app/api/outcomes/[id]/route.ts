import { NextResponse } from "next/server";
import { deleteOutcome } from "@/lib/outcomes";

export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, ctx: RouteContext<"/api/outcomes/[id]">) {
  try {
    const { id } = await ctx.params;
    const removed = await deleteOutcome(id);
    if (!removed) return NextResponse.json({ error: "Outcome not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Request failed" },
      { status: 500 },
    );
  }
}
