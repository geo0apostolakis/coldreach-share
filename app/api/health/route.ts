import { NextResponse } from "next/server";
import { checkOpenRouter } from "@/lib/ai";
import { checkGraph } from "@/lib/outlook";
import { controlSpreadsheetId } from "@/lib/google";
import { ensureControlTabs } from "@/lib/control";
import { getSpreadsheetMeta } from "@/lib/sheets";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const google = await (async () => {
    try {
      await ensureControlTabs(true);
      const meta = await getSpreadsheetMeta(controlSpreadsheetId());
      return { ok: true, detail: meta.title };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
  })();

  const [graph, openrouter] = await Promise.all([
    checkGraph(),
    checkOpenRouter().catch((error) => ({ ok: false, detail: String(error) })),
  ]);

  let controlSheetUrl = "";
  try {
    controlSheetUrl = `https://docs.google.com/spreadsheets/d/${controlSpreadsheetId()}/edit`;
  } catch {
    // Surfaced through the google check above.
  }

  // Built server-side so the settings page never has to touch window.location.
  const host = request.headers.get("host") ?? "localhost:3000";
  const protocol = request.headers.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");

  return NextResponse.json({
    google,
    graph,
    openrouter,
    googleSignedIn: Boolean(process.env.GOOGLE_REFRESH_TOKEN),
    pickerReady: Boolean(
      process.env.GOOGLE_API_KEY && process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_PROJECT_NUMBER,
    ),
    controlSheetUrl,
    cronUrl: `${protocol}://${host}/api/cron/tick`,
    cronConfigured: Boolean(process.env.CRON_SECRET),
    testEmailTo: process.env.TEST_EMAIL_TO ?? "",
  });
}
