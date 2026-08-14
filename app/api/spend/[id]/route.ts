import { NextResponse } from "next/server";
import { deleteSpend } from "@/lib/spend";

export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, ctx: RouteContext<"/api/spend/[id]">) {
  try {
    const { id } = await ctx.params;
    const removed = await deleteSpend(id);
    if (!removed) return NextResponse.json({ error: "Spend entry not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Request failed" },
      { status: 500 },
    );
  }
}
