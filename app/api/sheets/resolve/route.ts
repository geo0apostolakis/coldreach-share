import { NextResponse } from "next/server";
import { extractSpreadsheetId, isPermissionError } from "@/lib/google";
import { getSpreadsheetMeta } from "@/lib/sheets";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const input = url.searchParams.get("url") ?? "";
  const spreadsheetId = extractSpreadsheetId(input);

  if (!spreadsheetId) {
    return NextResponse.json({ error: "That doesn't look like a Google Sheets link" }, { status: 400 });
  }

  try {
    const meta = await getSpreadsheetMeta(spreadsheetId);
    return NextResponse.json({ spreadsheetId, title: meta.title, sheets: meta.sheets });
  } catch (error) {
    if (isPermissionError(error)) {
      // Under drive.file a link alone grants nothing — the file has to come
      // through the Picker (or be one ColdReach created) before it is readable.
      return NextResponse.json(
        { error: "no-access", spreadsheetId },
        { status: 403 },
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to open spreadsheet" },
      { status: 500 },
    );
  }
}
