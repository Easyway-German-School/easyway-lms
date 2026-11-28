"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AdminShell from "@/components/AdminShell";
import AdminLoader from "@/components/AdminLoader";

type AttentionItem = {
  bookingId: string;
  referenceCode: string;
  fullName: string;
  email: string;
  paymentStatus: string;
  step: string;
  subject: string;
  status: string;
  sentAt: string;
  messageId: string | null;
  lastError: string | null;
  attemptCount: number;
  reason: string;
};

/**
 * Honest email desk: anything failed, stuck, missing, or accepted before the
 * support@ Brevo fix. Force-resend from here — the candidate card "sent" list
 * alone is not proof of inbox delivery.
 */
export default function AdminEmailsPage() {
  const router = useRouter();
  const [items, setItems] = useState<AttentionItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/emails/attention", { cache: "no-store" });
    if (res.status === 401) {
      router.push("/admin/login");
      return;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "Could not load email attention list.");
      setLoaded(true);
      return;
    }
    setItems(data.items ?? []);
    setLoaded(true);
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function resendOne(item: AttentionItem) {
    const key = `${item.bookingId}:${item.step}`;
    setBusyKey(key);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/admin/emails/attention", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items: [{ bookingId: item.bookingId, step: item.step }] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Resend failed");
      setNotice(
        data.failed
          ? `Resend failed for ${item.referenceCode}: ${(data.errors ?? []).join("; ") || "unknown"}`
          : `Resent ${item.step} to ${item.fullName} — handed to Brevo again.`,
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Resend failed");
    } finally {
      setBusyKey(null);
    }
  }

  async function resendAll() {
    if (items.length === 0) return;
    if (!window.confirm(`Force-resend all ${items.length} emails that need attention?`)) return;
    setBulkBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/admin/emails/attention", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          items: items.map((i) => ({ bookingId: i.bookingId, step: i.step })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Bulk resend failed");
      setNotice(
        `Resend finished — handed to provider again: ${data.sent}, failed: ${data.failed}. ` +
          `If the list still looks full, refresh — only failed/unverified/missing stay here (not every Brevo queue).`,
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bulk resend failed");
    } finally {
      setBulkBusy(false);
    }
  }

  if (!loaded) {
    return (
      <AdminShell>
        <AdminLoader />
      </AdminShell>
    );
  }

  return (
    <AdminShell>
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-serif-display text-2xl font-semibold text-[var(--navy)]">Email attention</h1>
            <p className="mt-1 max-w-2xl text-sm text-[var(--ink-soft)]">
              This is the <strong>action</strong> queue only: failed, stuck, missing invoices, or accepted
              before the working From. Recent &quot;queued at Brevo&quot; rows are not listed here on purpose —
              Resend already hands them to Brevo again; keeping them here made the count stuck at 121.
              Candidate cards still say SMTP ≠ inbox. Wire Zoho ZeptoMail for dual send when ready.
            </p>
          </div>
          <button
            disabled={bulkBusy || items.length === 0}
            onClick={resendAll}
            className="rounded-sm bg-[var(--gold)] px-4 py-2 text-sm font-semibold text-[var(--navy-deep)] disabled:opacity-40"
          >
            {bulkBusy ? "Resending…" : `Resend all needing attention (${items.length})`}
          </button>
        </div>

        {error && <p className="mt-4 rounded-sm bg-[var(--red-soft)] px-4 py-3 text-sm text-[var(--red)]">{error}</p>}
        {notice && <p className="mt-4 rounded-sm bg-[var(--green-soft)] px-4 py-3 text-sm text-[var(--green)]">{notice}</p>}

        <div className="mt-6 space-y-3">
          {items.length === 0 && (
            <p className="rounded-sm border border-[var(--line)] bg-white px-4 py-6 text-sm text-[var(--ink-soft)]">
              Nothing needs attention right now. Mail sent before the authenticated From
              (no-reply@easywaylanguageschoolexams.com) shows up here so you can resend it.
            </p>
          )}
          {items.map((item) => {
            const key = `${item.bookingId}:${item.step}`;
            return (
              <div key={key} className="rounded-sm border border-[var(--line)] bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-[var(--navy)]">
                      {item.fullName}{" "}
                      <span className="font-mono text-xs font-normal text-[var(--ink-soft)]">{item.referenceCode}</span>
                    </p>
                    <p className="mt-0.5 text-xs text-[var(--ink-soft)]">
                      {item.email} · {item.paymentStatus} · step <span className="font-semibold">{item.step}</span>
                    </p>
                    <p className="mt-2 text-sm font-semibold text-[var(--red)]">{item.reason}</p>
                    <p className="mt-1 text-xs text-[var(--ink-soft)]">
                      Last attempt {new Date(item.sentAt).toLocaleString("en-GB")}
                      {item.attemptCount > 0 ? ` · attempts ${item.attemptCount}` : ""}
                      {item.messageId ? ` · id ${item.messageId}` : ""}
                    </p>
                  </div>
                  <button
                    disabled={busyKey === key || bulkBusy}
                    onClick={() => resendOne(item)}
                    className="rounded-sm bg-[var(--navy)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                  >
                    {busyKey === key ? "Sending…" : "Resend now"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </AdminShell>
  );
}
