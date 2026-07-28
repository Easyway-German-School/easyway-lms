"use client";

import { useState, Suspense } from "react";
import { getSession, signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

function SignInContent() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"student" | "lecturer">("student");
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
        role,
        redirect: false,
      });

      if (!result?.ok) {
        throw new Error(result?.error || "Sign in failed");
      }

      const session = await getSession();
      const sessionRole = (session?.user?.role as string | undefined)?.toUpperCase();
      const targetPath = sessionRole === "LECTURER" || sessionRole === "ADMIN" ? "/lecturer" : "/dashboard";
      router.push(targetPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--background)] flex items-center justify-center px-6">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-[var(--foreground)]">EASYWAY LMS</h1>
          <p className="mt-2 text-[var(--muted)]">Choose your portal and sign in</p>
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

          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setRole("student")}
              className={`rounded-xl border px-4 py-3 text-sm font-semibold transition-all ${
                role === "student"
                  ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                  : "border-[var(--border)] bg-[var(--surface-alt)] text-[var(--muted)]"
              }`}
            >
              🎓 Student
            </button>
            <button
              type="button"
              onClick={() => setRole("lecturer")}
              className={`rounded-xl border px-4 py-3 text-sm font-semibold transition-all ${
                role === "lecturer"
                  ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                  : "border-[var(--border)] bg-[var(--surface-alt)] text-[var(--muted)]"
              }`}
            >
              👩‍🏫 Lecturer
            </button>
          </div>

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
            <label htmlFor="password" className="block text-sm font-medium text-[var(--muted)]">
              Password
            </label>
            <input
              id="password"
              type="password"
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
            {loading ? "Signing in..." : `Sign in as ${role === "lecturer" ? "Lecturer" : "Student"}`}
          </button>
        </form>

        <div className="text-center text-[var(--muted)]">
          Don't have an account?{" "}
          <Link href="/auth/signup" className="text-[var(--accent)] hover:underline">
            Sign Up
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-950 flex items-center justify-center"><p>Loading...</p></div>}>
      <SignInContent />
    </Suspense>
  );
}
