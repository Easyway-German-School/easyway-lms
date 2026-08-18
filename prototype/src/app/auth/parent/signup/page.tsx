"use client";

import { useState } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import PasswordInput from "@/components/PasswordInput";
import BrandLoader from "@/components/BrandLoader";
import { FamilyIcon } from "@/components/icons";

export default function ParentSignUp() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [childName, setChildName] = useState("");
  const [childEmail, setChildEmail] = useState("");
  const [childStudentCode, setChildStudentCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!name.trim() || !email.trim() || !password || !phone.trim() || !childName.trim()) {
      setError("Please fill in your details, your phone number and your child's name.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (!childEmail.trim() && !childStudentCode.trim()) {
      setError("Please provide your child's registered email or their student code.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/signup/parent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          password,
          phone,
          childName,
          childEmail,
          childStudentCode,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error || "Signup failed");

      const result = await signIn("credentials", { email, password, role: "parent", redirect: false });
      if (result?.ok) {
        router.replace("/parent/dashboard");
      } else {
        router.replace("/auth/parent/signin?message=Account%20created.%20Please%20sign%20in.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create account");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <BrandLoader fullscreen size="lg" title="Setting up your account…" message="Creating your parent login." />;
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(255,102,0,0.12),_transparent_35%),linear-gradient(180deg,_#f5f5f5_0%,_#ffffff_100%)] flex items-center justify-center px-4 py-12 sm:px-6">
      <div className="w-full max-w-lg space-y-6">
        <div className="text-center">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]">
            <FamilyIcon className="h-7 w-7" />
          </span>
          <h1 className="mt-4 text-2xl font-bold text-[var(--foreground)]">Parent / Guardian sign up</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Create your own login to follow your child's classes, attendance and updates.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 rounded-[28px] bg-white/95 p-6 shadow-[0_30px_80px_-24px_rgba(15,23,42,0.18)] ring-1 ring-slate-200/70 sm:p-8">
          {error ? <div className="rounded-xl bg-rose-500/10 p-4 text-sm text-rose-700">{error}</div> : null}

          <div className="space-y-4">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[var(--muted)]">Your details</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-semibold text-[var(--muted)]">Full name</label>
                <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 bg-white" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-[var(--muted)]">Phone</label>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" className="mt-1 w-full rounded-xl border px-3 py-2 bg-white" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-semibold text-[var(--muted)]">Email</label>
              <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" className="mt-1 w-full rounded-xl border px-3 py-2 bg-white" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-[var(--muted)]">Create password</label>
              <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 bg-white" />
            </div>
          </div>

          <div className="space-y-4 border-t border-slate-200/70 pt-5">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[var(--muted)]">Your child</p>
            <p className="text-xs text-[var(--muted)]">
              We use this to link your account to your child's record. The school confirms the link before you can see anything.
            </p>
            <div>
              <label className="block text-sm font-semibold text-[var(--muted)]">Child's name</label>
              <input value={childName} onChange={(e) => setChildName(e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 bg-white" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-semibold text-[var(--muted)]">Child's registered email</label>
                <input value={childEmail} onChange={(e) => setChildEmail(e.target.value)} type="email" className="mt-1 w-full rounded-xl border px-3 py-2 bg-white" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-[var(--muted)]">or child's student code</label>
                <input value={childStudentCode} onChange={(e) => setChildStudentCode(e.target.value)} placeholder="e.g. EW/2026/A1/JUL/0007" className="mt-1 w-full rounded-xl border px-3 py-2 bg-white" />
              </div>
            </div>
          </div>

          <div className="flex flex-col-reverse gap-3 border-t border-slate-200/70 pt-5 sm:flex-row sm:items-center sm:justify-between">
            <Link href="/auth/parent/signin" className="text-sm font-medium text-[var(--muted)] underline-offset-4 transition hover:text-[var(--foreground)] hover:underline">
              I already have a parent account
            </Link>
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-gradient-to-r from-[#0D7C7E] to-[#FF6600] px-8 py-3.5 text-sm font-bold text-white shadow-lg shadow-[#FF6600]/20 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              {loading ? "Creating…" : "Create parent account"}
            </button>
          </div>
        </form>

        <p className="text-center text-sm text-[var(--muted)]">
          Not a parent? <Link href="/auth/signup" className="font-semibold text-[var(--accent)] hover:underline">Student sign up</Link>
        </p>
      </div>
    </div>
  );
}
