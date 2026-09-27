"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AdminLoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Wrong password");
      router.push("/admin");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Wrong password");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-[var(--navy)] px-6">
      <div className="w-full max-w-sm rounded-sm bg-white p-8">
        <h1 className="font-serif-display text-xl font-semibold text-[var(--navy)]">Office sign-in</h1>
        <p className="mt-1 text-xs text-[var(--ink-soft)]">ÖSD Examination Centre back office</p>
        {error && <p className="mt-4 rounded-sm bg-[var(--red-soft)] px-3 py-2 text-xs text-[var(--red)]">{error}</p>}
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Password"
          className="mt-4 w-full rounded-sm border border-[var(--line)] px-3 py-2.5 text-sm"
          autoFocus
        />
        <button
          onClick={submit}
          disabled={!password || busy}
          className="mt-3 w-full rounded-sm bg-[var(--navy)] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </div>
    </div>
  );
}
