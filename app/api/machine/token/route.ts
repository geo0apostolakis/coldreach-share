import { NextResponse } from "next/server";
import { checkApifyToken, setApifyToken } from "@/lib/machine/apify";

export const dynamic = "force-dynamic";

/** Validates a pasted key and, if it works, stores it in the Runtime tab. */
export async function POST(request: Request) {
  try {
    const { token, save } = (await request.json()) as { token?: string; save?: boolean };
    if (!token?.trim()) {
      return NextResponse.json({ error: "Paste a token first" }, { status: 400 });
    }

    // Always verify before storing, so a typo cannot break the next run.
    const account = await checkApifyToken(token);
    if (save) await setApifyToken(token);

    return NextResponse.json({ account, saved: Boolean(save) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
