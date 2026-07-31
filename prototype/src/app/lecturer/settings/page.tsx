"use client";

export const dynamic = "force-dynamic";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import LecturerShell from "@/components/LecturerShell";
import { SettingsIcon } from "@/components/icons";
import BrandLoader from "@/components/BrandLoader";
import PasswordInput from "@/components/PasswordInput";

/**
 * Settings.
 *
 * The third sidebar link that led nowhere. Kept to the things a tutor can
 * legitimately change about themselves — their details and their password.
 * Which class they teach lives on its own page, because changing it moves a
 * roster and is not a preference.
 */
export default function LecturerSettingsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [email, setEmail] = useState("");
  const [cohortLabel, setCohortLabel] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [specialization, setSpecialization] = useState("");
  const [bio, setBio] = useState("");

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/lecturer/profile", { cache: "no-store" });
      if (res.status === 401) {
        router.push("/auth/lecturer/signin");
        return;
      }
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(payload.error || "Could not load your settings");
        return;
      }
      setName(payload.profile.name || "");
      setEmail(payload.profile.email || "");
      setPhone(payload.profile.phone || "");
      setSpecialization(payload.profile.specialization || "");
      setBio(payload.profile.bio || "");
      setCohortLabel(payload.cohort.assigned ? payload.cohort.label : "");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load your settings");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  async function saveProfile(event: React.FormEvent) {
    event.preventDefault();
    setSavingProfile(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/lecturer/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone, specialization, bio }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || "Could not save your details");
      setNotice("Your details have been saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save your details");
    } finally {
      setSavingProfile(false);
    }
  }

  async function savePassword(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setNotice("");

    if (newPassword !== confirmPassword) {
      setError("Your new passwords do not match");
      return;
    }

    setSavingPassword(true);
    try {
      const res = await fetch("/api/lecturer/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || "Could not change your password");
      setNotice("Your password has been changed.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not change your password");
    } finally {
      setSavingPassword(false);
    }
  }

  if (loading) {
    return (
      <LecturerShell>
        <BrandLoader fill size="lg" title="Einen Moment…" message="Loading your settings." />
      </LecturerShell>
    );
  }

  const inputClass =
    "w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-4 py-2 text-[var(--foreground)] placeholder-[var(--muted)]";

  return (
    <LecturerShell>
      <div className="h-screen overflow-y-auto">
        <div className="border-b border-[var(--border)] bg-gradient-to-r from-[var(--accent)]/20 to-transparent p-6">
          <div className="mx-auto max-w-3xl">
            <h1 className="flex items-center gap-3 text-3xl font-bold text-[var(--foreground)]"><SettingsIcon className="h-7 w-7 text-[var(--accent)]" />Settings</h1>
            <p className="mt-2 text-[var(--muted)]">Your details and your password.</p>
          </div>
        </div>

        <div className="mx-auto max-w-3xl space-y-6 p-6">
          {error ? <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div> : null}
          {notice ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{notice}</div>
          ) : null}

          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">Signed in as</p>
                <p className="mt-1 font-semibold text-[var(--foreground)]">{email}</p>
                <p className="mt-0.5 text-sm text-[var(--muted)]">
                  {cohortLabel ? `Teaching ${cohortLabel}` : "No class assigned yet"}
                </p>
              </div>
              <Link href="/lecturer/classes" className="rounded-lg border border-[var(--border)] px-4 py-2 text-xs font-semibold text-[var(--foreground)]">
                Change my class
              </Link>
            </div>
          </div>

          <form onSubmit={saveProfile} className="space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
            <h2 className="text-lg font-bold text-[var(--foreground)]">Your details</h2>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="name" className="mb-2 block text-sm font-semibold text-[var(--foreground)]">Full name</label>
                <input id="name" value={name} onChange={(event) => setName(event.target.value)} className={inputClass} />
              </div>
              <div>
                <label htmlFor="phone" className="mb-2 block text-sm font-semibold text-[var(--foreground)]">Phone</label>
                <input id="phone" value={phone} onChange={(event) => setPhone(event.target.value)} className={inputClass} />
              </div>
            </div>

            <div>
              <label htmlFor="specialization" className="mb-2 block text-sm font-semibold text-[var(--foreground)]">Specialisation</label>
              <input
                id="specialization"
                value={specialization}
                onChange={(event) => setSpecialization(event.target.value)}
                placeholder="e.g. Goethe exam preparation, B1–B2"
                className={inputClass}
              />
            </div>

            <div>
              <label htmlFor="bio" className="mb-2 block text-sm font-semibold text-[var(--foreground)]">Short bio</label>
              <textarea
                id="bio"
                value={bio}
                onChange={(event) => setBio(event.target.value)}
                placeholder="Shown to your students."
                className={`${inputClass} min-h-[120px]`}
              />
            </div>

            <button
              type="submit"
              disabled={savingProfile}
              className="rounded-lg bg-[var(--accent)] px-6 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
            >
              {savingProfile ? "Saving…" : "Save my details"}
            </button>
          </form>

          <form onSubmit={savePassword} className="space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
            <h2 className="text-lg font-bold text-[var(--foreground)]">Change your password</h2>
            <p className="text-sm text-[var(--muted)]">
              Your current password is required — that is what stops someone who finds an open session from locking you out.
            </p>

            <div>
              <label htmlFor="currentPassword" className="mb-2 block text-sm font-semibold text-[var(--foreground)]">Current password</label>
              <PasswordInput
                id="currentPassword"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                className={inputClass}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="newPassword" className="mb-2 block text-sm font-semibold text-[var(--foreground)]">New password</label>
                <PasswordInput
                  id="newPassword"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  className={inputClass}
                />
                <p className="mt-1 text-xs text-[var(--muted)]">At least 8 characters.</p>
              </div>
              <div>
                <label htmlFor="confirmPassword" className="mb-2 block text-sm font-semibold text-[var(--foreground)]">Confirm new password</label>
                <PasswordInput
                  id="confirmPassword"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  className={inputClass}
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={savingPassword || !currentPassword || !newPassword}
              className="rounded-lg bg-[var(--accent)] px-6 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {savingPassword ? "Changing…" : "Change my password"}
            </button>
          </form>

          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
            <h2 className="text-lg font-bold text-[var(--foreground)]">Session</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">Sign out of the tutor portal on this device.</p>
            <button
              onClick={() => signOut({ callbackUrl: "/auth/lecturer/signin" })}
              className="mt-4 rounded-lg border border-red-200 bg-red-50 px-6 py-2.5 text-sm font-semibold text-red-700 transition hover:bg-red-100"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    </LecturerShell>
  );
}
