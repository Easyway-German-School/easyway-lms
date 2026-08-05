"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertIcon, CheckCircleIcon, ShieldIcon } from "@/components/icons";

/**
 * Two-factor enrolment for the signed-in admin, on the security page.
 *
 * Only ever acts on your own account — there is no picker. Enrolling somebody
 * else would mean handling their secret, and an administrator who can switch
 * on another person's second factor can switch off their own protection by
 * proxy. The recovery path for a colleague who has genuinely lost both phone
 * and codes is in docs/SECURITY.md and has a human in it.
 */

type Status = {
  enabled: boolean;
  enabledAt: string | null;
  backupCodesRemaining: number;
  expectedForThisRole: boolean;
  enforced: boolean;
};

export default function TwoFactorCard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [stage, setStage] = useState<"idle" | "scanning" | "codes">("idle");
  const [qr, setQr] = useState<string | null>(null);
  const [manualKey, setManualKey] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/admin/security/mfa");
    if (response.ok) setStatus(await response.json());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const begin = async () => {
    setBusy(true);
    setError(null);
    const response = await fetch("/api/admin/security/mfa/setup", { method: "POST" });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) return setError(data.error ?? "Could not start setup.");
    setQr(data.qr);
    setManualKey(data.manualKey);
    setStage("scanning");
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    const response = await fetch("/api/admin/security/mfa/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) return setError(data.error ?? "That code was not accepted.");
    setBackupCodes(data.backupCodes);
    setToken("");
    setQr(null);
    setManualKey(null);
    setStage("codes");
    void load();
  };

  const disable = async () => {
    setBusy(true);
    setError(null);
    const response = await fetch("/api/admin/security/mfa", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) return setError(data.error ?? "Could not switch it off.");
    setToken("");
    setStage("idle");
    void load();
  };

  if (!status) return null;

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Two-factor authentication</h2>

      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
        {/* Current state */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className={status.enabled ? "text-emerald-600" : "text-amber-600"}>
              {status.enabled ? <CheckCircleIcon className="h-5 w-5" /> : <ShieldIcon className="h-5 w-5" />}
            </span>
            <div>
              <p className="text-sm font-semibold">
                {status.enabled ? "On for your account" : "Not set up on your account"}
              </p>
              <p className="mt-0.5 text-xs text-[var(--muted)]">
                {status.enabled
                  ? `Since ${new Date(status.enabledAt!).toLocaleDateString()} · ${status.backupCodesRemaining} backup code${status.backupCodesRemaining === 1 ? "" : "s"} left`
                  : status.expectedForThisRole
                    ? "Your role can reach the payment book and the security trail. This is the account most worth protecting."
                    : "Optional for your role, and still worth ten minutes."}
              </p>
            </div>
          </div>

          {!status.enabled && stage === "idle" ? (
            <button
              onClick={begin}
              disabled={busy}
              className="rounded-lg bg-[var(--accent)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
            >
              {busy ? "Preparing…" : "Set up"}
            </button>
          ) : null}
        </div>

        {/* Enforcement notice: the gap between "should have it" and "must". */}
        {status.expectedForThisRole && !status.enabled && !status.enforced ? (
          <p className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
            <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Enforcement is off, so this is not blocking you yet. Once every super admin has enrolled,
              set <code className="font-mono">MFA_ENFORCED=true</code> to make it required.
            </span>
          </p>
        ) : null}

        {error ? (
          <p className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</p>
        ) : null}

        {/* Step one: scan */}
        {stage === "scanning" && qr ? (
          <div className="mt-4 space-y-3 border-t border-[var(--border)] pt-4">
            <p className="text-sm font-medium">Scan this with your authenticator app</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt="Two-factor setup QR code" width={200} height={200} className="rounded-xl border border-[var(--border)]" />
            <p className="text-xs text-[var(--muted)]">
              Can&apos;t scan? Enter this key by hand:{" "}
              <code className="font-mono text-[var(--foreground)]">{manualKey}</code>
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder="000000"
                inputMode="text"
                autoComplete="one-time-code"
                className="w-32 rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-center tracking-[0.3em]"
              />
              <button
                onClick={confirm}
                disabled={busy || token.length < 6}
                className="rounded-lg bg-[var(--accent)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
              >
                {busy ? "Checking…" : "Confirm"}
              </button>
              <button
                onClick={() => { setStage("idle"); setQr(null); setError(null); }}
                className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-semibold"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        {/* Step two: the codes, shown exactly once */}
        {stage === "codes" ? (
          <div className="mt-4 space-y-3 border-t border-[var(--border)] pt-4">
            <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
              <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                <strong>Write these down now.</strong> They are stored hashed and cannot be shown again.
                Each works once, and they are the only way back in if you lose your phone.
              </span>
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {backupCodes.map((code) => (
                <code key={code} className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-center font-mono text-sm">
                  {code}
                </code>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => navigator.clipboard?.writeText(backupCodes.join("\n"))}
                className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-semibold"
              >
                Copy all
              </button>
              <button
                onClick={() => { setStage("idle"); setBackupCodes([]); }}
                className="rounded-lg bg-[var(--accent)] px-3 py-2 text-xs font-semibold text-white"
              >
                I&apos;ve saved them
              </button>
            </div>
          </div>
        ) : null}

        {/* Turning it off needs a live code, not just a live session. */}
        {status.enabled && stage === "idle" ? (
          <details className="mt-4 border-t border-[var(--border)] pt-4">
            <summary className="cursor-pointer text-xs font-semibold text-[var(--muted)]">
              Switch two-factor off
            </summary>
            <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
              Enter a current code to confirm it is really you. A signed-in browser on its own is not
              enough — that is exactly what somebody holding your unlocked laptop already has.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder="000000"
                inputMode="text"
                autoComplete="one-time-code"
                className="w-32 rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-center tracking-[0.3em]"
              />
              <button
                onClick={disable}
                disabled={busy || token.length < 6}
                className="rounded-lg border border-red-300 px-3 py-2 text-xs font-semibold text-red-700 disabled:opacity-50"
              >
                {busy ? "Checking…" : "Switch off"}
              </button>
            </div>
          </details>
        ) : null}
      </div>
    </section>
  );
}
