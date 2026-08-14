import { NextResponse } from "next/server";
import { createFolder, listFolders } from "@/lib/folders";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ folders: await listFolders() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load folders" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { name?: string; color?: string; note?: string };
    if (!body.name?.trim()) {
      return NextResponse.json({ error: "Folder name is required" }, { status: 400 });
    }
    const folder = await createFolder({
      name: body.name.trim(),
      color: body.color,
      note: body.note,
    });
    return NextResponse.json({ folder });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create folder" },
      { status: 500 },
    );
  }
}
