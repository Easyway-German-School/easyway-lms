"use client";

export const dynamic = "force-dynamic";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import BrandLogo from "@/components/BrandLogo";
import PasswordInput from "@/components/PasswordInput";

/** Sets the first password on an account created by an exam booking. */

function ClaimContent() {
  const params = useSearchParams();
  const router = useRouter();
  const email = params.get("email") ?? "";
  const token = params.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function submit() {
    if (password !== confirm) {
      setError("Those passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/candidate/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, token, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not set your password");
      setDone(true);
      setTimeout(() => router.push("/auth/signin"), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md px-6 py-20">
      <BrandLogo variant="wordmark" className="h-10" />

      {done ? (
        <div className="mt-8 rounded-2xl bg-emerald-50 p-6">
          <p className="text-sm font-bold text-emerald-800">Password set</p>
          <p className="mt-2 text-sm text-emerald-700">
            You can now sign in with {email} to see your exam bookings. Taking you to sign in…
          </p>
        </div>
      ) : (
        <>
          <h1 className="mt-8 text-2xl font-bold">Set your password</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            We created an account for <span className="font-semibold">{email}</span> when you booked
            your exam. Choose a password to sign in and check your seat, results and certificate.
          </p>

          {error && <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}

          <div className="mt-6 space-y-3">
            <PasswordInput
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="New password (at least 8 characters)"
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
            />
            <PasswordInput
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Confirm password"
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
            />
          </div>

          <button
            onClick={submit}
            disabled={busy || password.length < 8 || !email || !token}
            className="mt-6 rounded-full bg-slate-900 px-6 py-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            {busy ? "Saving…" : "Set password"}
          </button>
        </>
      )}
    </div>
  );
}

export default function CandidateClaimPage() {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <ClaimContent />
    </Suspense>
  );
}
