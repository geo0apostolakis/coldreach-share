"use client";

import { useEffect, useState } from "react";
import { Banner, PageHeader, Spinner } from "@/components/ui";
import MetricsView, { type MetricsPayload } from "@/components/MetricsView";
import SendingVolume from "@/components/SendingVolume";
import { api } from "@/lib/client";
import type { Folder } from "@/lib/types";

export default function BusinessPage() {
  // Tagged with the folder it belongs to, so "is this stale" is derived rather
  // than reset with a setState inside the effect.
  const [data, setData] = useState<{ folderId: string; metrics: MetricsPayload } | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [folderId, setFolderId] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    api<{ folders: Folder[] }>("/api/folders")
      .then((data) => !cancelled && setFolders(data.folders))
      .catch(() => !cancelled && setFolders([]));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    api<{ metrics: MetricsPayload }>(`/api/metrics${folderId ? `?folderId=${folderId}` : ""}`)
      .then((payload) => {
        if (cancelled) return;
        setData({ folderId, metrics: payload.metrics });
        setError("");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load metrics");
      });
    return () => {
      cancelled = true;
    };
  }, [folderId]);

  const metrics = data && data.folderId === folderId ? data.metrics : null;

  return (
    <>
      <PageHeader
        title="Business"
        subtitle="All time. A close this month came from spend two months ago, so a monthly window makes CAC swing."
      >
        {folders.length > 0 && (
          <select
            className="field w-52"
            value={folderId}
            onChange={(event) => setFolderId(event.target.value)}
          >
            <option value="">Everything</option>
            {folders.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.name}
              </option>
            ))}
          </select>
        )}
      </PageHeader>

      <div className="space-y-6 px-4 sm:px-8 py-6">
        {error && <Banner tone="error">{error}</Banner>}
        {metrics === null && !error && (
          <div className="flex items-center gap-2 text-sm text-ink-400">
            <Spinner /> Crunching the numbers…
          </div>
        )}
        {metrics && <MetricsView metrics={metrics} scopedToFolder={Boolean(folderId)} />}

        <section>
          <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-ink-400">
            Deliverability
          </h2>
          <SendingVolume />
        </section>
      </div>
    </>
  );
}
