"use client";

import { useState } from "react";
import { uploadFile } from "@/lib/upload";

/**
 * The two things an ÖSD/telc booking needs beyond the seat itself: a way to
 * pay that isn't Paystack, and the passport photo + data page. Split out of
 * MyExamsPanel so that file's list-rendering stays readable — this owns its
 * own busy/error state per registration.
 */

type Exam = {
  registrationId: string;
  fee: number | null;
  paymentStatus: string;
  transferRejectedReason: string | null;
  passportPhotoUrl: string | null;
  passportDataPageUrl: string | null;
  documentStatus: string;
  documentRejectedReason: string | null;
};

type BankAccount = { bankName: string; accountName: string; accountNumber: string };

export default function ExamBookingExtras({ exam, onChange }: { exam: Exam; onChange: () => void }) {
  const [showTransfer, setShowTransfer] = useState(false);
  const [account, setAccount] = useState<BankAccount | null>(null);
  const [loadingAccount, setLoadingAccount] = useState(false);
  const [slipFile, setSlipFile] = useState<File | null>(null);
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState<null | "transfer" | "photo" | "dataPage">(null);
  const [error, setError] = useState("");

  async function openTransfer() {
    setShowTransfer(true);
    if (account) return;
    setLoadingAccount(true);
    try {
      const res = await fetch(`/api/exam-centre/bank-transfer?registrationId=${exam.registrationId}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not load payment details");
      setAccount(data.account);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load payment details");
    } finally {
      setLoadingAccount(false);
    }
  }

  async function submitSlip() {
    if (!slipFile) return;
    setBusy("transfer");
    setError("");
    try {
      const uploaded = await uploadFile(slipFile, "files");
      const res = await fetch("/api/exam-centre/bank-transfer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          registrationId: exam.registrationId,
          transferProofUrl: uploaded.url,
          transferReference: reference.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not submit that payment");
      setShowTransfer(false);
      setSlipFile(null);
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not submit that payment");
    } finally {
      setBusy(null);
    }
  }

  async function uploadDocument(kind: "photo" | "dataPage", file: File) {
    setBusy(kind);
    setError("");
    try {
      const uploaded = await uploadFile(file, kind === "photo" ? "photos" : "files");
      const res = await fetch("/api/exam-centre/documents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          registrationId: exam.registrationId,
          ...(kind === "photo" ? { passportPhotoUrl: uploaded.url } : { passportDataPageUrl: uploaded.url }),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not save that document");
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save that document");
    } finally {
      setBusy(null);
    }
  }

  const bothDocsIn = Boolean(exam.passportPhotoUrl && exam.passportDataPageUrl);

  return (
    <div className="mt-3 space-y-3">
      {error && <p className="text-xs text-red-600">{error}</p>}

      {exam.paymentStatus === "unpaid" && exam.fee ? (
        <div>
          {exam.transferRejectedReason && (
            <p className="mb-2 rounded-lg bg-red-50 p-2 text-xs text-red-700">
              Your last transfer couldn't be confirmed: {exam.transferRejectedReason} — please try again.
            </p>
          )}
          {!showTransfer ? (
            <button
              onClick={openTransfer}
              className="rounded-full border border-[var(--border)] px-4 py-2 text-xs font-semibold text-[var(--foreground)] hover:bg-[var(--surface-alt)]"
            >
              Or pay by bank transfer
            </button>
          ) : (
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-alt)] p-4">
              {loadingAccount ? (
                <p className="text-xs text-[var(--muted)]">Loading account details…</p>
              ) : account ? (
                <>
                  <p className="text-xs font-semibold text-[var(--foreground)]">Transfer ₦{exam.fee.toLocaleString()} to:</p>
                  <dl className="mt-2 space-y-1 text-sm">
                    <div><dt className="inline text-[var(--muted)]">Bank: </dt><dd className="inline font-semibold">{account.bankName}</dd></div>
                    <div><dt className="inline text-[var(--muted)]">Account name: </dt><dd className="inline font-semibold">{account.accountName}</dd></div>
                    <div><dt className="inline text-[var(--muted)]">Account number: </dt><dd className="inline font-mono font-semibold">{account.accountNumber || "Ask the office"}</dd></div>
                  </dl>
                  <p className="mt-2 text-[11px] text-[var(--muted)]">
                    Pay from a commercial bank, not a wallet/MFB app. This booking is not reversible or refundable once paid.
                  </p>
                  <label className="mt-3 block text-xs font-semibold text-[var(--foreground)]">
                    Upload your payment receipt
                    <input
                      type="file"
                      accept="image/*,application/pdf"
                      onChange={(e) => setSlipFile(e.target.files?.[0] ?? null)}
                      className="mt-1 block w-full text-xs"
                    />
                  </label>
                  <input
                    type="text"
                    placeholder="Transfer reference (optional)"
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    className="mt-2 w-full rounded-lg border border-[var(--border)] px-3 py-2 text-xs"
                  />
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={submitSlip}
                      disabled={!slipFile || busy === "transfer"}
                      className="rounded-full btn-glow px-4 py-2 text-xs font-bold text-white disabled:opacity-60"
                    >
                      {busy === "transfer" ? "Submitting…" : "I've paid — submit receipt"}
                    </button>
                    <button onClick={() => setShowTransfer(false)} className="rounded-full border border-[var(--border)] px-4 py-2 text-xs font-semibold">
                      Cancel
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          )}
        </div>
      ) : null}

      {exam.paymentStatus === "pending_verification" && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
          Payment slip submitted — the office is confirming it landed. Your seat is held in the meantime.
        </p>
      )}

      <div className="rounded-2xl border border-[var(--border)] p-4">
        <p className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">Documents for the exam body</p>
        {exam.documentRejectedReason && (
          <p className="mt-1 rounded-lg bg-red-50 p-2 text-xs text-red-700">{exam.documentRejectedReason}</p>
        )}
        {bothDocsIn && exam.documentStatus === "pending" && (
          <p className="mt-1 text-xs text-[var(--muted)]">Both uploaded — awaiting the office's review.</p>
        )}
        {exam.documentStatus === "approved" && <p className="mt-1 text-xs font-semibold text-[var(--success)]">Approved</p>}
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <label className="block text-xs font-semibold text-[var(--foreground)]">
            Passport photograph {exam.passportPhotoUrl ? "✓" : ""}
            <input
              type="file"
              accept="image/*"
              disabled={busy === "photo"}
              onChange={(e) => e.target.files?.[0] && uploadDocument("photo", e.target.files[0])}
              className="mt-1 block w-full text-xs"
            />
          </label>
          <label className="block text-xs font-semibold text-[var(--foreground)]">
            Passport data page {exam.passportDataPageUrl ? "✓" : ""}
            <input
              type="file"
              accept="image/*,application/pdf"
              disabled={busy === "dataPage"}
              onChange={(e) => e.target.files?.[0] && uploadDocument("dataPage", e.target.files[0])}
              className="mt-1 block w-full text-xs"
            />
          </label>
        </div>
      </div>
    </div>
  );
}
