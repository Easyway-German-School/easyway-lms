"use client";

/**
 * "Request for a refund?" on the Payments page, end to end.
 *
 * Four stages, not one form. Becca opens with a friendly heads-up — not the
 * policy itself — because leading with section 23's wall of text reads as a
 * setup, like the button existed to catch people out. From there the student
 * picks: read the full Terms and Conditions, or skip straight to the refund
 * sections. Either path ends at the same acknowledgement TermsGate before the
 * form unlocks, so section 24's requirement — proof the student saw the
 * policy on their way to asking for their money back, not just once at
 * signup months earlier — holds no matter which door they took. Section 23
 * is a NO by default with named exceptions, so none of this is theatre that
 * always ends in rejection; a genuine request still reaches the office.
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Mascot from "@/components/Mascot";
import TermsGate from "@/components/TermsGate";
import { refundSections, TERMS_SECTIONS } from "@/lib/terms";
import { CheckIcon, CrossIcon } from "@/components/icons";

type TermsStatus = {
  accepted: boolean;
  acceptedAt?: string;
  fallbackNotice?: string;
};

type Stage = "intro" | "fullGate" | "refundGate" | "form" | "success";

export default function RefundModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [stage, setStage] = useState<Stage>("intro");
  const [mounted, setMounted] = useState(false);
  const [existingTerms, setExistingTerms] = useState<TermsStatus | null>(null);

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [courseOrPackage, setCourseOrPackage] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    setStage("intro");
    setError("");
    (async () => {
      try {
        const [termsRes, profileRes] = await Promise.all([
          fetch("/api/student/terms", { cache: "no-store" }),
          fetch("/api/student/profile", { cache: "no-store" }),
        ]);
        if (termsRes.ok) setExistingTerms(await termsRes.json());
        if (profileRes.ok) {
          const data = await profileRes.json();
          setFullName((current) => current || data?.user?.name || "");
          setPhone((current) => current || data?.student?.admission?.phone || "");
          setCourseOrPackage((current) => current || data?.student?.pathway || "");
        }
      } catch {
        // Prefill is a convenience, not a requirement — the form still works blank.
      }
    })();
  }, [open]);

  if (!open || !mounted) return null;

  async function submit() {
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/student/refund-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          acknowledgedTerms: true,
          fullName,
          phone,
          courseOrPackage,
          paymentReference,
          reason,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || "Could not submit your refund request.");
      setStage("success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit your refund request.");
    } finally {
      setSubmitting(false);
    }
  }

  if (stage === "intro") {
    return createPortal(
      <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/60 p-4 backdrop-blur-sm" onClick={onClose}>
        <div
          role="dialog"
          aria-modal="true"
          className="w-full max-w-md overflow-hidden rounded-[28px] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-2xl"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-start gap-4">
            <Mascot mood="smiling" className="h-20 w-20 shrink-0" />
            <div>
              <h2 className="text-lg font-black text-[var(--foreground)]">Before you request a refund</h2>
              <p className="mt-1.5 text-sm text-[var(--muted)]">
                Please take a moment to read our Terms and Conditions first — it covers what to expect and how the
                process works.
              </p>
            </div>
          </div>
          <div className="mt-6 space-y-2">
            <button
              type="button"
              onClick={() => setStage("fullGate")}
              className="w-full rounded-xl bg-gradient-to-r from-[#0D7C7E] to-[#FF6600] px-6 py-3 text-sm font-bold text-white shadow-lg shadow-[#FF6600]/20 transition hover:brightness-110"
            >
              Read the Terms and Conditions
            </button>
            <button
              type="button"
              onClick={() => setStage("refundGate")}
              className="w-full rounded-xl px-6 py-2.5 text-xs font-semibold text-[var(--muted)] underline underline-offset-2 hover:text-[var(--foreground)]"
            >
              Skip to refund policy
            </button>
          </div>
        </div>
      </div>,
      document.body,
    );
  }

  if (stage === "fullGate") {
    return (
      <TermsGate
        open
        closable
        onClose={onClose}
        sections={TERMS_SECTIONS}
        title="Terms and Conditions"
        agreeLabel="I Agree — Continue"
        onAgree={() => setStage("form")}
      />
    );
  }

  if (stage === "refundGate") {
    return (
      <TermsGate
        open
        closable
        onClose={onClose}
        sections={refundSections()}
        showPreamble={false}
        title="The refund policy"
        agreeLabel="I Understand — Continue"
        checkboxLabel="I understand the refund policy above and still want to submit a request."
        intro={
          <div className="flex items-start gap-4">
            <Mascot mood="presenting" className="h-20 w-20 shrink-0" />
            <div>
              <p className="font-semibold text-[var(--foreground)]">Tuition fees are generally non-refundable.</p>
              <p className="mt-1">
                {existingTerms?.accepted
                  ? `You already agreed to this policy on ${existingTerms.acceptedAt ? new Date(existingTerms.acceptedAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "signup"}.`
                  : existingTerms?.fallbackNotice}
              </p>
            </div>
          </div>
        }
        onAgree={() => setStage("form")}
      />
    );
  }

  return createPortal(
    <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-lg overflow-hidden rounded-[28px] border border-[var(--border)] bg-[var(--surface)] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        {stage === "form" ? (
          <>
            <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] p-6">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--accent)]">Refund request</p>
                <h2 className="mt-1 text-xl font-black text-[var(--foreground)]">Tell us the details</h2>
              </div>
              <button type="button" onClick={onClose} className="rounded-full p-2 text-[var(--muted)] hover:bg-[var(--surface-alt)]" aria-label="Close">
                <CrossIcon className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-[65vh] space-y-4 overflow-y-auto p-6">
              <label>
                <span className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--muted)]">Full name</span>
                <input value={fullName} onChange={(e) => setFullName(e.target.value)} className="mt-2 w-full rounded-2xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)]" />
              </label>
              <label>
                <span className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--muted)]">Phone number</span>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} className="mt-2 w-full rounded-2xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)]" />
              </label>
              <label>
                <span className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--muted)]">Course or package</span>
                <input value={courseOrPackage} onChange={(e) => setCourseOrPackage(e.target.value)} className="mt-2 w-full rounded-2xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)]" />
              </label>
              <label>
                <span className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--muted)]">Payment receipt / reference</span>
                <input value={paymentReference} onChange={(e) => setPaymentReference(e.target.value)} className="mt-2 w-full rounded-2xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)]" />
              </label>
              <label>
                <span className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--muted)]">Reason for your request</span>
                <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={4} className="mt-2 w-full rounded-2xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)]" />
              </label>
              {error ? <p className="text-sm text-red-600">{error}</p> : null}
            </div>
            <div className="border-t border-[var(--border)] p-6">
              <button
                type="button"
                onClick={submit}
                disabled={submitting || !fullName.trim() || !phone.trim() || !courseOrPackage.trim() || !paymentReference.trim() || !reason.trim()}
                className="w-full rounded-xl bg-gradient-to-r from-[#0D7C7E] to-[#FF6600] px-8 py-3.5 text-sm font-bold text-white shadow-lg shadow-[#FF6600]/20 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? "Submitting…" : "Submit refund request"}
              </button>
              <p className="mt-3 text-center text-xs text-[var(--muted)]">
                Only requests submitted here or to germanprivateclass@gmail.com are processed — see section 24.
              </p>
            </div>
          </>
        ) : (
          <div className="p-8 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-400/15 text-emerald-600">
              <CheckIcon className="h-7 w-7" />
            </div>
            <h2 className="mt-4 text-xl font-black text-[var(--foreground)]">Request submitted</h2>
            <p className="mt-2 text-sm text-[var(--muted)]">
              The office has been notified. Refund decisions and, where approved, processing can take up to 30 days —
              see section 25. You&apos;ll be notified here as soon as there&apos;s an update.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-6 w-full rounded-xl border border-[var(--border)] px-6 py-3 text-sm font-bold text-[var(--foreground)] transition hover:bg-[var(--surface-alt)]"
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
