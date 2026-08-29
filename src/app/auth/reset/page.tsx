"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import PasswordInput from "@/components/PasswordInput";
import { passwordProblem } from "@/lib/password-rules";

/**
 * Choose a new password.
 *
 * `useSearchParams` forces a Suspense boundary in the app router, hence the
 * split — without it the build fails rather than degrades, and it fails only
 * on the production build, which is a bad place to find out.
 */
export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<Shell><p className="text-sm text-[var(--muted)]">Loading…</p></Shell>}>
      <ResetForm />
    </Suspense>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--background)] p-6">
      <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--card)] p-8 shadow-sm">
        {children}
      </div>
    </main>
  );
}

function ResetForm() {
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();

    /**
     * Checked here as well as on the server, using the same function, so the
     * two can never disagree about what a valid password is. The server check
     * is the real one; this exists to save a round trip.
     */
    const problem = passwordProblem(password);
    if (problem) return setError(problem);
    if (password !== confirm) return setError("Those two passwords do not match.");

    setBusy(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/password/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setError(data?.error ?? "Could not reset your password. Please request a new link.");
        return;
      }
      setDone(true);
    } catch {
      setError("Could not reach the server. Please check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <Shell>
        <h1 className="text-2xl font-semibold text-[var(--foreground)]">Link not valid</h1>
        <p className="mt-3 text-sm text-[var(--muted)]">
          This page needs the link from your reset email. Copy the whole link, or request a new one.
        </p>
        <Link href="/auth/forgot" className="mt-6 inline-block text-sm font-medium text-[var(--accent)] hover:underline">
          Request a new link
        </Link>
      </Shell>
    );
  }

  if (done) {
    return (
      <Shell>
        <h1 className="text-2xl font-semibold text-[var(--foreground)]">Password changed</h1>
        <p className="mt-3 text-sm text-[var(--muted)]">
          You can now sign in with your new password.
        </p>
        <Link
          href="/auth/signin"
          className="mt-6 inline-block rounded-lg bg-[var(--accent)] px-4 py-2.5 font-medium text-white"
        >
          Sign in
        </Link>
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 className="text-2xl font-semibold text-[var(--foreground)]">Choose a new password</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">At least 8 characters.</p>

      <form onSubmit={submit} className="mt-6 space-y-4">
        <div>
          <label htmlFor="new-password" className="block text-sm font-medium text-[var(--foreground)]">
            New password
          </label>
          <PasswordInput
            id="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            className="mt-1.5 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-4 py-2 text-[var(--foreground)] placeholder-[var(--muted)]"
          />
        </div>

        <div>
          <label htmlFor="confirm-password" className="block text-sm font-medium text-[var(--foreground)]">
            Confirm new password
          </label>
          <PasswordInput
            id="confirm-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            className="mt-1.5 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-4 py-2 text-[var(--foreground)] placeholder-[var(--muted)]"
          />
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-500">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-[var(--accent)] px-4 py-2.5 font-medium text-white disabled:opacity-60"
        >
          {busy ? "Saving…" : "Change password"}
        </button>
      </form>
    </Shell>
  );
}
