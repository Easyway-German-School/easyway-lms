"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { EyeIcon, EyeOffIcon } from "@/components/icons";

export default function AdminLoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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
        <div className="relative mt-4">
          <input
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="Password"
            className="w-full rounded-sm border border-[var(--line)] px-3 py-2.5 pr-10 text-sm"
            autoFocus
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            aria-pressed={showPassword}
            tabIndex={-1}
            className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-[var(--ink-soft)] hover:text-[var(--navy)]"
          >
            {showPassword ? <EyeOffIcon className="h-[18px] w-[18px]" /> : <EyeIcon className="h-[18px] w-[18px]" />}
          </button>
        </div>
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
