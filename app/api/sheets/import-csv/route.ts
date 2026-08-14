import { NextResponse } from "next/server";
import { createSpreadsheetFromRows, safeTabName } from "@/lib/drive";
import { detectDelimiter, normalizeHeaders, parseCsv } from "@/lib/csv";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Uploaded CSV -> a new spreadsheet in the user's Drive. An uploaded file has no
 * spreadsheet to live in, so it gets one; from then on it behaves like any other
 * picked sheet.
 */
export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    const name = String(form.get("name") ?? "").trim();

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "That CSV is larger than 5 MB" }, { status: 400 });
    }

    const text = await file.text();
    const rows = parseCsv(text, detectDelimiter(text));
    if (rows.length < 2) {
      return NextResponse.json(
        { error: "The CSV needs a header row and at least one lead" },
        { status: 400 },
      );
    }

    rows[0] = normalizeHeaders(rows[0]);

    const title = `Automatesphere — ${name || file.name.replace(/\.csv$/i, "")}`;
    const result = await createSpreadsheetFromRows(title, safeTabName(name || "Leads"), rows);

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "CSV import failed" },
      { status: 500 },
    );
  }
}
