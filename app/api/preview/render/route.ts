import { NextResponse } from "next/server";
import { generateText } from "@/lib/ai";
import { readObjects } from "@/lib/sheets";
import { render } from "@/lib/template";
import { AI_PLACEHOLDER, variableMap, type CampaignConfig } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Body = {
  spreadsheetId: string;
  tab: string;
  emailColumn: string;
  statusColumn: string;
  rowIndex?: number;
  variantIndex: number;
  config: CampaignConfig;
  withAi?: boolean;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body;
    const { rows } = await readObjects(body.spreadsheetId, body.tab);
    const usable = rows.filter((row) => (row.values[body.emailColumn] ?? "").trim() !== "");
    if (usable.length === 0) {
      return NextResponse.json({ error: "No rows with an email address in that tab" }, { status: 400 });
    }

    const index = Math.min(Math.max(body.rowIndex ?? 0, 0), usable.length - 1);
    const lead = usable[index];
    const variant = body.config.variants[body.variantIndex] ?? body.config.variants[0];
    // Same precedence as the engine: sheet columns win over custom variables.
    const vars: Record<string, string> = { ...variableMap(body.config.variables), ...lead.values };

    const wantsAi =
      body.withAi &&
      body.config.ai.enabled &&
      (variant.body.includes(`{{${AI_PLACEHOLDER}}}`) ||
        variant.subject.includes(`{{${AI_PLACEHOLDER}}}`));

    if (wantsAi) {
      vars[AI_PLACEHOLDER] = (
        await generateText(
          render(body.config.ai.prompt, vars),
          body.config.ai.model,
          render(body.config.ai.systemPrompt, vars),
        )
      ).text;
    } else if (body.config.ai.enabled) {
      vars[AI_PLACEHOLDER] = "[AI sentence appears here — press Generate to see the real one]";
    }

    const signature = body.config.signature ? `\n\n${render(body.config.signature, vars)}` : "";

    return NextResponse.json({
      to: lead.values[body.emailColumn] ?? "",
      rowNumber: lead.rowNumber,
      rowIndex: index,
      totalRows: usable.length,
      subject: render(variant.subject, vars),
      body: `${render(variant.body, vars)}${signature}`,
      aiOutput: vars[AI_PLACEHOLDER] ?? "",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Preview failed" },
      { status: 500 },
    );
  }
}
