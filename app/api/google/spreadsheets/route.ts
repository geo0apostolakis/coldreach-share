import { NextResponse } from "next/server";
import { listSpreadsheets } from "@/lib/drive";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q") ?? "";
  try {
    return NextResponse.json({ files: await listSpreadsheets(query) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not list spreadsheets" },
      { status: 500 },
    );
  }
}
