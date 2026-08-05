"use client";

import Link from "next/link";

export default function SignupSuccessPage() {
  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)] flex items-center justify-center px-6 py-10">
      <div className="max-w-xl rounded-3xl bg-[var(--surface)] p-10 shadow-2xl ring-1 ring-white/10 text-center">
        <h1 className="text-4xl font-semibold">Signup complete</h1>
        <p className="mt-4 text-[var(--muted)]">
          Your student account is set up. Check your email for a confirmation and then sign in to continue to your dashboard.
        </p>
        <div className="mt-6 rounded-3xl border border-emerald-100/80 bg-emerald-50 p-5 text-left text-sm text-emerald-800">
          <p className="font-semibold">Next step</p>
          <p className="mt-2">If your inbox does not show the confirmation right away, wait a few minutes or check your spam folder.</p>
        </div>
        <div className="mt-8 flex flex-col gap-4 sm:flex-row justify-center">
          <Link
            href="/auth/signin"
            className="rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-[var(--surface)] hover:brightness-110"
          >
            Sign in now
          </Link>
          <Link
            href="/"
            className="rounded-full border border-[var(--border)] px-5 py-3 text-sm font-semibold text-[var(--foreground)] hover:bg-[var(--surface)]"
          >
            Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}
