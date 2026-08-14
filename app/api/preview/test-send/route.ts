import { NextResponse } from "next/server";
import { sendMail } from "@/lib/outlook";
import { parseRecipients } from "@/lib/recipients";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Sends a rendered preview to the operator's own inbox. Never touches lead data. */
export async function POST(request: Request) {
  try {
    const { subject, body, to } = (await request.json()) as {
      subject: string;
      body: string;
      to?: string;
    };
    // Same rule as a real send: the field can hold several addresses.
    const recipients = parseRecipients(to?.trim() || process.env.TEST_EMAIL_TO || "");
    if (recipients.length === 0) {
      return NextResponse.json(
        { error: "No test address. Set TEST_EMAIL_TO or type one in." },
        { status: 400 },
      );
    }

    await sendMail({ to: recipients, subject: `[TEST] ${subject}`, body });
    return NextResponse.json({ ok: true, to: recipients.join(", ") });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Test send failed" },
      { status: 500 },
    );
  }
}
