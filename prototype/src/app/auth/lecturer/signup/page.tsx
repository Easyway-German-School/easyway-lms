"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import PasswordInput from "@/components/PasswordInput";

export default function LecturerSignUp() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!name || !email || !password) return setError("All fields are required");
    if (password.length < 8) return setError("Password must be at least 8 characters");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password, role: "lecturer" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as any).error || "Signup failed");

      // Auto sign in
      const result = await signIn("credentials", { email, password, role: "lecturer", redirect: false });
      if (result?.ok) {
        router.replace("/lecturer/dashboard");
      } else {
        router.replace("/auth/lecturer/signin");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create account");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--background)] flex items-center justify-center px-6 py-10">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-[var(--foreground)]">Lecturer Signup</h1>
          <p className="mt-2 text-[var(--muted)]">Create a lecturer account to access the instructor portal.</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl bg-[var(--surface)] p-6">
          {error ? <div className="rounded-xl bg-rose-500/10 p-3 text-sm text-rose-700">{error}</div> : null}
          <div>
            <label className="text-sm text-[var(--muted)]">Full name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 bg-white" />
          </div>
          <div>
            <label className="text-sm text-[var(--muted)]">Email</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 bg-white" />
          </div>
          <div>
            <label className="text-sm text-[var(--muted)]">Password</label>
            <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 bg-white" />
          </div>
          <div className="flex items-center justify-between">
            <button type="submit" disabled={loading} className="rounded-xl bg-[var(--accent)] px-6 py-3 text-sm font-semibold text-white">
              {loading ? "Creating…" : "Create Lecturer Account"}
            </button>
            <a href="/auth/lecturer/signin" className="text-sm text-[var(--muted)]">Already have an account?</a>
          </div>
        </form>
      </div>
    </div>
  );
}
