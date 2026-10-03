"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

import AdminShell from "@/components/AdminShell";
import { WalletIcon } from "@/components/icons";

/**
 * Payment account — where this school's fees are paid to.
 *
 * Connecting your own Paystack account means every student payment settles
 * straight to YOU, not through anyone else. Three things to do, in order, and the
 * screen only ever shows the next one: paste the key, tell Paystack where to send
 * payment news, done. The secret key is never shown again after it is saved.
 */

type Account =
  | { connected: false; usingPlatformAccount: boolean }
  | { connected: true; last4: string; mode: "live" | "test"; connectedAt: string };

export default function PaymentAccountPage() {
  const [account, setAccount] = useState<Account | null>(null);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/settings/payments", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ tone: "error", text: data?.error || "Could not load your payment account." });
        return;
      }
      setAccount(data.account);
      setWebhookUrl(data.webhookUrl || "");
    } catch {
      setMessage({ tone: "error", text: "Could not load your payment account." });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function connect() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/settings/payments", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secretKey }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ tone: "error", text: data?.error || "Could not connect that key." });
        return;
      }
      setSecretKey("");
      setAccount(data.account);
      setWebhookUrl(data.webhookUrl || webhookUrl);
      setMessage({ tone: "ok", text: "Connected. One more step below so Paystack can tell us when a student pays." });
    } catch {
      setMessage({ tone: "error", text: "Could not connect that key. Check your internet and try again." });
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (
      !window.confirm(
        "Disconnect your Paystack account?\n\nStudents will not be able to pay online until you connect one again.",
      )
    ) {
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/settings/payments", { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ tone: "error", text: data?.error || "Could not disconnect." });
        return;
      }
      setAccount(data.account);
      setMessage({ tone: "ok", text: "Disconnected." });
    } finally {
      setBusy(false);
    }
  }

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setMessage({ tone: "error", text: "Could not copy — select the address and copy it by hand." });
    }
  }

  const cardClass = "rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm";

  return (
    <AdminShell>
      <div className="mx-auto max-w-3xl space-y-6 p-6">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <WalletIcon className="h-8 w-8 text-[var(--accent)]" />
            <h1 className="text-3xl font-bold text-[var(--foreground)]">Payment account</h1>
          </div>
          <p className="text-[var(--muted)]">
            Connect your own Paystack account so every fee your students pay lands straight in your account.
          </p>
          <p className="text-xs text-[var(--muted)]">
            <Link href="/admin/settings" className="underline">
              Back to general settings
            </Link>
          </p>
        </div>

        {message && (
          <div
            role="status"
            className={`rounded-lg px-4 py-3 text-sm font-medium ${
              message.tone === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
            }`}
          >
            {message.text}
          </div>
        )}

        {!account && !message && <p className="text-[var(--muted)]">Loading…</p>}

        {account && account.connected && (
          <section className={cardClass}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-[var(--foreground)]">Your Paystack account is connected</h2>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  Key ending in <span className="font-mono font-semibold">{account.last4}</span> ·{" "}
                  {account.mode === "live" ? "live payments" : "test mode"}
                </p>
              </div>
              <button
                type="button"
                onClick={disconnect}
                disabled={busy}
                className="rounded-full border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--foreground)] hover:bg-[var(--background)] disabled:opacity-50"
              >
                Disconnect
              </button>
            </div>
            {account.mode === "test" && (
              <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                This is a test key — no real money moves. Connect your live key when you are ready to take real payments.
              </p>
            )}
          </section>
        )}

        {account && !account.connected && (
          <section className={cardClass}>
            <h2 className="text-lg font-bold text-[var(--foreground)]">Step 1 · Paste your Paystack secret key</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              In Paystack, open Settings, then API Keys &amp; Webhooks, and copy the <strong>Secret Key</strong> (it starts
              with <span className="font-mono">sk_live_</span>). We store it encrypted and never show it again.
            </p>
            {account.usingPlatformAccount && (
              <p className="mt-3 rounded-lg bg-[var(--background)] px-3 py-2 text-sm text-[var(--muted)]">
                Right now payments use the school&apos;s main Paystack account. Connecting your own is optional.
              </p>
            )}
            <div className="mt-4 flex flex-col gap-3 sm:flex-row">
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder="sk_live_…"
                value={secretKey}
                onChange={(e) => setSecretKey(e.target.value)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 font-mono text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)]"
              />
              <button
                type="button"
                onClick={connect}
                disabled={busy || secretKey.trim().length < 10}
                className="rounded-full bg-[var(--accent)] px-6 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {busy ? "Checking…" : "Connect"}
              </button>
            </div>
          </section>
        )}

        {account && account.connected && (
          <section className={cardClass}>
            <h2 className="text-lg font-bold text-[var(--foreground)]">Step 2 · Tell Paystack where to send payment news</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Copy this address. In Paystack, go to Settings, then API Keys &amp; Webhooks, and paste it into{" "}
              <strong>Live Webhook URL</strong> (and Test Webhook URL if you use test mode). Then Save. This is how a
              student&apos;s payment unlocks their account straight away.
            </p>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row">
              <input
                readOnly
                value={webhookUrl}
                onFocus={(e) => e.currentTarget.select()}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 font-mono text-xs text-[var(--foreground)]"
              />
              <button
                type="button"
                onClick={copyUrl}
                className="rounded-full bg-[var(--accent)] px-6 py-2 text-sm font-semibold text-white"
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </section>
        )}
      </div>
    </AdminShell>
  );
}
