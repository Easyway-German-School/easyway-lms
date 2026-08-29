"use client";

import { useState } from "react";
import Link from "next/link";

/**
 * Ask for a reset link.
 *
 * The success state is shown for any well-formed address, including ones with
 * no account. That is the same rule the endpoint follows, and it has to be
 * kept here too — a form that said "no such account" would give away exactly
 * what the API is careful not to.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/password/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (res.status === 429) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? "Too many requests. Please try again later.");
        return;
      }

      setSent(true);
    } catch {
      setError("Could not reach the server. Please check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--background)] p-6">
      <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--card)] p-8 shadow-sm">
        {sent ? (
          <>
            <h1 className="text-2xl font-semibold text-[var(--foreground)]">Check your email</h1>
            <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">
              If <span className="font-medium text-[var(--foreground)]">{email}</span> has an
              account, a reset link is on its way. It works once and expires in an hour.
            </p>
            <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">
              Nothing arrived? Check your spam folder, then try again — and make sure you used the
              address the school has on record for you.
            </p>
            <Link
              href="/auth/signin"
              className="mt-6 inline-block text-sm font-medium text-[var(--accent)] hover:underline"
            >
              Back to sign in
            </Link>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-semibold text-[var(--foreground)]">Forgot your password?</h1>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Enter your email address and we will send you a link to choose a new one.
            </p>

            <form onSubmit={submit} className="mt-6 space-y-4">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-[var(--foreground)]">
                  Email address
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-4 py-2 text-[var(--foreground)] placeholder-[var(--muted)]"
                  placeholder="you@example.com"
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
                {busy ? "Sending…" : "Send reset link"}
              </button>
            </form>

            <Link
              href="/auth/signin"
              className="mt-5 inline-block text-sm font-medium text-[var(--accent)] hover:underline"
            >
              Back to sign in
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
