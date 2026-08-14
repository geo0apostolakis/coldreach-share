"use client";

import { useCallback, useEffect, useState } from "react";
import { FileSpreadsheet, Loader2, RefreshCw, Search, Upload } from "lucide-react";

export type PickedSpreadsheet = { spreadsheetId: string; name: string };

type DriveFile = { id: string; name: string; modifiedTime: string };

/**
 * Minimal shape of the Google Picker globals. The Picker is loaded from
 * apis.google.com on demand rather than bundled, so it has to be declared.
 */
type PickerDoc = { id: string; name?: string };
type PickerData = { action: string; docs?: PickerDoc[] };

type PickerBuilderLike = {
  addView: (view: unknown) => PickerBuilderLike;
  setOAuthToken: (token: string) => PickerBuilderLike;
  setDeveloperKey: (key: string) => PickerBuilderLike;
  setAppId: (id: string) => PickerBuilderLike;
  setTitle: (title: string) => PickerBuilderLike;
  setCallback: (cb: (data: PickerData) => void) => PickerBuilderLike;
  build: () => { setVisible: (visible: boolean) => void };
};

type DocsViewLike = { setIncludeFolders: (on: boolean) => void };

type GapiWindow = Window & {
  gapi?: { load: (name: string, cb: () => void) => void };
  google?: {
    picker: {
      ViewId: { SPREADSHEETS: string };
      Action: { PICKED: string };
      DocsView: new (viewId: string) => DocsViewLike;
      PickerBuilder: new () => PickerBuilderLike;
    };
  };
};

const PICKER_SRC = "https://apis.google.com/js/api.js";

function loadPickerScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    const win = window as GapiWindow;
    if (win.google?.picker) return resolve();

    const finish = () => {
      const gapi = (window as GapiWindow).gapi;
      if (!gapi) return reject(new Error("Google API script did not load"));
      gapi.load("picker", () => resolve());
    };

    const existing = document.querySelector<HTMLScriptElement>(`script[src="${PICKER_SRC}"]`);
    if (existing) {
      if (win.gapi) finish();
      else existing.addEventListener("load", finish, { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = PICKER_SRC;
    script.async = true;
    script.onload = finish;
    script.onerror = () => reject(new Error("Could not reach apis.google.com"));
    document.head.appendChild(script);
  });
}

export default function SheetPicker({
  onPick,
  onCsvImported,
  campaignName,
}: {
  onPick: (picked: PickedSpreadsheet) => void;
  onCsvImported: (picked: PickedSpreadsheet & { tab: string; rows: number }) => void;
  campaignName: string;
}) {
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/google/spreadsheets");
        const data = (await res.json()) as { files?: DriveFile[]; error?: string };
        if (cancelled) return;
        if (data.error) setError(data.error);
        else setFiles(data.files ?? []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not list spreadsheets");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const openPicker = useCallback(async () => {
    setError("");
    setOpening(true);
    try {
      const res = await fetch("/api/google/token");
      const data = (await res.json()) as {
        accessToken?: string;
        apiKey?: string;
        appId?: string;
        error?: string;
      };
      if (!res.ok || !data.accessToken) throw new Error(data.error ?? "Google is not connected yet");
      if (!data.apiKey) throw new Error("GOOGLE_API_KEY is not set — the Picker needs it");
      // Without the project number the Picker cannot associate the picked file
      // with this OAuth client, so the drive.file grant never lands and the
      // server still can't read the sheet. Fail loudly rather than at read time.
      if (!data.appId) {
        throw new Error("GOOGLE_PROJECT_NUMBER is not set — without it the picked file stays unreadable");
      }

      await loadPickerScript();
      const picker = (window as GapiWindow).google?.picker;
      if (!picker) throw new Error("Google Picker did not initialise");

      const view = new picker.DocsView(picker.ViewId.SPREADSHEETS);
      view.setIncludeFolders(true);

      new picker.PickerBuilder()
        .addView(view)
        .setOAuthToken(data.accessToken)
        .setDeveloperKey(data.apiKey)
        .setAppId(data.appId)
        .setTitle("Choose a leads spreadsheet")
        .setCallback((result: PickerData) => {
          if (result.action !== picker.Action.PICKED) return;
          const doc = result.docs?.[0];
          if (!doc) return;
          onPick({ spreadsheetId: doc.id, name: doc.name ?? "Untitled" });
          // A freshly granted file won't be in the cached list yet.
          setReloadKey((key) => key + 1);
        })
        .build()
        .setVisible(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open the Google Picker");
    } finally {
      setOpening(false);
    }
  }, [onPick]);

  async function uploadCsv(file: File) {
    setError("");
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("name", campaignName);
      const res = await fetch("/api/sheets/import-csv", { method: "POST", body: form });
      const data = (await res.json()) as {
        spreadsheetId?: string;
        title?: string;
        tab?: string;
        rows?: number;
        error?: string;
      };
      if (!res.ok || !data.spreadsheetId) throw new Error(data.error ?? "CSV import failed");
      onCsvImported({
        spreadsheetId: data.spreadsheetId,
        name: data.title ?? file.name,
        tab: data.tab ?? "Leads",
        rows: data.rows ?? 0,
      });
      setReloadKey((key) => key + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "CSV import failed");
    } finally {
      setUploading(false);
    }
  }

  const visible = query.trim()
    ? files.filter((file) => file.name.toLowerCase().includes(query.trim().toLowerCase()))
    : files;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <button className="btn btn-primary" onClick={openPicker} disabled={opening}>
          {opening ? <Loader2 className="size-4 animate-spin" /> : <FileSpreadsheet className="size-4" />}
          Browse my Google Drive
        </button>

        <label className="btn btn-ghost cursor-pointer">
          {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
          Upload a CSV
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            disabled={uploading}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void uploadCsv(file);
            }}
          />
        </label>
      </div>

      <p className="text-xs leading-relaxed text-ink-400">
        The picker shows every spreadsheet in your Drive. Automatesphere only gets access to the ones you
        actually choose here — it can never read the rest.
      </p>

      {error && <div className="rounded-lg bg-bad-500/10 px-3 py-2 text-sm text-bad-500">{error}</div>}

      <div className="card p-4">
        <div className="mb-3 flex items-center gap-2">
          <Search className="size-4 text-ink-400" />
          <input
            className="field !mt-0 !border-0 !bg-transparent !px-0"
            placeholder="Filter sheets you've used before…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button
            className="chip"
            onClick={() => setReloadKey((key) => key + 1)}
            title="Refresh"
            disabled={loading}
          >
            <RefreshCw className={`size-3 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>

        {loading && files.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-400">Loading…</p>
        ) : visible.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-400">
            Nothing here yet — use <span className="text-ink-200">Browse my Google Drive</span> to pick
            your first spreadsheet.
          </p>
        ) : (
          <ul className="divide-y divide-ink-800">
            {visible.map((file) => (
              <li key={file.id}>
                <button
                  className="flex w-full items-center gap-3 px-1 py-2.5 text-left hover:bg-ink-800/40"
                  onClick={() => onPick({ spreadsheetId: file.id, name: file.name })}
                >
                  <FileSpreadsheet className="size-4 shrink-0 text-good-500" />
                  <span className="flex-1 truncate text-sm text-ink-100">{file.name}</span>
                  {file.modifiedTime && (
                    <span className="shrink-0 text-xs text-ink-500">
                      {new Date(file.modifiedTime).toLocaleDateString()}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
