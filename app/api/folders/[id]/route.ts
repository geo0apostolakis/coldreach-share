import { NextResponse } from "next/server";
import { archiveFolder, getFolder, updateFolder } from "@/lib/folders";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, ctx: RouteContext<"/api/folders/[id]">) {
  try {
    const { id } = await ctx.params;
    const folder = await getFolder(id);
    if (!folder) return NextResponse.json({ error: "Folder not found" }, { status: 404 });
    return NextResponse.json({ folder });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Request failed" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/folders/[id]">) {
  try {
    const { id } = await ctx.params;
    const body = (await request.json()) as { name?: string; color?: string; note?: string };
    const folder = await updateFolder(id, body);
    if (!folder) return NextResponse.json({ error: "Folder not found" }, { status: 404 });
    return NextResponse.json({ folder });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update folder" },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/folders/[id]">) {
  try {
    const { id } = await ctx.params;
    const archived = await archiveFolder(id);
    if (!archived) return NextResponse.json({ error: "Folder not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Request failed" },
      { status: 500 },
    );
  }
}
