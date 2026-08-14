import type { Campaign, LogEntry } from "./types";

export type CampaignView = Campaign & {
  quota: number;
  leads: { total: number; pending: number; sent: number; headers?: string[] };
};

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json", ...init?.headers } : init?.headers,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

export type { LogEntry };
