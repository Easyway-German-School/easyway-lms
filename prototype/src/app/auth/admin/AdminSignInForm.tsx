"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import BrandLoader from "@/components/BrandLoader";
import PasswordInput from "@/components/PasswordInput";

export default function AdminSignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const message = searchParams.get("message");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  /**
   * Only true once the server has told us this account has a second factor.
   *
   * The field is deliberately not shown up front: whether an account carries
   * two-factor is worth knowing to somebody working through a list of stolen
   * addresses, and there is no reason to answer that question before a correct
   * password has been presented.
   */
  const [needsCode, setNeedsCode] = useState(false);
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
        totp,
        role: "admin",
        redirect: false,
      });

      if (!result?.ok) {
        // These strings are thrown by authorize() in src/lib/auth.ts and passed
        // through by NextAuth verbatim. Keep the two in step.
        if (result?.error === "MFA_REQUIRED") {
          setNeedsCode(true);
          setError(null);
          setLoading(false);
          return;
        }

        if (result?.error === "MFA_INVALID") {
          setNeedsCode(true);
          setTotp("");
          setError("That code was not accepted. Codes can only be used once — wait for the next one.");
          setLoading(false);
          return;
        }

        if (result?.error === "MFA_ENROLMENT_REQUIRED") {
          setError(
            "This account must have two-factor authentication set up before it can be used. Ask a super admin to enrol it, or turn MFA_ENFORCED off temporarily to get back in.",
          );
          setLoading(false);
          return;
        }

        setError(result?.error || "Unable to sign in. Check your email and password.");
        setLoading(false);
        return;
      }

      // Loading stays true here: the page is about to navigate away, so
      // flipping it off would flash the form back for a frame before the
      // redirect lands.
      router.push("/admin");
    } catch {
      // A network hiccup, a slow serverless function, or a non-JSON response
      // from a timed-out request all land here. Without this catch the loader
      // above never clears and the page looks hung forever.
      setError("Sign-in is taking too long or the connection dropped. Please try again.");
      setLoading(false);
    }
  };

  if (loading) {
    return <BrandLoader fullscreen size="lg" title="Anmeldung läuft…" message="Signing you in to the admin console." />;
  }

  return (
    <div className="min-h-screen bg-[linear-gradient(135deg,_#f5f5f5_0%,_#fffbf8_100%)] px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-6xl flex-col overflow-hidden rounded-[32px] border border-[var(--border)] bg-[var(--surface)] shadow-[0_30px_80px_-24px_rgba(13,124,126,0.28)] lg:flex-row">
        <div className="relative hidden flex-1 flex-col justify-between bg-gradient-to-br from-[#FF6600] via-[#FF8533] to-[#FFB380] p-8 text-white lg:flex">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(255,255,255,0.2),_transparent_35%)]" />
          <div className="relative z-10">
            <div className="inline-flex items-center rounded-full border border-white/20 bg-white/10 px-3 py-1 text-sm font-medium text-white/90">
              Admin Portal
            </div>
            <h1 className="mt-8 text-4xl font-semibold leading-tight">Manage Easyway with confidence.</h1>
            <p className="mt-4 max-w-md text-sm leading-6 text-slate-100">
              Access admin dashboards, manage lecturers, students, and system settings in one organized interface.
            </p>
          </div>
          <div className="relative z-10 rounded-2xl border border-white/15 bg-white/10 p-4 backdrop-blur">
            <p className="text-sm font-medium">Admin Features</p>
            <ul className="mt-3 space-y-2 text-sm text-slate-100">
              <li>• Lecturer management</li>
              <li>• Student oversight</li>
              <li>• System analytics</li>
            </ul>
          </div>
        </div>

        <div className="flex-1 p-6 sm:p-8 lg:p-10">
          <div className="mx-auto max-w-md">
            <div className="mb-8">
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-[#FF6600]">Admin Access</p>
              <h2 className="mt-2 text-3xl font-semibold text-[var(--foreground)]">Sign in to admin panel</h2>
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]">Access administrative features and manage the platform.</p>
            </div>

            <form className="space-y-4" onSubmit={handleSignIn}>
              {message ? (
                <div className="rounded-3xl border border-[#FF6600]/15 bg-[#FF6600]/5 p-4 text-sm text-[var(--foreground)]">{message}</div>
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
                  className="w-full rounded-2xl border border-[var(--border)] bg-[var(--surface-alt)] px-4 py-3 text-sm text-[var(--foreground)] shadow-sm outline-none transition focus:border-[#FF6600] focus:bg-[var(--surface)] focus:ring-4 focus:ring-[#FF6600]/20"
                  placeholder="admin@example.com"
                />
              </div>

              <div>
                <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-[var(--foreground)]">Password</label>
                <PasswordInput
                  id="password"
                                    value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  className="w-full rounded-2xl border border-[var(--border)] bg-[var(--surface-alt)] px-4 py-3 text-sm text-[var(--foreground)] shadow-sm outline-none transition focus:border-[#FF6600] focus:bg-[var(--surface)] focus:ring-4 focus:ring-[#FF6600]/20"
                  placeholder="Your password"
                />
              </div>

              {needsCode ? (
                <div>
                  <label htmlFor="totp" className="mb-1.5 block text-sm font-medium text-[var(--foreground)]">
                    Authentication code
                  </label>
                  <input
                    id="totp"
                    // Not type="number": that strips the leading zero a TOTP
                    // code can legitimately start with, and offers a spinner on
                    // a value nobody wants to nudge up and down.
                    type="text"
                    inputMode="text"
                    autoComplete="one-time-code"
                    autoFocus
                    value={totp}
                    onChange={(event) => setTotp(event.target.value)}
                    required
                    className="w-full rounded-2xl border border-[var(--border)] bg-[var(--surface-alt)] px-4 py-3 text-center text-lg tracking-[0.4em] text-[var(--foreground)] shadow-sm outline-none transition focus:border-[#FF6600] focus:bg-[var(--surface)] focus:ring-4 focus:ring-[#FF6600]/20"
                    placeholder="000000"
                  />
                  <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
                    From your authenticator app. Lost your phone? Enter one of your backup codes instead.
                  </p>
                </div>
              ) : null}

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-2xl bg-[#FF6600] px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-[#FF6600]/20 transition hover:bg-[#FF5500] disabled:opacity-60"
              >
                {loading ? "Signing in..." : needsCode ? "Verify and sign in" : "Sign in"}
              </button>
            </form>

            <div className="mt-6 text-sm text-[var(--muted)]">
              <p>
                <Link href="/auth/signin" className="font-semibold text-[#FF6600] hover:text-[#FF5500]">Student login</Link>
              </p>
              <p className="mt-2">
                <Link href="/auth/lecturer/signin" className="font-semibold text-[#FF6600] hover:text-[#FF5500]">Lecturer login</Link>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
