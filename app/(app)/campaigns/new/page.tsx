"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, Save } from "lucide-react";
import ComposeEditor from "@/components/ComposeEditor";
import ScheduleForm from "@/components/ScheduleForm";
import SheetPicker from "@/components/SheetPicker";
import { InteractiveHoverButton } from "@/components/ui/interactive-hover-button";
import { Banner, Spinner } from "@/components/ui";
import { api } from "@/lib/client";
import { emptyConfig, type Campaign, type CampaignConfig, type Folder } from "@/lib/types";

const STEPS = ["Source", "Columns", "Compose", "Schedule", "Review"];

type SheetInfo = { title: string; sheetId: number; rowCount: number };
type ResolveResult = { spreadsheetId: string; title: string; sheets: SheetInfo[] };
type PreviewResult = {
  headers: string[];
  emailColumn: string;
  statusColumn: string;
  total: number;
  pending: number;
  sample: Record<string, string>[];
};

export default function NewCampaignPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState("");
  const [folderId, setFolderId] = useState("");
  const [folders, setFolders] = useState<Folder[]>([]);
  const [resolved, setResolved] = useState<ResolveResult | null>(null);
  const [tab, setTab] = useState("");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [emailColumn, setEmailColumn] = useState("");
  const [statusColumn, setStatusColumn] = useState("");
  const [newStatusColumn, setNewStatusColumn] = useState("");
  const [clearStatusColumn, setClearStatusColumn] = useState(false);
  const [config, setConfig] = useState<CampaignConfig>(emptyConfig());

  useEffect(() => {
    let cancelled = false;
    api<{ folders: Folder[] }>("/api/folders")
      .then((data) => !cancelled && setFolders(data.folders))
      .catch(() => !cancelled && setFolders([]));
    return () => {
      cancelled = true;
    };
  }, []);
  const [schedule, setSchedule] = useState({
    firstDayVolume: 5,
    dailyIncrement: 1,
    maxDailyLimit: 30,
    sendWindowStart: "09:00",
    sendWindowEnd: "17:00",
    timezone: "Europe/Athens",
    startDate: new Date().toISOString().slice(0, 10),
  });

  const effectiveStatusColumn = statusColumn === "__new__" ? newStatusColumn.trim() : statusColumn;

  /** Loads the tab list for a spreadsheet the user just picked. */
  async function openSpreadsheet(spreadsheetId: string): Promise<ResolveResult | null> {
    setBusy(true);
    setError("");
    try {
      const result = await api<ResolveResult>(
        `/api/sheets/resolve?url=${encodeURIComponent(spreadsheetId)}`,
      );
      setResolved(result);
      setTab("");
      setPreview(null);
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open that spreadsheet");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function loadTab(tabName: string, spreadsheetId?: string) {
    const id = spreadsheetId ?? resolved?.spreadsheetId;
    if (!id) return;
    setTab(tabName);
    setBusy(true);
    setError("");
    try {
      const result = await api<PreviewResult>(
        `/api/sheets/preview?spreadsheetId=${id}&tab=${encodeURIComponent(tabName)}`,
      );
      setPreview(result);
      setEmailColumn(result.emailColumn);
      setStatusColumn(result.statusColumn || "__new__");
      setClearStatusColumn(false);
      if (!result.statusColumn) setNewStatusColumn("Email Status");
      if (!name.trim()) setName(tabName.replace(/[^\p{L}\p{N} ]/gu, "").trim() || tabName);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that tab");
    } finally {
      setBusy(false);
    }
  }

  async function save(start: boolean) {
    if (!resolved) return;
    setBusy(true);
    setError("");
    try {
      if (clearStatusColumn && statusColumn !== "__new__") {
        await api<{ cleared: number }>("/api/sheets/clear-column", {
          method: "POST",
          body: JSON.stringify({
            spreadsheetId: resolved.spreadsheetId,
            tab,
            column: effectiveStatusColumn,
          }),
        });
      }
      const { campaign } = await api<{ campaign: Campaign }>("/api/campaigns", {
        method: "POST",
        body: JSON.stringify({
          name,
          status: start ? "running" : "draft",
          leadsSpreadsheetId: resolved.spreadsheetId,
          leadsSpreadsheetName: resolved.title,
          leadsSheetName: tab,
          emailColumn,
          statusColumn: effectiveStatusColumn,
          ...schedule,
          config,
          folderId,
        }),
      });
      router.push(`/campaigns/${campaign.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the campaign");
      setBusy(false);
    }
  }

  const canAdvance = [
    Boolean(resolved && tab),
    Boolean(emailColumn && effectiveStatusColumn),
    config.variants.some((variant) => variant.subject.trim() && variant.body.trim()),
    schedule.maxDailyLimit > 0,
    true,
  ][step];

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-8 py-7">
      <button
        onClick={() => router.push("/")}
        className="mb-5 flex items-center gap-1.5 text-sm text-ink-400 hover:text-ink-100"
      >
        <ArrowLeft size={15} />
        Campaigns
      </button>

      <h1 className="text-xl font-semibold tracking-tight">New campaign</h1>

      {/* Stepper */}
      <div className="scroll-x my-6 flex items-center gap-2">
        {STEPS.map((label, index) => (
          <div key={label} className="flex shrink-0 items-center gap-2">
            <button
              onClick={() => index < step && setStep(index)}
              disabled={index > step}
              className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition-colors ${
                index === step
                  ? "bg-ink-800 font-medium text-ink-100"
                  : index < step
                    ? "text-ink-300 hover:text-ink-100"
                    : "text-ink-600"
              }`}
            >
              <span
                className={`grid h-5 w-5 place-items-center rounded-full text-[11px] font-semibold ${
                  index < step
                    ? "bg-brand-500 text-white"
                    : index === step
                      ? "bg-ink-600 text-ink-100"
                      : "bg-ink-800 text-ink-400"
                }`}
              >
                {index < step ? <Check size={11} /> : index + 1}
              </span>
              {label}
            </button>
            {index < STEPS.length - 1 && <span className="h-px w-4 bg-ink-700" />}
          </div>
        ))}
      </div>

      {error && (
        <div className="mb-4">
          <Banner tone="error">{error}</Banner>
        </div>
      )}

      {step === 0 && (
        <div className="max-w-2xl space-y-5">
          <SheetPicker
            campaignName={name}
            onPick={(picked) => void openSpreadsheet(picked.spreadsheetId)}
            onCsvImported={async (imported) => {
              // The import already knows its only tab, so skip straight to it.
              const result = await openSpreadsheet(imported.spreadsheetId);
              if (result) await loadTab(imported.tab, imported.spreadsheetId);
            }}
          />

          <div className="card space-y-5 p-6">
          {!resolved && !busy && (
            <p className="text-sm text-ink-400">Pick a spreadsheet above to see its tabs.</p>
          )}
          {busy && !resolved && (
            <p className="flex items-center gap-2 text-sm text-ink-400">
              <Spinner /> Opening…
            </p>
          )}

          {resolved && (
            <div>
              <label className="lbl">Tab in “{resolved.title}”</label>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {resolved.sheets.map((sheet) => (
                  <button
                    key={sheet.sheetId}
                    onClick={() => loadTab(sheet.title)}
                    className={`flex items-center justify-between rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
                      tab === sheet.title
                        ? "border-brand-500 bg-brand-500/10"
                        : "border-ink-700 bg-ink-900 hover:border-ink-600"
                    }`}
                  >
                    <span className="truncate">{sheet.title}</span>
                    {tab === sheet.title && <Check size={14} className="text-brand-400" />}
                  </button>
                ))}
              </div>
            </div>
          )}

          {preview && (
            <div>
              <label className="lbl">Campaign name</label>
              <input className="field" value={name} onChange={(e) => setName(e.target.value)} />
              {folders.length > 0 && (
                <div className="mt-4">
                  <label className="lbl">Folder</label>
                  <select className="field" value={folderId} onChange={(e) => setFolderId(e.target.value)}>
                    <option value="">Not in a folder</option>
                    {folders.map((folder) => (
                      <option key={folder.id} value={folder.id}>
                        {folder.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <p className="mt-2 text-xs leading-relaxed text-ink-400">
                A new tab called <span className="text-ink-200">{name || "…"}</span> will be added to “
                {resolved?.title}” holding a copy of these leads. Sending writes only there — “{tab}”
                itself is never modified.
              </p>
            </div>
          )}
          </div>
        </div>
      )}

      {step === 1 && preview && (
        <div className="space-y-5">
          <div className="card p-6">
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <label className="lbl">Email column</label>
                <select
                  className="field"
                  value={emailColumn}
                  onChange={(e) => setEmailColumn(e.target.value)}
                >
                  <option value="">Select…</option>
                  {preview.headers.filter(Boolean).map((header) => (
                    <option key={header} value={header}>
                      {header}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="lbl">Status column (Automatesphere writes here)</label>
                <select
                  className="field"
                  value={statusColumn}
                  onChange={(e) => setStatusColumn(e.target.value)}
                >
                  <option value="">Select…</option>
                  {preview.headers.filter(Boolean).map((header) => (
                    <option key={header} value={header}>
                      {header}
                    </option>
                  ))}
                  <option value="__new__">+ Create a new column</option>
                </select>
                {statusColumn === "__new__" && (
                  <input
                    className="field mt-2"
                    placeholder="Email Status"
                    value={newStatusColumn}
                    onChange={(e) => setNewStatusColumn(e.target.value)}
                  />
                )}
                {statusColumn !== "__new__" && statusColumn !== "" && (
                  <>
                    <label className="mt-3 flex cursor-pointer items-start gap-2.5">
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-brand-500)]"
                        checked={clearStatusColumn}
                        onChange={(e) => setClearStatusColumn(e.target.checked)}
                      />
                      <span className="text-sm">
                        Empty this column first, so every lead counts as fresh
                      </span>
                    </label>
                    <p className="mt-1.5 text-xs leading-relaxed text-ink-400">
                      An Apollo export fills{" "}
                      <span className="font-mono text-ink-300">email_status</span> with
                      &ldquo;verified&rdquo; on every row, which reads as already contacted and
                      sends nothing. This deletes every value under the header when you save the
                      campaign. The header stays, the rest of the sheet is untouched, and there is
                      no undo.
                    </p>
                  </>
                )}
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-4 border-t border-ink-700 pt-4 text-sm">
              <span className="text-ink-400">
                Leads with an email: <span className="text-ink-100">{preview.total}</span>
              </span>
              <span className="text-ink-400">
                Not contacted yet: <span className="text-ink-100">{preview.pending}</span>
              </span>
            </div>
          </div>

          <div className="card overflow-hidden">
            <div className="border-b border-ink-700 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-ink-400">
              First rows
            </div>
            <div className="scroll-x">
              <table className="w-full text-left text-[13px]">
                <thead>
                  <tr className="border-b border-ink-700">
                    {preview.headers.filter(Boolean).map((header) => (
                      <th key={header} className="whitespace-nowrap px-3 py-2 font-medium text-ink-400">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.sample.map((row, index) => (
                    <tr key={index} className="border-b border-ink-800 last:border-0">
                      {preview.headers.filter(Boolean).map((header) => (
                        <td key={header} className="max-w-56 truncate px-3 py-2 text-ink-300">
                          {row[header]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {step === 2 && (
        <ComposeEditor
          config={config}
          onChange={setConfig}
          headers={preview?.headers ?? []}
          source={{
            spreadsheetId: resolved?.spreadsheetId ?? "",
            tab,
            emailColumn,
            statusColumn: effectiveStatusColumn,
          }}
        />
      )}

      {step === 3 && <ScheduleForm value={schedule} onChange={setSchedule} />}

      {step === 4 && (
        <div className="card max-w-2xl divide-y divide-ink-700 p-6 text-sm">
          {[
            ["Campaign", name],
            ["Spreadsheet", `${resolved?.title} → ${tab}`],
            ["Sends from", `new tab “${name}” (copy of ${tab})`],
            ["Email column", emailColumn],
            ["Status column", effectiveStatusColumn],
            ["Variants", config.variants.map((variant) => variant.name).join(", ")],
            ["AI personalisation", config.ai.enabled ? `On — ${config.ai.model}` : "Off"],
            [
              "Ramp",
              `${schedule.firstDayVolume}/day, +${schedule.dailyIncrement}/day, cap ${schedule.maxDailyLimit}`,
            ],
            [
              "Window",
              `${schedule.sendWindowStart}–${schedule.sendWindowEnd} ${schedule.timezone}, from ${schedule.startDate}`,
            ],
            ["Leads waiting", String(preview?.pending ?? 0)],
          ].map(([label, value]) => (
            <div key={label} className="flex justify-between gap-6 py-2.5">
              <span className="text-ink-400">{label}</span>
              <span className="text-right font-medium">{value}</span>
            </div>
          ))}
        </div>
      )}

      <div className="mt-7 flex flex-wrap items-center gap-2">
        {step > 0 && (
          <button className="btn btn-ghost" onClick={() => setStep(step - 1)}>
            <ArrowLeft size={14} />
            Back
          </button>
        )}
        {step < STEPS.length - 1 ? (
          <InteractiveHoverButton
            text="Continue"
            disabled={!canAdvance}
            onClick={() => setStep(step + 1)}
            className="w-full border-ink-700 text-sm disabled:pointer-events-none disabled:opacity-40 sm:w-36"
          />
        ) : (
          <>
            <button className="btn btn-ghost" disabled={busy} onClick={() => save(false)}>
              <Save size={14} />
              Save as draft
            </button>
            <InteractiveHoverButton
              text={busy ? "Starting…" : "Start campaign"}
              disabled={busy}
              onClick={() => save(true)}
              className="w-full border-ink-700 text-sm disabled:pointer-events-none disabled:opacity-40 sm:w-44"
            />
          </>
        )}
      </div>
    </div>
  );
}
