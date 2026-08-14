"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type CampaignView } from "./client";
import type { Folder } from "./types";

/**
 * One fetch of /api/campaigns serves the dashboard, the folder cards and every
 * folder page. That route already reads each campaign's whole leads tab, so a
 * second fan-out per folder card would double an expensive call for nothing.
 */
export function useConsole() {
  const [campaigns, setCampaigns] = useState<CampaignView[] | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");
  const [busyId, setBusyId] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api<{ campaigns: CampaignView[] }>("/api/campaigns"),
      api<{ folders: Folder[] }>("/api/folders").catch(() => ({ folders: [] as Folder[] })),
    ])
      .then(([campaignData, folderData]) => {
        if (cancelled) return;
        setCampaigns(campaignData.campaigns);
        setFolders(folderData.folders);
        setError("");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load campaigns");
        setCampaigns([]);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const reload = useCallback(() => setReloadKey((key) => key + 1), []);

  const setStatus = useCallback(
    async (campaign: CampaignView, status: "running" | "paused") => {
      setBusyId(campaign.id);
      try {
        await api(`/api/campaigns/${campaign.id}`, {
          method: "PATCH",
          body: JSON.stringify({ status }),
        });
        reload();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to update campaign");
      } finally {
        setBusyId("");
      }
    },
    [reload],
  );

  const runNow = useCallback(
    async (campaign: CampaignView) => {
      setBusyId(campaign.id);
      setFlash("");
      try {
        const result = await api<{
          busy?: boolean;
          results: { action: string; reason?: string; email?: string }[];
        }>(`/api/campaigns/${campaign.id}/run-now`, { method: "POST" });
        const first = result.results[0];
        setFlash(
          result.busy
            ? "Another run is in progress. Try again in a moment."
            : !first
              ? "Nothing to send, the campaign isn't running."
              : first.action === "sent"
                ? `Sent to ${first.email}`
                : `${first.action}: ${first.reason ?? ""}`,
        );
        reload();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Run failed");
      } finally {
        setBusyId("");
      }
    },
    [reload],
  );

  return { campaigns, folders, error, flash, busyId, setStatus, runNow, reload, setError, setFlash };
}
