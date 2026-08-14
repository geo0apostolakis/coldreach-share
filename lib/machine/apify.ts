import { getRuntimeValue, setRuntimeValue } from "../runtime";

const API = "https://api.apify.com/v2";
const TOKEN_KEY = "apifyToken";

/** Poll interval and ceiling for a single actor run. A 13-page harvest takes minutes. */
const POLL_MS = 3_000;
const RUN_TIMEOUT_MS = 10 * 60_000;

/**
 * Runtime tab first, env second. The Runtime tab is what the Settings UI writes,
 * so George can swap a spent free-tier key without a redeploy or a restart.
 */
export async function getApifyToken(): Promise<string> {
  const stored = (await getRuntimeValue(TOKEN_KEY)).trim();
  if (stored) return stored;
  const fallback = (process.env.APIFY_TOKEN ?? "").trim();
  if (!fallback) throw new Error("No Apify token. Add one in Lead Machine settings.");
  return fallback;
}

export async function setApifyToken(token: string): Promise<void> {
  await setRuntimeValue(TOKEN_KEY, token.trim());
}

export type ApifyAccount = {
  username: string;
  plan: string;
  monthlyLimitUsd: number;
  spentUsd: number;
  remainingUsd: number;
};

/** Powers the "Test key" button: proves the token works and shows what is left. */
export async function checkApifyToken(token?: string): Promise<ApifyAccount> {
  const key = token?.trim() || (await getApifyToken());

  const meRes = await fetch(`${API}/users/me?token=${encodeURIComponent(key)}`);
  if (!meRes.ok) throw new Error(`Apify rejected the token (${meRes.status})`);
  const me = (await meRes.json()) as {
    data?: { username?: string; plan?: { id?: string; maxMonthlyUsageUsd?: number } };
  };

  const usageRes = await fetch(`${API}/users/me/usage/monthly?token=${encodeURIComponent(key)}`);
  const usage = usageRes.ok
    ? ((await usageRes.json()) as { data?: { totalUsageCreditsUsdAfterVolumeDiscount?: number } })
    : { data: {} };

  const limit = me.data?.plan?.maxMonthlyUsageUsd ?? 0;
  const spent = usage.data?.totalUsageCreditsUsdAfterVolumeDiscount ?? 0;

  return {
    username: me.data?.username ?? "unknown",
    plan: me.data?.plan?.id ?? "unknown",
    monthlyLimitUsd: limit,
    spentUsd: Number(spent.toFixed(4)),
    remainingUsd: Number((limit - spent).toFixed(4)),
  };
}

export type ActorRunResult<T> = {
  items: T[];
  runId: string;
  costUsd: number;
};

/**
 * Starts an actor, polls to completion, then reads its dataset.
 *
 * Deliberately not `run-sync-get-dataset-items`: that endpoint dies at 300s and a
 * full 13-page harvest can exceed it, which would burn credit on a run whose
 * results we then throw away.
 */
export async function runActor<T>(
  actorId: string,
  input: unknown,
  signal?: AbortSignal,
): Promise<ActorRunResult<T>> {
  const token = await getApifyToken();
  const q = `token=${encodeURIComponent(token)}`;

  const startRes = await fetch(`${API}/acts/${actorId}/runs?${q}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal,
  });
  if (!startRes.ok) {
    const detail = await startRes.text().catch(() => "");
    throw new Error(`Apify start failed (${startRes.status}): ${detail.slice(0, 300)}`);
  }

  const started = (await startRes.json()) as { data?: { id?: string; defaultDatasetId?: string } };
  const runId = started.data?.id;
  const datasetId = started.data?.defaultDatasetId;
  if (!runId || !datasetId) throw new Error("Apify did not return a run id");

  const deadline = Date.now() + RUN_TIMEOUT_MS;
  let status = "READY";
  let costUsd = 0;

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    if (signal?.aborted) throw new Error("Run cancelled");

    const pollRes = await fetch(`${API}/actor-runs/${runId}?${q}`, { signal });
    if (!pollRes.ok) continue;
    const poll = (await pollRes.json()) as {
      data?: { status?: string; usageTotalUsd?: number };
    };
    status = poll.data?.status ?? status;
    costUsd = poll.data?.usageTotalUsd ?? costUsd;
    if (status !== "READY" && status !== "RUNNING") break;
  }

  if (status !== "SUCCEEDED") {
    throw new Error(`Apify run ${runId} ended as ${status}`);
  }

  // usageTotalUsd has not settled at the moment a run flips to SUCCEEDED. Measured
  // 2026-07-28: a harvest that actually cost $0.1011 still read $0.001 here. One
  // delayed re-read fixes it, and the Runs tab is the only cost record we keep.
  await new Promise((resolve) => setTimeout(resolve, 4_000));
  const finalRes = await fetch(`${API}/actor-runs/${runId}?${q}`, { signal });
  if (finalRes.ok) {
    const final = (await finalRes.json()) as { data?: { usageTotalUsd?: number } };
    costUsd = final.data?.usageTotalUsd ?? costUsd;
  }

  const itemsRes = await fetch(`${API}/datasets/${datasetId}/items?${q}&clean=true`, { signal });
  if (!itemsRes.ok) throw new Error(`Apify dataset read failed (${itemsRes.status})`);
  const items = (await itemsRes.json()) as T[];

  return { items, runId, costUsd: Number(costUsd.toFixed(4)) };
}
