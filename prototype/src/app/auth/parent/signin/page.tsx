"use client";

import { useState, Suspense } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import BrandLoader from "@/components/BrandLoader";
import PasswordInput from "@/components/PasswordInput";
import { FamilyIcon } from "@/components/icons";

function ParentSignInContent() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const message = searchParams.get("message");

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const result = await signIn("credentials", {
        email,
        password,
        role: "parent",
        redirect: false,
      });

      if (!result?.ok) {
        throw new Error(result?.error || "Sign in failed");
      }

      router.push("/parent/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <BrandLoader fullscreen size="lg" title="Signing you in…" message="Taking you to your parent dashboard." />;
  }

  return (
    <div className="min-h-screen bg-[var(--background)] flex items-center justify-center px-6">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]">
            <FamilyIcon className="h-7 w-7" />
          </span>
          <h1 className="mt-4 text-4xl font-bold text-[var(--foreground)]">EASYWAY LMS</h1>
          <p className="mt-2 text-[var(--muted)]">Parent / Guardian login</p>
        </div>

        <form onSubmit={handleSignIn} className="space-y-6 bg-[var(--surface)] p-8 rounded-2xl shadow-xl ring-1 ring-white/10">
          {message && (
            <div className="p-4 bg-[var(--accent)]/15 text-[var(--accent)] rounded-lg text-sm">
              {message}
            </div>
          )}

          {error && (
            <div className="p-4 bg-rose-500/15 text-rose-200 rounded-lg text-sm">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="email" className="block text-sm font-medium text-[var(--muted)]">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="mt-2 w-full px-4 py-2 bg-[var(--surface-alt)] border border-[var(--border)] rounded-lg text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)]"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <div className="flex items-baseline justify-between gap-3">
              <label htmlFor="password" className="block text-sm font-medium text-[var(--muted)]">
                Password
              </label>
              <a href="/auth/forgot" className="text-xs font-medium text-[var(--accent)] hover:underline">
                Forgot password?
              </a>
            </div>
            <PasswordInput
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="mt-2 w-full px-4 py-2 bg-[var(--surface-alt)] border border-[var(--border)] rounded-lg text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)]"
              placeholder="Your password"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-[var(--accent)] hover:brightness-110 text-[var(--surface)] font-semibold rounded-lg disabled:opacity-60"
          >
            {loading ? "Signing in..." : "Sign in as Parent"}
          </button>
        </form>

        <div className="space-y-3 text-center text-[var(--muted)]">
          <p>
            New here?{' '}
            <Link href="/auth/parent/signup" className="text-[var(--accent)] hover:underline">
              Create a parent account
            </Link>
          </p>
          <p>
            Are you a student?{' '}
            <Link href="/auth/signin" className="text-[var(--accent)] hover:underline">
              Student sign-in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function ParentSignInPage() {
  return (
    <Suspense fallback={<BrandLoader fill size="lg" />}>
      <ParentSignInContent />
    </Suspense>
  );
}
