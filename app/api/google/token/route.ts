import { NextResponse } from "next/server";
import { browserAccessToken } from "@/lib/google";

export const dynamic = "force-dynamic";

/**
 * Hands the browser a short-lived access token plus the two public identifiers
 * the Google Picker needs. The refresh token never leaves the server.
 */
export async function GET() {
  try {
    const accessToken = await browserAccessToken();
    return NextResponse.json({
      accessToken,
      apiKey: process.env.GOOGLE_API_KEY ?? "",
      appId: process.env.GOOGLE_PROJECT_NUMBER ?? "",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not mint a Google token" },
      { status: 500 },
    );
  }
}
