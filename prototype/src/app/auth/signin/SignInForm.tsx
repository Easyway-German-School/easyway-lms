"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import BrandLoader from "@/components/BrandLoader";
import PasswordInput from "@/components/PasswordInput";
import BrandLogo from "@/components/BrandLogo";

export default function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const message = searchParams.get("message");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSignIn = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const result = await signIn("credentials", {
        email,
        password,
        role: "student",
        redirect: false,
      });

      if (!result?.ok) {
        setError(result?.error || "Unable to sign in. Check your email and password.");
        setLoading(false);
        return;
      }

      // Candidates have no student portal to land in.
      const me = await fetch("/api/auth/session", { cache: "no-store" }).then((r) => r.json()).catch(() => null);
      const role = String(me?.user?.role ?? "").toLowerCase();
      router.push(role === "candidate" ? "/candidate" : "/dashboard");
    } catch {
      // A network hiccup, a slow serverless function, or a non-JSON response
      // from a timed-out request all land here. Without this catch the loader
      // above never clears and the page looks hung forever.
      setError("Sign-in is taking too long or the connection dropped. Please try again.");
      setLoading(false);
    }
  };

  if (loading) {
    return <BrandLoader fullscreen size="lg" title="Anmeldung läuft…" message="Signing you in — one moment." />;
  }

  return (
    <div className="min-h-screen bg-[linear-gradient(135deg,_#f5f5f5_0%,_#fffbf8_100%)] px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-6xl flex-col overflow-hidden rounded-[32px] border border-[var(--border)] bg-[var(--surface)] shadow-[0_30px_80px_-24px_rgba(13,124,126,0.28)] lg:flex-row">
        <div className="relative hidden flex-1 flex-col justify-between bg-gradient-to-br from-[var(--accent-strong)] via-[var(--accent)] to-[#FF8533] p-8 text-white lg:flex">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(255,255,255,0.2),_transparent_35%)]" />
          <div className="relative z-10">
            {/* The artwork has a white background, so it needs a white chip
                to sit on rather than the orange gradient. */}
            <div className="inline-flex items-center rounded-2xl bg-white px-4 py-3 shadow-lg shadow-black/10">
              <BrandLogo variant="wordmark" className="h-10" />
            </div>
            <h1 className="mt-8 text-4xl font-semibold leading-tight">Continue your German learning journey with confidence.</h1>
            <p className="mt-4 max-w-md text-sm leading-6 text-slate-100">
              Access your courses, join the community, and prepare for exams in one calm, beautifully organized dashboard.
            </p>
          </div>
          <div className="relative z-10 rounded-2xl border border-white/15 bg-white/10 p-4 backdrop-blur">
            <p className="text-sm font-medium">Why students love Easyway</p>
            <ul className="mt-3 space-y-2 text-sm text-slate-100">
              <li>• Personalized learning tracks</li>
              <li>• Live session scheduling</li>
              <li>• Fast progress tracking</li>
            </ul>
          </div>
        </div>

        <div className="flex-1 p-6 sm:p-8 lg:p-10">
          <div className="mx-auto max-w-md">
            <div className="mb-8">
              {/* The branded panel is hidden below lg, so the logo appears
                  here too — otherwise mobile sign-in has no identity at all. */}
              <div className="mb-6 lg:hidden">
                <BrandLogo variant="wordmark" className="h-10" />
              </div>
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-[var(--accent)]">Welcome back</p>
              <h2 className="mt-2 text-3xl font-semibold text-[var(--foreground)]">Sign in to your account</h2>
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]">Continue your academic plan with a secure and modern experience.</p>
            </div>

            <form className="space-y-4" onSubmit={handleSignIn}>
              {message ? (
                <div className="rounded-3xl border border-[var(--accent)]/15 bg-[var(--accent-soft)] p-4 text-sm text-[var(--foreground)]">{message}</div>
              ) : null}
              {error ? (
                <div className="rounded-3xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
              ) : null}

              <div>
                <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-[var(--foreground)]">Email</label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  className="w-full rounded-2xl border border-[var(--border)] bg-[var(--surface-alt)] px-4 py-3 text-sm text-[var(--foreground)] shadow-sm outline-none transition focus:border-[var(--accent)] focus:bg-[var(--surface)] focus:ring-4 focus:ring-[var(--accent-soft)]"
                  placeholder="you@example.com"
                />
              </div>

              <div>
                <div className="mb-1.5 flex items-baseline justify-between gap-3">
                  <label htmlFor="password" className="block text-sm font-medium text-[var(--foreground)]">Password</label>
                  {/* Beside the field rather than below the button: somebody who
                      cannot remember their password realises it here, not after
                      failing to sign in. */}
                  <Link href="/auth/forgot" className="text-xs font-medium text-[var(--accent)] hover:underline">
                    Forgot password?
                  </Link>
                </div>
                <PasswordInput
                  id="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  className="w-full rounded-2xl border border-[var(--border)] bg-[var(--surface-alt)] px-4 py-3 text-sm text-[var(--foreground)] shadow-sm outline-none transition focus:border-[var(--accent)] focus:bg-[var(--surface)] focus:ring-4 focus:ring-[var(--accent-soft)]"
                  placeholder="Your password"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-2xl bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-[var(--accent)]/20 transition hover:bg-[var(--accent-strong)] disabled:opacity-60"
              >
                {loading ? "Signing in..." : "Sign in"}
              </button>
            </form>

            <div className="mt-6 text-sm text-[var(--muted)]">
              <p>
                Don’t have an account? <Link href="/auth/signup" className="font-semibold text-[var(--accent)] hover:text-[var(--accent-strong)]">Sign up</Link>
              </p>
              <p className="mt-2">Lecturer? <Link href="/auth/lecturer/signin" className="font-semibold text-[var(--accent)] hover:text-[var(--accent-strong)]">Sign in here</Link></p>
              <p className="mt-2">Parent or guardian? <Link href="/auth/parent/signin" className="font-semibold text-[var(--accent)] hover:text-[var(--accent-strong)]">Sign in here</Link></p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
