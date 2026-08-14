"use client";

import { use } from "react";
import Link from "next/link";
import { ArrowLeft, Inbox } from "lucide-react";
import { Banner, EmptyState, PageHeader, Spinner } from "@/components/ui";
import CampaignCard from "@/components/CampaignCard";
import { useConsole } from "@/lib/use-console";

export default function FolderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { campaigns, folders, error, flash, busyId, setStatus, runNow } = useConsole();

  const folder = folders.find((candidate) => candidate.id === id);
  const inFolder = campaigns?.filter((campaign) => campaign.folderId === id) ?? [];

  return (
    <>
      <PageHeader
        title={folder?.name ?? "Folder"}
        subtitle={folder?.note || `${inFolder.length} campaign${inFolder.length === 1 ? "" : "s"}`}
      >
        <Link href="/" className="btn btn-ghost">
          <ArrowLeft size={15} />
          All campaigns
        </Link>
      </PageHeader>

      <div className="space-y-4 px-4 sm:px-8 py-6">
        {error && <Banner tone="error">{error}</Banner>}
        {flash && <Banner tone="info">{flash}</Banner>}

        {campaigns === null && (
          <div className="flex items-center gap-2 text-sm text-ink-400">
            <Spinner /> Loading campaigns…
          </div>
        )}

        {campaigns !== null && inFolder.length === 0 && (
          <EmptyState
            icon={<Inbox size={20} />}
            title="Nothing filed here yet"
            body="Open a campaign and set its folder to move it into this one."
          />
        )}

        <div className="grid gap-4 xl:grid-cols-2">
          {inFolder.map((campaign) => (
            <CampaignCard
              key={campaign.id}
              campaign={campaign}
              busy={busyId === campaign.id}
              onSetStatus={setStatus}
              onRunNow={runNow}
            />
          ))}
        </div>
      </div>
    </>
  );
}
