"use client";

import { useState } from "react";
import Link from "next/link";
import { Folder as FolderIcon, FolderPlus, Inbox, Plus } from "lucide-react";
import { Banner, EmptyState, PageHeader, Spinner } from "@/components/ui";
import CampaignCard from "@/components/CampaignCard";
import { api } from "@/lib/client";
import { useConsole } from "@/lib/use-console";

export default function DashboardPage() {
  const { campaigns, folders, error, flash, busyId, setStatus, runNow, reload, setError } =
    useConsole();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  const ungrouped = campaigns?.filter((campaign) => !campaign.folderId) ?? [];

  async function createFolder() {
    if (!newName.trim()) return;
    try {
      await api("/api/folders", { method: "POST", body: JSON.stringify({ name: newName.trim() }) });
      setNewName("");
      setCreating(false);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create folder");
    }
  }

  return (
    <>
      <PageHeader title="Campaigns" subtitle="Group campaigns into folders, one per client or vertical.">
        <button className="btn btn-ghost" onClick={() => setCreating((open) => !open)}>
          <FolderPlus size={15} />
          New folder
        </button>
        <Link href="/campaigns/new" className="btn btn-primary">
          <Plus size={15} />
          New campaign
        </Link>
      </PageHeader>

      <div className="space-y-6 px-4 sm:px-8 py-6">
        {error && <Banner tone="error">{error}</Banner>}
        {flash && <Banner tone="info">{flash}</Banner>}

        {creating && (
          <div className="card flex items-center gap-2 p-4">
            <input
              autoFocus
              className="field flex-1"
              placeholder="Folder name, for example Accounting"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void createFolder();
                if (event.key === "Escape") setCreating(false);
              }}
            />
            <button className="btn btn-primary" onClick={() => void createFolder()}>
              Create
            </button>
            <button className="btn btn-ghost" onClick={() => setCreating(false)}>
              Cancel
            </button>
          </div>
        )}

        {campaigns === null && (
          <div className="flex items-center gap-2 text-sm text-ink-400">
            <Spinner /> Loading campaigns…
          </div>
        )}

        {folders.length > 0 && (
          <section>
            <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-ink-400">
              Folders
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {folders.map((folder) => {
                const inFolder = campaigns?.filter((c) => c.folderId === folder.id) ?? [];
                const sentToday = inFolder.reduce((sum, c) => sum + c.sentToday, 0);
                const pending = inFolder.reduce((sum, c) => sum + c.leads.pending, 0);
                const running = inFolder.filter((c) => c.status === "running").length;
                return (
                  <Link key={folder.id} href={`/folders/${folder.id}`} className="card p-4 hover:border-brand-500/40">
                    <div className="flex items-center gap-2.5">
                      <span className="grid h-8 w-8 place-items-center rounded-lg bg-ink-800 text-brand-400">
                        <FolderIcon size={16} />
                      </span>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">{folder.name}</div>
                        <div className="text-xs text-ink-400">
                          {inFolder.length} campaign{inFolder.length === 1 ? "" : "s"}
                          {running > 0 && `, ${running} running`}
                        </div>
                      </div>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-3 border-t border-ink-700 pt-3 text-center">
                      <div>
                        <div className="text-sm font-semibold tabular-nums">{sentToday}</div>
                        <div className="text-[11px] uppercase tracking-wider text-ink-400">Sent today</div>
                      </div>
                      <div>
                        <div className="text-sm font-semibold tabular-nums">{pending}</div>
                        <div className="text-[11px] uppercase tracking-wider text-ink-400">Waiting</div>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        )}

        {campaigns?.length === 0 && (
          <EmptyState
            icon={<Inbox size={20} />}
            title="No campaigns yet"
            body="Point Automatesphere at a Google Sheet tab, write your email, and it starts sending on a ramp."
          >
            <Link href="/campaigns/new" className="btn btn-primary">
              <Plus size={15} />
              Create your first campaign
            </Link>
          </EmptyState>
        )}

        {ungrouped.length > 0 && (
          <section>
            {folders.length > 0 && (
              <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                Not in a folder
              </h2>
            )}
            <div className="grid gap-4 xl:grid-cols-2">
              {ungrouped.map((campaign) => (
                <CampaignCard
                  key={campaign.id}
                  campaign={campaign}
                  busy={busyId === campaign.id}
                  onSetStatus={setStatus}
                  onRunNow={runNow}
                />
              ))}
            </div>
          </section>
        )}
      </div>
    </>
  );
}
