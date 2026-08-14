import { costFromUsage } from "./ai-usage";
import { DEFAULT_MODEL } from "./types";

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

export type Generation = {
  text: string;
  generationId: string;
  /** USD for this one call, reported inline by OpenRouter. */
  costUsd: number;
};

export async function generateText(
  prompt: string,
  model = DEFAULT_MODEL,
  systemPrompt = "",
): Promise<Generation> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");

  const messages: { role: "system" | "user"; content: string }[] = [];
  if (systemPrompt.trim()) messages.push({ role: "system", content: systemPrompt });
  messages.push({ role: "user", content: prompt });

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-Title": "ColdReach",
    },
    body: JSON.stringify({
      model: model || DEFAULT_MODEL,
      messages,
      // Returns the call's cost in the same response. The separate
      // /generation endpoint also reports it, but only settles about eight
      // seconds later, which would mean sleeping on every send and on every
      // classifier batch.
      usage: { include: true },
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`OpenRouter ${res.status}: ${detail.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    id?: string;
    choices?: { message?: { content?: string } }[];
    usage?: { cost?: number };
  };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("OpenRouter returned an empty completion");

  return {
    text,
    generationId: data.id ?? "",
    costUsd: costFromUsage(data.usage),
  };
}

export async function checkOpenRouter(): Promise<{ ok: boolean; detail: string }> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return { ok: false, detail: "OPENROUTER_API_KEY is not set" };
  const res = await fetch("https://openrouter.ai/api/v1/key", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
  return { ok: true, detail: "Key accepted" };
}

export type ModelOption = {
  id: string;
  name: string;
  provider: string;
  /** True for the `:online` twin, which is the only way the model sees a live page. */
  web: boolean;
};

const PICKER_PROVIDERS = ["anthropic", "openai", "google"];

/**
 * Live model list, so the picker never drifts out of date.
 *
 * Every model is listed twice, plain and with OpenRouter's `:online` suffix.
 * Browsing is a property of the request, not of the model: the suffix turns on
 * a web search plugin that pastes results into the prompt. Verified against
 * both Gemini and Claude, which answer "no access" plain and read the live page
 * with the suffix. The suffix also adds a per-search fee on top of the tokens.
 */
export async function listModels(): Promise<ModelOption[]> {
  const res = await fetch("https://openrouter.ai/api/v1/models");
  if (!res.ok) return [];
  const data = (await res.json()) as {
    data?: { id: string; name?: string; architecture?: { output_modalities?: string[] } }[];
  };

  const options: ModelOption[] = [];
  for (const model of data.data ?? []) {
    const provider = model.id.split("/")[0];
    if (!PICKER_PROVIDERS.includes(provider)) continue;
    // ":batch" is queued for hours and ":free" is rate limited, neither can sit
    // in the send path.
    if (model.id.includes(":")) continue;
    // Image, audio and video models cannot write an email.
    const outputs = model.architecture?.output_modalities ?? ["text"];
    if (outputs.length !== 1 || outputs[0] !== "text") continue;

    const name = (model.name ?? model.id).replace(/^(Anthropic|OpenAI|Google):\s*/, "");
    options.push({ id: model.id, name, provider, web: false });
    options.push({
      id: `${model.id}:online`,
      name: `${name} (reads websites and internet)`,
      provider,
      web: true,
    });
  }
  return options;
}
