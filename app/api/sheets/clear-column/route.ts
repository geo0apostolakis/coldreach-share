import { NextResponse } from "next/server";
import { clearColumnValues } from "@/lib/sheets";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { spreadsheetId, tab, column } = (await request.json().catch(() => ({}))) as {
    spreadsheetId?: string;
    tab?: string;
    column?: string;
  };

  if (!spreadsheetId || !tab || !column) {
    return NextResponse.json(
      { error: "spreadsheetId, tab and column are required" },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json({ cleared: await clearColumnValues(spreadsheetId, tab, column) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to clear the column" },
      { status: 500 },
    );
  }
}
