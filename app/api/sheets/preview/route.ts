import { NextResponse } from "next/server";
import { readObjects } from "@/lib/sheets";

export const dynamic = "force-dynamic";

const EMAIL_HINTS = ["email", "e-mail", "email address"];
const STATUS_HINTS = ["email status", "status", "sent"];

function guess(headers: string[], hints: string[]): string {
  for (const hint of hints) {
    const match = headers.find((header) => header.toLowerCase().trim() === hint);
    if (match) return match;
  }
  for (const hint of hints) {
    const match = headers.find((header) => header.toLowerCase().includes(hint));
    if (match) return match;
  }
  return "";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const spreadsheetId = url.searchParams.get("spreadsheetId") ?? "";
  const tab = url.searchParams.get("tab") ?? "";
  if (!spreadsheetId || !tab) {
    return NextResponse.json({ error: "spreadsheetId and tab are required" }, { status: 400 });
  }

  try {
    const { headers, rows } = await readObjects(spreadsheetId, tab);
    const emailColumn = guess(headers, EMAIL_HINTS);
    const statusColumn = guess(headers, STATUS_HINTS);
    const withEmail = emailColumn
      ? rows.filter((row) => (row.values[emailColumn] ?? "").trim() !== "")
      : rows;
    const pending = statusColumn
      ? withEmail.filter((row) => (row.values[statusColumn] ?? "").trim() === "").length
      : withEmail.length;

    return NextResponse.json({
      headers,
      emailColumn,
      statusColumn,
      total: withEmail.length,
      pending,
      sample: withEmail.slice(0, 3).map((row) => row.values),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to read sheet" },
      { status: 500 },
    );
  }
}
