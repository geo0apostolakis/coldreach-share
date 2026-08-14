"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      window.location.href = "/";
      return;
    }
    const data = await res.json().catch(() => ({ error: "Login failed" }));
    setError(data.error ?? "Login failed");
    setBusy(false);
  }

  return (
    <div className="grid min-h-screen place-items-center px-4">
      <form onSubmit={submit} className="card w-full max-w-sm p-7">
        <div className="mb-6 flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/automatesphere-logo.png" alt="Automatesphere" className="h-10 w-10 shrink-0" />
          <div>
            <div className="text-[15px] font-semibold tracking-tight">Automatesphere AI Console</div>
            <div className="text-xs text-ink-400">Sign in to continue</div>
          </div>
        </div>

        <label className="lbl" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          type="password"
          autoFocus
          className="field"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {error && <p className="mt-3 text-sm text-bad-500">{error}</p>}

        <button type="submit" className="btn btn-primary mt-5 w-full" disabled={busy || !password}>
          {busy && <Loader2 size={15} className="animate-spin" />}
          Sign in
        </button>
      </form>
    </div>
  );
}
