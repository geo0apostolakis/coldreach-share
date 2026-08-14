"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Sparkles, Trash2, Wand2, Send, RefreshCw, ChevronLeft, ChevronRight, Inbox, Repeat } from "lucide-react";
import { AI_PLACEHOLDER, type CampaignConfig } from "@/lib/types";
import type { ModelOption } from "@/lib/ai";
import { api } from "@/lib/client";
import { Banner, Spinner } from "./ui";

type PreviewResult = {
  to: string;
  rowNumber: number;
  rowIndex: number;
  totalRows: number;
  subject: string;
  body: string;
  aiOutput: string;
};

type Props = {
  config: CampaignConfig;
  onChange: (config: CampaignConfig) => void;
  headers: string[];
  source: { spreadsheetId: string; tab: string; emailColumn: string; statusColumn: string };
};

type FocusTarget =
  | { kind: "variant"; index: number; field: "subject" | "body" }
  | { kind: "ai" }
  | { kind: "ai-system" };

export default function ComposeEditor({ config, onChange, headers, source }: Props) {
  const [active, setActive] = useState(0);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [rowIndex, setRowIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [testBusy, setTestBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "good"; text: string } | null>(null);
  const focusRef = useRef<FocusTarget>({ kind: "variant", index: 0, field: "body" });

  const variant = config.variants[active] ?? config.variants[0];

  // OpenRouter returns newest first, which is the order worth keeping inside
  // each provider. The providers themselves get a fixed order.
  const modelGroups = useMemo(() => {
    const labels: Record<string, string> = {
      anthropic: "Anthropic",
      openai: "OpenAI",
      google: "Google",
    };
    return Object.keys(labels)
      .map((provider) => ({
        provider,
        label: labels[provider],
        items: models.filter((model) => model.provider === provider),
      }))
      .filter((group) => group.items.length > 0);
  }, [models]);

  useEffect(() => {
    api<{ models: ModelOption[] }>("/api/models")
      .then((data) => setModels(data.models))
      .catch(() => setModels([]));
  }, []);

  function patch(next: Partial<CampaignConfig>) {
    onChange({ ...config, ...next });
  }

  function patchVariant(index: number, next: Partial<CampaignConfig["variants"][number]>) {
    const variants = config.variants.map((item, i) => (i === index ? { ...item, ...next } : item));
    patch({ variants });
  }

  function addVariant() {
    const letter = String.fromCharCode(65 + config.variants.length);
    patch({
      variants: [...config.variants, { name: `Variant ${letter}`, subject: "", body: "", weight: 1 }],
    });
    setActive(config.variants.length);
  }

  function removeVariant(index: number) {
    if (config.variants.length === 1) return;
    patch({ variants: config.variants.filter((_, i) => i !== index) });
    setActive(0);
  }

  /** Inserts {{Column}} at the caret of whichever field was last focused. */
  function insertToken(token: string) {
    const target = focusRef.current;
    const key =
      target.kind === "variant" ? `${target.index}:${target.field}` : target.kind;
    const element = document.querySelector<HTMLTextAreaElement | HTMLInputElement>(
      `[data-compose-field="${key}"]`,
    );
    const text = `{{${token}}}`;

    const apply = (next: string) => {
      if (target.kind === "ai") patch({ ai: { ...config.ai, prompt: next } });
      else if (target.kind === "ai-system") patch({ ai: { ...config.ai, systemPrompt: next } });
      else patchVariant(target.index, { [target.field]: next });
    };

    if (!element) {
      const current =
        target.kind === "ai"
          ? config.ai.prompt
          : target.kind === "ai-system"
            ? config.ai.systemPrompt
            : (config.variants[target.index]?.[target.field] ?? "");
      apply(current + text);
      return;
    }

    const start = element.selectionStart ?? element.value.length;
    const end = element.selectionEnd ?? start;
    apply(element.value.slice(0, start) + text + element.value.slice(end));

    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(start + text.length, start + text.length);
    });
  }

  async function runPreview(withAi: boolean, index = rowIndex) {
    if (!source.spreadsheetId || !source.tab) return;
    if (withAi) setAiBusy(true);
    else setBusy(true);
    setMessage(null);
    try {
      const result = await api<PreviewResult>("/api/preview/render", {
        method: "POST",
        body: JSON.stringify({
          spreadsheetId: source.spreadsheetId,
          tab: source.tab,
          emailColumn: source.emailColumn,
          statusColumn: source.statusColumn,
          rowIndex: index,
          variantIndex: active,
          config,
          withAi,
        }),
      });
      setPreview(result);
      setRowIndex(result.rowIndex);
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Preview failed" });
    } finally {
      if (withAi) setAiBusy(false);
      else setBusy(false);
    }
  }

  async function sendTest() {
    if (!preview) return;
    setTestBusy(true);
    setMessage(null);
    try {
      const result = await api<{ to: string }>("/api/preview/test-send", {
        method: "POST",
        body: JSON.stringify({ subject: preview.subject, body: preview.body }),
      });
      setMessage({ tone: "good", text: `Test email sent to ${result.to}` });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Test send failed" });
    } finally {
      setTestBusy(false);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
      <div className="min-w-0 space-y-5">
        {/* Variant tabs */}
        <div className="flex flex-wrap items-center gap-1.5">
          {config.variants.map((item, index) => (
            <button
              key={index}
              onClick={() => setActive(index)}
              className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                index === active
                  ? "bg-ink-800 font-medium text-ink-100"
                  : "text-ink-400 hover:bg-ink-850 hover:text-ink-100"
              }`}
            >
              {item.name}
            </button>
          ))}
          <button onClick={addVariant} className="btn btn-ghost ml-1 !px-2.5 !py-1.5">
            <Plus size={14} />
            Variant
          </button>
        </div>

        <div className="card space-y-4 p-5">
          <div className="flex items-center justify-between gap-3">
            <input
              className="field !w-auto flex-1 !py-1.5 text-sm font-medium"
              value={variant.name}
              onChange={(e) => patchVariant(active, { name: e.target.value })}
            />
            <label className="flex items-center gap-2 text-xs text-ink-400">
              Weight
              <input
                type="number"
                min={0}
                className="field !w-16 !py-1.5"
                value={variant.weight}
                onChange={(e) => patchVariant(active, { weight: Number(e.target.value) })}
              />
            </label>
            {config.variants.length > 1 && (
              <button
                onClick={() => removeVariant(active)}
                className="btn btn-danger !px-2.5"
                title="Delete variant"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>

          <div>
            <label className="lbl">Subject</label>
            <input
              data-compose-field={`${active}:subject`}
              className="field"
              value={variant.subject}
              placeholder="{{First Name}}, quick question about {{Company}}"
              onFocus={() => (focusRef.current = { kind: "variant", index: active, field: "subject" })}
              onChange={(e) => patchVariant(active, { subject: e.target.value })}
            />
          </div>

          <div>
            <label className="lbl">Body</label>
            <textarea
              data-compose-field={`${active}:body`}
              className="field font-mono text-[13px] md:min-h-[32rem]"
              rows={20}
              value={variant.body}
              placeholder={`Hi {{First Name}},\n\n{{${AI_PLACEHOLDER}}}\n\n...`}
              onFocus={() => (focusRef.current = { kind: "variant", index: active, field: "body" })}
              onChange={(e) => patchVariant(active, { body: e.target.value })}
            />
          </div>
        </div>

        {/* AI block */}
        <div className="card p-5">
          <label className="flex cursor-pointer items-center gap-2.5">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[var(--color-brand-500)]"
              checked={config.ai.enabled}
              onChange={(e) => patch({ ai: { ...config.ai, enabled: e.target.checked } })}
            />
            <Sparkles size={15} className="text-brand-400" />
            <span className="text-sm font-medium">AI personalisation</span>
            <span className="text-xs text-ink-400">
              writes a custom line per lead, dropped in as{" "}
              <code className="font-mono text-brand-400">{`{{${AI_PLACEHOLDER}}}`}</code>
            </span>
          </label>

          {config.ai.enabled && (
            <div className="mt-4 space-y-4">
              <div>
                <label className="lbl">System prompt — the AI&apos;s role and rules</label>
                <textarea
                  data-compose-field="ai-system"
                  className="field font-mono text-[13px] md:min-h-[14rem]"
                  rows={8}
                  value={config.ai.systemPrompt}
                  placeholder="You are a Greek B2B copywriter. Never use emojis. Max 2 sentences."
                  onFocus={() => (focusRef.current = { kind: "ai-system" })}
                  onChange={(e) => patch({ ai: { ...config.ai, systemPrompt: e.target.value } })}
                />
                <p className="mt-1.5 text-xs text-ink-400">
                  Stays the same for every lead. Put tone, language and hard rules here.
                </p>
              </div>
              <div>
                <label className="lbl">Instructions to the AI — the per-lead task</label>
                <textarea
                  data-compose-field="ai"
                  className="field font-mono text-[13px] md:min-h-[22rem]"
                  rows={13}
                  value={config.ai.prompt}
                  placeholder="Write 1-2 sentences for a cold email to {{Company}} ({{Headline}})…"
                  onFocus={() => (focusRef.current = { kind: "ai" })}
                  onChange={(e) => patch({ ai: { ...config.ai, prompt: e.target.value } })}
                />
              </div>
              <div>
                <label className="lbl">Model</label>
                <select
                  className="field"
                  value={config.ai.model}
                  onChange={(e) => patch({ ai: { ...config.ai, model: e.target.value } })}
                >
                  {!models.some((model) => model.id === config.ai.model) && (
                    <option value={config.ai.model}>{config.ai.model || "Pick a model"}</option>
                  )}
                  {modelGroups.map((group) => (
                    <optgroup key={group.provider} label={group.label}>
                      {group.items.map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <p className="mt-1.5 text-xs leading-relaxed text-ink-400">
                  A model marked{" "}
                  <span className="text-ink-300">(reads websites and internet)</span> searches the
                  web before it writes, so it can open the lead&apos;s own site. Every model can do
                  it, none of them can without it. It costs more per email and takes a few seconds
                  longer.
                </p>
                <input
                  className="field mt-2 font-mono text-[13px]"
                  list="openrouter-models"
                  placeholder="or type any OpenRouter model id"
                  value={config.ai.model}
                  onChange={(e) => patch({ ai: { ...config.ai, model: e.target.value } })}
                />
                <datalist id="openrouter-models">
                  {models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name}
                    </option>
                  ))}
                </datalist>
              </div>
            </div>
          )}
        </div>

        {/* Custom variables */}
        <div className="card p-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="lbl !mb-0">My variables</div>
              <p className="mt-1 text-xs text-ink-400">
                Define once, use in the subject, body, signature and both prompts.
              </p>
            </div>
            <button
              className="btn btn-ghost !px-2.5 !py-1.5"
              onClick={() => patch({ variables: [...config.variables, { name: "", value: "" }] })}
            >
              <Plus size={14} />
              Variable
            </button>
          </div>

          {config.variables.length > 0 && (
            <div className="mt-4 space-y-2">
              {config.variables.map((item, index) => (
                <div key={index} className="flex items-center gap-2">
                  <input
                    className="field !mt-0 !w-44 font-mono text-[13px]"
                    placeholder="my_offer"
                    value={item.name}
                    onChange={(e) =>
                      patch({
                        variables: config.variables.map((entry, i) =>
                          i === index ? { ...entry, name: e.target.value } : entry,
                        ),
                      })
                    }
                  />
                  <input
                    className="field !mt-0 flex-1"
                    placeholder="AI automation for accounting firms"
                    value={item.value}
                    onChange={(e) =>
                      patch({
                        variables: config.variables.map((entry, i) =>
                          i === index ? { ...entry, value: e.target.value } : entry,
                        ),
                      })
                    }
                  />
                  <button
                    className="btn btn-danger !px-2.5"
                    title="Remove variable"
                    onClick={() =>
                      patch({ variables: config.variables.filter((_, i) => i !== index) })
                    }
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              <p className="text-xs text-ink-500">
                A sheet column with the same name wins, so per-lead data is never overwritten.
              </p>
            </div>
          )}
        </div>

        {/* Inbox handling — write a status back onto leads that bounce or reply */}
        <div className="card p-5">
          <label className="flex cursor-pointer items-center gap-2.5">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[var(--color-brand-500)]"
              checked={config.inbound.enabled}
              onChange={(e) => patch({ inbound: { ...config.inbound, enabled: e.target.checked } })}
            />
            <Inbox size={15} className="text-brand-400" />
            <span className="text-sm font-medium">Update the sheet from my inbox</span>
            <span className="text-xs text-ink-400">flags leads that bounce or reply</span>
          </label>

          {config.inbound.enabled && (
            <div className="mt-4 space-y-4">
              <div>
                <label className="lbl">Column to update</label>
                <select
                  className="field"
                  value={config.inbound.column}
                  onChange={(e) => patch({ inbound: { ...config.inbound, column: e.target.value } })}
                >
                  <option value="">Select a column…</option>
                  {headers.filter(Boolean).map((header) => (
                    <option key={header} value={header}>
                      {header}
                    </option>
                  ))}
                </select>
                <p className="mt-1.5 text-xs text-ink-400">
                  The status lands here, matched to the lead by email address. Created if it doesn&apos;t exist.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="lbl">When it bounces (dead address)</label>
                  <input
                    className="field"
                    value={config.inbound.bounceValue}
                    placeholder="You Have to Sent On LinkedIn"
                    onChange={(e) => patch({ inbound: { ...config.inbound, bounceValue: e.target.value } })}
                  />
                </div>
                <div>
                  <label className="lbl">When they reply</label>
                  <input
                    className="field"
                    value={config.inbound.replyValue}
                    placeholder="Replied"
                    onChange={(e) => patch({ inbound: { ...config.inbound, replyValue: e.target.value } })}
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Automatic follow-ups */}
        <div className="card p-5">
          <label className="flex cursor-pointer items-center gap-2.5">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[var(--color-brand-500)]"
              checked={config.followUp.enabled}
              onChange={(e) => patch({ followUp: { ...config.followUp, enabled: e.target.checked } })}
            />
            <Repeat size={15} className="text-brand-400" />
            <span className="text-sm font-medium">Send automatic follow-ups</span>
            <span className="text-xs text-ink-400">to leads who never replied</span>
          </label>

          {config.followUp.enabled && (
            <div className="mt-4 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="lbl">Days between emails</label>
                  <input
                    className="field"
                    type="number"
                    min={1}
                    value={config.followUp.dayGap}
                    onChange={(e) =>
                      patch({ followUp: { ...config.followUp, dayGap: Number(e.target.value) || 1 } })
                    }
                  />
                  <p className="mt-1.5 text-xs text-ink-400">
                    Counted from the last email that actually went to that lead.
                  </p>
                </div>
                <div>
                  <label className="lbl">How many follow-ups</label>
                  <select
                    className="field"
                    value={config.followUp.maxFollowUps}
                    onChange={(e) =>
                      patch({ followUp: { ...config.followUp, maxFollowUps: Number(e.target.value) } })
                    }
                  >
                    {[1, 2, 3].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1.5 text-xs text-ink-400">Three is the cap, on purpose.</p>
                </div>
              </div>

              {Array.from({ length: config.followUp.maxFollowUps }, (_, index) => {
                const step = config.followUp.steps[index] ?? { subject: "", body: "" };
                const setStep = (next: { subject: string; body: string }) => {
                  const steps = Array.from(
                    { length: config.followUp.maxFollowUps },
                    (_, i) => config.followUp.steps[i] ?? { subject: "", body: "" },
                  );
                  steps[index] = next;
                  patch({ followUp: { ...config.followUp, steps } });
                };
                return (
                  <div key={index} className="rounded-lg border border-ink-700 bg-ink-900/40 p-4">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                      Follow-up {index + 1}
                      <span className="ml-2 normal-case tracking-normal text-ink-500">
                        sent {config.followUp.dayGap * (index + 1)} days after the first email, if
                        nothing came back
                      </span>
                    </div>
                    <div className="mt-3">
                      <label className="lbl">Subject</label>
                      <input
                        className="field"
                        placeholder="Leave blank to reply with Re: the previous subject"
                        value={step.subject}
                        onChange={(e) => setStep({ ...step, subject: e.target.value })}
                      />
                    </div>
                    <div className="mt-3">
                      <label className="lbl">Body</label>
                      <textarea
                        className="field md:min-h-[14rem]"
                        rows={8}
                        placeholder="Short. The first email said the thing, this one just brings it back up."
                        value={step.body}
                        onChange={(e) => setStep({ ...step, body: e.target.value })}
                      />
                    </div>
                  </div>
                );
              })}

              <p className="text-xs leading-relaxed text-ink-400">
                Anyone who replies or bounces is skipped automatically, which needs inbox handling
                above switched on. Without it nothing marks a lead as replied, so follow-ups keep
                going to people who already answered.
              </p>
            </div>
          )}
        </div>

        <div className="card p-5">
          <label className="lbl">Signature (appended to every email)</label>
          <textarea
            className="field min-h-24 font-mono text-[13px]"
            value={config.signature}
            onChange={(e) => patch({ signature: e.target.value })}
          />
          <label className="lbl mt-4">Reply-to (optional)</label>
          <input
            className="field"
            value={config.sender.replyTo}
            placeholder="replies@yourdomain.com"
            onChange={(e) => patch({ sender: { replyTo: e.target.value } })}
          />
        </div>
      </div>

      {/* Right rail: variables + preview */}
      <div className="min-w-0 space-y-5">
        <div className="card p-4">
          <div className="lbl">Variables — click to insert</div>
          <div className="flex flex-wrap gap-1.5">
            {config.ai.enabled && (
              <button className="chip !border-brand-500/50 !text-brand-400" onClick={() => insertToken(AI_PLACEHOLDER)}>
                {AI_PLACEHOLDER}
              </button>
            )}
            {config.variables
              .filter((item) => item.name.trim())
              .map((item) => (
                <button
                  key={`custom-${item.name}`}
                  className="chip !border-good-500/50 !text-good-500"
                  title={item.value || "(empty)"}
                  onClick={() => insertToken(item.name.trim())}
                >
                  {item.name.trim()}
                </button>
              ))}
            {headers.filter(Boolean).map((header) => (
              <button key={header} className="chip" onClick={() => insertToken(header)}>
                {header}
              </button>
            ))}
          </div>
          {headers.length === 0 && (
            <p className="text-xs text-ink-400">Pick a sheet tab first to load its columns.</p>
          )}
        </div>

        <div className="card p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="lbl !mb-0">Preview</div>
            <div className="flex items-center gap-1">
              <button
                className="btn btn-ghost !px-2 !py-1"
                disabled={busy || rowIndex === 0}
                onClick={() => runPreview(false, rowIndex - 1)}
              >
                <ChevronLeft size={14} />
              </button>
              <span className="min-w-14 text-center text-xs tabular-nums text-ink-400">
                {preview ? `${preview.rowIndex + 1}/${preview.totalRows}` : "—"}
              </span>
              <button
                className="btn btn-ghost !px-2 !py-1"
                disabled={busy || (preview ? preview.rowIndex + 1 >= preview.totalRows : true)}
                onClick={() => runPreview(false, rowIndex + 1)}
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button className="btn btn-ghost flex-1" onClick={() => runPreview(false)} disabled={busy}>
              {busy ? <Spinner /> : <RefreshCw size={14} />}
              Render
            </button>
            {config.ai.enabled && (
              <button className="btn btn-ghost flex-1" onClick={() => runPreview(true)} disabled={aiBusy}>
                {aiBusy ? <Spinner /> : <Wand2 size={14} />}
                With AI
              </button>
            )}
          </div>

          {preview && (
            <div className="mt-4 space-y-3">
              <div className="text-xs text-ink-400">
                To <span className="text-ink-100">{preview.to}</span> · row {preview.rowNumber}
              </div>
              <div className="rounded-lg border border-ink-700 bg-ink-900 p-3">
                <div className="mb-2 border-b border-ink-700 pb-2 text-sm font-medium">
                  {preview.subject || <span className="text-ink-400">(no subject)</span>}
                </div>
                <pre className="max-h-80 overflow-y-auto whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-ink-300">
                  {preview.body}
                </pre>
              </div>
              <button className="btn btn-primary w-full" onClick={sendTest} disabled={testBusy}>
                {testBusy ? <Spinner /> : <Send size={14} />}
                Send test to me
              </button>
            </div>
          )}

          {message && (
            <div className="mt-3">
              <Banner tone={message.tone}>{message.text}</Banner>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
