"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Mascot from "@/components/Mascot";
import { useMoment } from "@/lib/moment-queue";

/**
 * "LET'S SET UP YOUR REAL LOGIN."
 *
 * A student the office added from a paper form or a spreadsheet signs in with
 * a login we built for them — their phone number at `student.easywayschoollms
 * .com.ng`, or an importer placeholder — and a password we generated and sent
 * by WhatsApp. Neither is theirs to keep. This greets exactly those students,
 * once the office has sent the credentials and they have used them, with a
 * friendly Becca card that swaps both for an email they own and a password
 * they choose, in one step.
 *
 * Queue-managed (priority 74) so it never stacks on the welcome tour or a
 * celebration, and drops to the dock if the visit's two-modal cap is spent.
 * "Later" snoozes it for a few days rather than for good — the office wants
 * these logins retired. On success the page reloads so the shell and the
 * session pick up the new address.
 */

type Status = {
  due: boolean;
  kind: "phone" | "placeholder" | "real";
  currentEmail: string;
  firstName: string | null;
};

const SNOOZE_KEY = "easyway-login-upgrade-snooze";
const SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;

function snoozedUntil(): number {
  try {
    return Number(window.localStorage.getItem(SNOOZE_KEY) || 0);
  } catch {
    return 0;
  }
}

function snooze() {
  try {
    window.localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS));
  } catch {
    /* fine — it just offers again on the next visit */
  }
}

export default function LoginUpgradeMoment() {
  const [status, setStatus] = useState<Status | null>(null);
  const [checked, setChecked] = useState(false);
  const [snoozedNow, setSnoozedNow] = useState(true);

  const [email, setEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    setSnoozedNow(Date.now() < snoozedUntil());
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/student/login-upgrade", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: Status | null) => {
        if (cancelled) return;
        setStatus(data && data.due ? data : null);
        setChecked(true);
      })
      .catch(() => {
        if (!cancelled) setChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const due = Boolean(checked && status && !snoozedNow);
  const { open, close } = useMoment("login-upgrade", due);

  if (!open || !status || typeof document === "undefined") return null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    if (newPassword !== confirmPassword) {
      setError("The two new passwords do not match.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/student/login-upgrade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), currentPassword, newPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Could not update your login.");
      setDone(true);
      // Let them read the confirmation, then reload so the shell and the
      // NextAuth session pick up the new address.
      setTimeout(() => {
        close();
        window.location.reload();
      }, 1600);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not update your login.");
    } finally {
      setSaving(false);
    }
  };

  const later = () => {
    snooze();
    close();
  };

  const inputClass =
    "mt-1.5 w-full rounded-2xl border border-[var(--border)] bg-[var(--background)] px-4 py-2.5 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)]";

  return createPortal(
    <div
      className="fixed inset-0 z-[70] grid place-items-center bg-black/50 p-5"
      role="dialog"
      aria-modal="true"
      aria-label="Set up your login"
    >
      <div className="w-full max-w-sm overflow-hidden rounded-[28px] border border-[var(--border)] bg-[var(--surface)] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.5)]">
        <div className="bg-[var(--accent-soft)] px-6 pt-6 text-center">
          <Mascot mood="presenting" className="mx-auto h-20 w-20" />
        </div>

        {done ? (
          <div className="p-6 text-center">
            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[var(--accent)]">All set</p>
            <h2 className="mt-1.5 text-lg font-bold text-[var(--foreground)]">Your login is yours now</h2>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Next time, sign in with <span className="font-semibold text-[var(--foreground)]">{email.trim()}</span> and
              your new password.
            </p>
          </div>
        ) : (
          <form onSubmit={submit} className="p-6">
            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[var(--accent)]">
              {status.firstName ? `Hi ${status.firstName}` : "Welcome in"}
            </p>
            <h2 className="mt-1.5 text-lg font-bold text-[var(--foreground)]">Let&apos;s set up your real login</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              You&apos;re signed in with a temporary login the office made for you
              {status.kind === "phone" ? " from your phone number" : ""}. Set your own email and a password you&apos;ll
              remember — it takes a moment and keeps your account yours.
            </p>

            <div className="mt-3 rounded-2xl bg-[var(--surface-alt)] px-3.5 py-2.5 text-left">
              <p className="text-[11px] font-semibold text-[var(--muted)]">Signed in as</p>
              <p className="mt-0.5 break-all text-sm font-medium text-[var(--foreground-soft)]">{status.currentEmail}</p>
            </div>

            <div className="mt-4 space-y-3 text-left">
              <label className="block">
                <span className="text-xs font-semibold text-[var(--muted)]">Your email address</span>
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className={inputClass}
                  placeholder="you@example.com"
                  required
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-[var(--muted)]">Current password (the one we sent you)</span>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  className={inputClass}
                  required
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-[var(--muted)]">New password</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  className={inputClass}
                  required
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-[var(--muted)]">Confirm new password</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  className={inputClass}
                  required
                />
              </label>
            </div>

            {error ? <p className="mt-3 text-sm font-semibold text-red-500">{error}</p> : null}

            <div className="mt-5 flex flex-col gap-2">
              <button
                type="submit"
                disabled={saving}
                className="rounded-full bg-[var(--accent)] px-6 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
              >
                {saving ? "Saving…" : "Save my login"}
              </button>
              <button type="button" onClick={later} className="text-xs font-medium text-[var(--muted)]">
                Later
              </button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}
