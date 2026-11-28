"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import AdminShell from "@/components/AdminShell";
import AdminLoader from "@/components/AdminLoader";
import ManualBookingForm from "@/components/ManualBookingForm";
import PanthexaIntakeForm from "@/components/PanthexaIntakeForm";
import Modal from "@/components/Modal";
import { deliveryLabel } from "@/lib/email-delivery";

type Booking = {
  id: string;
  referenceCode: string;
  invoiceNumber: string | null;
  source: string;
  fullName: string;
  email: string;
  feeTotal: number;
  modules: string[];
  express: boolean;
  expressFee: number;
  paymentStatus: string;
  status: string;
  paymentMethod: string | null;
  transferProofUrl: string | null;
  transferReference: string | null;
  transferRejectedReason: string | null;
  passportPhotoUrl: string | null;
  passportDataPageUrl: string | null;
  documentStatus: string;
  seatNumber: number | null;
  createdAt: string;
  nationality: string;
  idType: string | null;
  idNumber: string | null;
  idExpiry: string | null;
  secondaryIdType: string | null;
  isRepeatAttempt: boolean;
  specialNeeds: string | null;
  prepInterestAt: string | null;
  certificateCollection: string | null;
  phone: string;
  gender: string | null;
  dateOfBirth: string;
  placeOfBirth: string;
  countryOfBirth: string | null;
  addressLine: string | null;
  city: string | null;
  country: string;
  panthexaReference: string | null;
  registeredAt: string | null;
  consentAcceptedAt: string | null;
  examRegistrationLink: string | null;
  examRegistrationDeadline: string | null;
  session: { id: string; title: string; level: string; startDate: string };
  derived: { key: string; number: number | null; label: string; staffNext: string | null; tone: "neutral" | "waiting" | "action" | "good" | "bad" };
  checklist: { label: string; done: boolean }[];
  journeyEmails: {
    step: string;
    subject: string;
    sentAt: string;
    status?: string;
    provider?: string | null;
    messageId?: string | null;
    lastError?: string | null;
    attemptCount?: number;
  }[];
  registrationLinkSentAt: string | null;
};

type Filter = "action" | "waiting" | "examWaiting" | "panthexaSent" | "active" | "cancelled" | "leads" | "all";

const STEP_LABEL: Record<string, string> = {
  booking_received: "Booking received (A + invoice)",
  payment_reminder: "Payment reminder",
  payment_confirmed: "Payment confirmed (B + receipt)",
  info_check: "Check your details (C)",
  prep_invite: "Prep-class note",
  admission: "Exam registration confirmed (D)",
  exam_guide: "Examination guide (E/F)",
  reminder_7day: "7-day reminder (I)",
  reminder_24h: "24-hour reminder (J)",
  result_pending: "Result pending (L)",
  result_released: "Result released (K)",
  certificate_ready: "Certificate collection (M)",
};

const TONE: Record<Booking["derived"]["tone"], string> = {
  neutral: "bg-[var(--paper)] text-[var(--ink-soft)]",
  waiting: "bg-[var(--gold-soft)] text-[var(--navy)]",
  action: "bg-[var(--navy)] text-white",
  good: "bg-[var(--green-soft)] text-[var(--green)]",
  bad: "bg-[var(--red-soft)] text-[var(--red)]",
};

const isoToday = () => new Date().toISOString().slice(0, 10);

function isCancelledBooking(b: Pick<Booking, "status">) {
  return b.status === "cancelled" || b.status === "no_show";
}
function isLiveBooking(b: Pick<Booking, "status">) {
  return !isCancelledBooking(b);
}
function isWaitingForExam(b: Booking): boolean {
  return isLiveBooking(b) && (b.derived.key === "ready_to_admit" || b.derived.key === "admitted") && !b.registrationLinkSentAt;
}
function hasPanthexaLinkSent(b: Booking): boolean {
  return isLiveBooking(b) && Boolean(b.registrationLinkSentAt);
}

/** Office-side version of the same candidate upload flow — for a walk-in or Panthexa candidate
 *  whose ID the office is scanning in person, rather than the candidate uploading it themselves. */
async function officeUploadDocument(kind: "photo" | "dataPage", file: File, reference: string, email: string): Promise<void> {
  const form = new FormData();
  form.append("file", file);
  form.append("folder", kind === "photo" ? "photos" : "documents");
  form.append("reference", reference);
  form.append("email", email);
  const uploadRes = await fetch("/api/upload", { method: "POST", body: form });
  const uploadData = await uploadRes.json();
  if (!uploadRes.ok) throw new Error(uploadData.error ?? "Upload failed");

  const res = await fetch(`/api/bookings/${reference}/documents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, ...(kind === "photo" ? { passportPhotoUrl: uploadData.url } : { passportDataPageUrl: uploadData.url }) }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Could not save that document");
}

export default function AdminDashboard() {
  const router = useRouter();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState<Filter>("action");
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/bookings", { cache: "no-store" });
      if (res.status === 401) {
        router.push("/admin/login");
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Unable to load bookings");
      setBookings(data.bookings ?? []);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load bookings");
    } finally {
      setLoaded(true);
    }
  }, [router]);

  useEffect(() => { load(); }, [load]);

  /** Returns true when the action went through, so a card can close its own form. */
  async function act(id: string, body: Record<string, unknown>, success?: string): Promise<boolean> {
    setBusyId(id);
    setError("");
    setNotice("");
    try {
      const res = await fetch(`/api/admin/bookings/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "That didn't work");
      if (data.refundAttempted) {
        window.alert(data.refundOk ? "Refund requested via Flutterwave — allow a few business days to reflect." : "Automatic refund FAILED — refund this candidate manually.");
      }
      if (success) setNotice(success);
      await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work");
      return false;
    } finally {
      setBusyId(null);
    }
  }

  const counts = useMemo(() => ({
    action: bookings.filter((b) => isLiveBooking(b) && (b.derived.tone === "action" || b.paymentStatus === "refund_failed" || b.paymentStatus === "refund_pending")).length,
    waiting: bookings.filter((b) => isLiveBooking(b) && b.derived.tone === "waiting").length,
    examWaiting: bookings.filter(isWaitingForExam).length,
    panthexaSent: bookings.filter(hasPanthexaLinkSent).length,
    active: bookings.filter((b) => isLiveBooking(b)).length,
    cancelled: bookings.filter((b) => isCancelledBooking(b)).length,
    leads: bookings.filter((b) => isLiveBooking(b) && b.prepInterestAt).length,
    all: bookings.length,
  }), [bookings]);

  if (!loaded) return <AdminShell><AdminLoader /></AdminShell>;

  const q = query.trim().toLowerCase();
  const shown = bookings
    .filter((b) => {
      if (filter === "action") return isLiveBooking(b) && (b.derived.tone === "action" || b.paymentStatus === "refund_failed" || b.paymentStatus === "refund_pending");
      if (filter === "waiting") return isLiveBooking(b) && b.derived.tone === "waiting";
      if (filter === "examWaiting") return isWaitingForExam(b);
      if (filter === "panthexaSent") return hasPanthexaLinkSent(b);
      if (filter === "active") return isLiveBooking(b);
      if (filter === "cancelled") return isCancelledBooking(b);
      if (filter === "leads") return isLiveBooking(b) && Boolean(b.prepInterestAt);
      return true;
    })
    .filter((b) => !q || `${b.fullName} ${b.email} ${b.phone} ${b.referenceCode} ${b.invoiceNumber ?? ""}`.toLowerCase().includes(q));

  const tabs: { key: Filter; label: string }[] = [
    { key: "action", label: "Needs the office" },
    { key: "waiting", label: "Waiting on candidate" },
    { key: "examWaiting", label: "Waiting for Exam" },
    { key: "panthexaSent", label: "Panthexa link sent" },
    { key: "active", label: "Active candidates" },
    { key: "cancelled", label: "Cancelled / no-show" },
    { key: "leads", label: "Prep-class leads" },
    { key: "all", label: "Everyone" },
  ];

  return (
    <AdminShell>
      <div className="mx-auto max-w-5xl">
        <h1 className="font-serif-display text-2xl font-semibold text-[var(--navy)]">Candidates</h1>

        {error && <p className="mt-4 rounded-sm bg-[var(--red-soft)] px-4 py-3 text-sm text-[var(--red)]">{error}</p>}
        {notice && <p className="mt-4 rounded-sm bg-[var(--green-soft)] px-4 py-3 text-sm text-[var(--green)]">{notice}</p>}

        <div className="mt-4 flex flex-wrap gap-3">
          <PanthexaIntakeForm onCreated={load} />
          <ManualBookingForm onCreated={load} />
          <BulkEmailForm />
          <DrainEmailQueueButton onDone={(msg) => { setNotice(msg); load(); }} onError={setError} />
          <a href="/admin/emails" className="rounded-sm border border-[var(--red)] px-4 py-2 text-sm font-semibold text-[var(--red)]">
            Email attention →
          </a>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-2">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setFilter(t.key)}
              className={`rounded-sm px-4 py-2 text-sm font-semibold ${filter === t.key ? "bg-[var(--navy)] text-white" : "border border-[var(--line)] text-[var(--ink-soft)]"}`}
            >
              {t.label} <span className="ml-1 opacity-70">{counts[t.key]}</span>
            </button>
          ))}
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, email, reference…"
            className="ml-auto w-full rounded-sm border border-[var(--line)] bg-white px-3 py-2 text-sm sm:w-64"
          />
        </div>

        <div className="mt-5 space-y-3">
          {shown.length === 0 && <p className="text-sm text-[var(--ink-soft)]">Nothing here.</p>}
          {shown.map((b) => (
            <CandidateCard key={b.id} b={b} busy={busyId === b.id} act={(body, success) => act(b.id, body, success)} onUploaded={load} />
          ))}
        </div>
      </div>
    </AdminShell>
  );
}

const CATEGORY_LABEL: Record<string, string> = {
  unpaid: "Haven't paid",
  id_missing: "Haven't uploaded their ID",
  details_incomplete: "Details still incomplete",
  everyone_live: "Everyone (not cancelled/no-show)",
};

/** One email to every live candidate matching a plain category — not the per-candidate "resend" dropdown, a mass send. */
function DrainEmailQueueButton({ onDone, onError }: { onDone: (msg: string) => void; onError: (msg: string) => void }) {
  const [busy, setBusy] = useState(false);
  async function run() {
    if (!window.confirm("Resend invoices and receipts only to people who have not had a successful send since the working From went live. People who already received theirs are skipped.")) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/emails/drain", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Drain failed");
      onDone(`Drain done — invoices ${data.invoices}, receipts ${data.receipts}, attention ${data.attentionResent ?? 0}, sweep ${data.sweepSent}, failed ${data.failed}.`);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Drain failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <button disabled={busy} onClick={run} className="rounded-sm bg-[var(--gold)] px-4 py-2 text-sm font-semibold text-[var(--navy-deep)] disabled:opacity-40">
      {busy ? "Draining…" : "Drain email queue"}
    </button>
  );
}

function BulkEmailForm() {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState("unpaid");
  const [step, setStep] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="rounded-sm border border-[var(--line)] px-4 py-2 text-sm font-semibold text-[var(--navy)]">
        Email a whole category…
      </button>
    );
  }

  async function send() {
    const label = CATEGORY_LABEL[category];
    const what = step ? STEP_LABEL[step] : `"${subject}"`;
    if (!window.confirm(`Send ${what} to everyone in "${label}"? This emails every matching candidate right now.`)) return;
    setSending(true);
    setError("");
    setResult("");
    try {
      const res = await fetch("/api/admin/bookings/bulk-email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(step ? { category, step } : { category, custom: { subject, message } }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not send that");
      setResult(`Matched ${data.matched}, sent ${data.sent}${data.failed ? `, ${data.failed} failed` : ""}.`);
      setSubject("");
      setMessage("");
      setStep("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send that");
    } finally {
      setSending(false);
    }
  }

  const ready = step ? true : Boolean(subject.trim() && message.trim());

  return (
    <div className="w-full seal-border rounded-sm bg-white p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-[var(--navy)]">Email a whole category</p>
        <button onClick={() => setOpen(false)} className="text-xs font-semibold text-[var(--ink-soft)]">Close</button>
      </div>
      {error && <p className="mt-2 rounded-sm bg-[var(--red-soft)] p-2 text-xs text-[var(--red)]">{error}</p>}
      {result && <p className="mt-2 rounded-sm bg-[var(--green-soft)] p-2 text-xs text-[var(--green)]">{result}</p>}

      <label className="mt-3 block text-xs font-semibold text-[var(--navy)]">
        Who
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="mt-1 w-full rounded-sm border border-[var(--line)] px-3 py-1.5 text-xs">
          {Object.entries(CATEGORY_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </label>

      <label className="mt-3 block text-xs font-semibold text-[var(--navy)]">
        A fixed journey email…
        <select value={step} onChange={(e) => setStep(e.target.value)} className="mt-1 w-full rounded-sm border border-[var(--line)] px-3 py-1.5 text-xs">
          <option value="">— or write a custom one below —</option>
          {Object.entries(STEP_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </label>

      {!step && (
        <>
          <input
            value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject"
            className="mt-3 w-full rounded-sm border border-[var(--line)] px-3 py-1.5 text-xs"
          />
          <textarea
            value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Message to everyone in this category…" rows={4}
            className="mt-2 w-full rounded-sm border border-[var(--line)] px-3 py-1.5 text-xs"
          />
        </>
      )}

      <button disabled={sending || !ready} onClick={send} className="mt-3 rounded-sm bg-[var(--navy)] px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">
        {sending ? "Sending…" : "Send to this category"}
      </button>
    </div>
  );
}

function CandidateCard({ b, busy, act, onUploaded }: { b: Booking; busy: boolean; act: (body: Record<string, unknown>, success?: string) => Promise<boolean>; onUploaded: () => void }) {
  const [verifying, setVerifying] = useState(false);
  const [showEmails, setShowEmails] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [officeUploadBusy, setOfficeUploadBusy] = useState<null | "photo" | "dataPage">(null);
  const [officeUploadError, setOfficeUploadError] = useState("");
  const [amount, setAmount] = useState(String(b.feeTotal));
  const [paidOn, setPaidOn] = useState(isoToday());
  const [txRef, setTxRef] = useState(b.transferReference ?? "");
  const [resend, setResend] = useState("");

  const key = b.derived.key;
  const live = b.status !== "cancelled" && b.status !== "no_show";
  const moneyIn = b.paymentStatus === "unpaid" || b.paymentStatus === "pending_verification";
  const docsToReview = b.passportDataPageUrl && b.documentStatus === "pending";
  const sent = new Set(b.journeyEmails.map((e) => e.step));

  async function officeUpload(kind: "photo" | "dataPage", file: File) {
    setOfficeUploadBusy(kind);
    setOfficeUploadError("");
    try {
      await officeUploadDocument(kind, file, b.referenceCode, b.email);
      onUploaded();
    } catch (e) {
      setOfficeUploadError(e instanceof Error ? e.message : "Could not save that document");
    } finally {
      setOfficeUploadBusy(null);
    }
  }

  async function verify() {
    const ok = await act(
      { transferAction: "verify", amountReceived: Number(amount), paidOn, transactionReference: txRef },
      `${b.fullName}: payment verified — receipt emailed.`,
    );
    if (ok) setVerifying(false);
  }

  return (
    <div className="seal-border rounded-sm bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-[var(--navy)]">
            <button
              type="button"
              onClick={() => setShowDetails(true)}
              className="text-left underline decoration-dotted underline-offset-2 hover:decoration-solid"
              title="Open full candidate record"
            >
              {b.fullName}
            </button>{" "}
            <span className="font-mono text-xs text-[var(--ink-soft)]">{b.referenceCode}</span>
          </p>
          <p className="mt-0.5 text-xs text-[var(--ink-soft)]">
            {b.session.title} · {b.modules.includes("full") ? "Written + Oral" : b.modules.join(" + ")} · {b.email}
            {b.phone ? ` · ${b.phone}` : ""} · ₦{b.feeTotal.toLocaleString()}
          </p>
          {b.idNumber && (
            <p className="mt-0.5 text-xs text-[var(--ink-soft)]">
              {b.nationality} · {b.idType} {b.idNumber}{b.idExpiry ? ` (expires ${new Date(b.idExpiry).toLocaleDateString("en-GB")})` : ""}
              {b.secondaryIdType && <> · also bringing {b.secondaryIdType}</>}
              {b.isRepeatAttempt && <span className="ml-2 rounded-sm bg-[var(--gold-soft)] px-1.5 py-0.5 text-[10px] font-bold uppercase text-[var(--navy)]">Repeat</span>}
            </p>
          )}
          {b.specialNeeds && <p className="mt-0.5 text-xs font-semibold text-[var(--navy)]">Special needs: {b.specialNeeds}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {b.express && (
            <span title={b.expressFee ? `Express result (+₦${b.expressFee.toLocaleString()})` : "Express result requested"} className="rounded-sm bg-[var(--navy)] px-2 py-0.5 text-[10px] font-bold uppercase text-white">
              Express{b.expressFee ? ` · ₦${b.expressFee.toLocaleString()}` : ""}
            </span>
          )}
          {b.prepInterestAt && <span className="rounded-sm bg-[var(--gold-bright)] px-2 py-0.5 text-[10px] font-bold uppercase text-[var(--navy-deep)]">Asked about prep</span>}
          <span
            title={b.source === "panthexa" ? "Registered on ÖSD's official Panthexa site; the office keyed this one in." : "Booked directly on this website."}
            className="rounded-sm border border-[var(--line)] px-2 py-0.5 text-[10px] font-bold uppercase text-[var(--ink-soft)]"
          >
            {b.source === "panthexa" ? "Panthexa" : "Direct (this site)"}
          </span>
          {b.seatNumber !== null && <span title="Assigned once payment is verified." className="rounded-sm bg-[var(--gold-soft)] px-2 py-0.5 text-[10px] font-bold text-[var(--navy)]">SEAT {b.seatNumber}</span>}
          <span className={`rounded-sm px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${TONE[b.derived.tone]}`}>{b.derived.label}</span>
        </div>
      </div>

      {b.derived.staffNext && live && <p className="mt-2 text-xs font-semibold text-[var(--navy)]">→ {b.derived.staffNext}</p>}

      {b.paymentStatus === "paid" && live && !["admitted", "result_pending", "result_released", "certificate_ready", "certificate_delivered"].includes(key) && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {b.checklist.map((c) => (
            <span
              key={c.label}
              title={c.done ? undefined : b.derived.staffNext ?? "Not done yet — nothing to click here until it is."}
              className={`rounded-sm px-2 py-0.5 text-[10px] font-semibold ${c.done ? "bg-[var(--green-soft)] text-[var(--green)]" : "bg-[var(--paper)] text-[var(--ink-soft)] ring-1 ring-[var(--line)]"}`}
            >
              {c.done ? "✓" : "○"} {c.label}
            </span>
          ))}
        </div>
      )}

      {(b.paymentStatus === "refund_pending" || b.paymentStatus === "refund_failed") && (
        <div className={`mt-3 rounded-sm p-2.5 text-xs font-semibold ${b.paymentStatus === "refund_failed" ? "bg-[var(--red-soft)] text-[var(--red)]" : "bg-[var(--gold-soft)] text-[var(--navy)]"}`}>
          {b.paymentStatus === "refund_failed"
            ? "⚠ Automatic refund FAILED — this candidate was charged for a sitting that filled up. Refund them manually."
            : "A card charge for a full sitting was automatically refunded via Flutterwave — check it lands."}
          {b.transferRejectedReason && <span className="mt-1 block font-normal">{b.transferRejectedReason}</span>}
        </div>
      )}

      {/* Uploaded files stay reachable forever — verifying payment used to hide the slip link. */}
      {(b.transferProofUrl || b.passportPhotoUrl || b.passportDataPageUrl) && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-sm border border-[var(--line)] bg-[var(--paper)] px-3 py-2">
          <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--ink-soft)]">Records</span>
          {b.transferProofUrl && (
            <a href={b.transferProofUrl} target="_blank" rel="noopener noreferrer" className="rounded-sm border border-[var(--line)] bg-white px-2.5 py-1 text-xs font-semibold text-[var(--navy)] hover:border-[var(--navy)]">
              Payment slip
            </a>
          )}
          {b.passportPhotoUrl && (
            <a href={b.passportPhotoUrl} target="_blank" rel="noopener noreferrer" className="rounded-sm border border-[var(--line)] bg-white px-2.5 py-1 text-xs font-semibold text-[var(--navy)] hover:border-[var(--navy)]">
              Passport photo
            </a>
          )}
          {b.passportDataPageUrl && (
            <a href={b.passportDataPageUrl} target="_blank" rel="noopener noreferrer" className="rounded-sm border border-[var(--line)] bg-white px-2.5 py-1 text-xs font-semibold text-[var(--navy)] hover:border-[var(--navy)]">
              ID data page
            </a>
          )}
        </div>
      )}

      {/* ---- the one next action, by where the candidate is ---- */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {live && moneyIn && (
          <>
            <button disabled={busy} onClick={() => setVerifying((v) => !v)} className="rounded-sm bg-[var(--green)] px-3 py-1.5 text-xs font-semibold text-white">
              Verify payment…
            </button>
            {b.paymentStatus === "pending_verification" && (
              <button
                disabled={busy}
                onClick={() => { const reason = window.prompt("Why is this transfer being rejected?"); if (reason !== null) act({ transferAction: "reject", transferRejectReason: reason }); }}
                className="rounded-sm border border-[var(--red)] px-3 py-1.5 text-xs font-semibold text-[var(--red)]"
              >
                Reject slip
              </button>
            )}
          </>
        )}
        {key === "ready_to_admit" && (
          <button disabled={busy} onClick={() => act({ admit: true }, `${b.fullName} admitted — admission letter emailed.`)} className="rounded-sm bg-[var(--green)] px-3 py-1.5 text-xs font-semibold text-white">
            Admit candidate
          </button>
        )}
        {key === "result_pending" && (
          <button disabled={busy} onClick={() => { if (window.confirm(`Tell ${b.fullName} their official result is available?`)) act({ releaseResult: true }, "Result notice sent."); }} className="rounded-sm bg-[var(--navy)] px-3 py-1.5 text-xs font-semibold text-white">
            Release result
          </button>
        )}
        {key === "result_released" && (
          <button
            disabled={busy}
            onClick={() => { const when = window.prompt("How and when can they collect it? (e.g. \"From 12 Nov, 10am–4pm, with valid ID\")", ""); if (when !== null) act({ certificateReady: when }, "Certificate notice sent."); }}
            className="rounded-sm bg-[var(--navy)] px-3 py-1.5 text-xs font-semibold text-white"
          >
            Certificate is ready…
          </button>
        )}
        {key === "certificate_ready" && (
          <button disabled={busy} onClick={() => act({ certificateDelivered: true })} className="rounded-sm bg-[var(--navy)] px-3 py-1.5 text-xs font-semibold text-white">
            Mark as delivered
          </button>
        )}

        <a href={`/api/admin/bookings/${b.id}/invoice`} target="_blank" rel="noopener noreferrer" className="rounded-sm border border-[var(--line)] px-3 py-1.5 text-xs font-semibold text-[var(--ink-soft)] hover:border-[var(--navy)] hover:text-[var(--navy)]">
          {b.paymentStatus === "paid" ? "Receipt PDF" : "Invoice PDF"}
        </a>
        <button onClick={() => setShowEmails((v) => !v)} className="rounded-sm border border-[var(--line)] px-3 py-1.5 text-xs font-semibold text-[var(--ink-soft)] hover:border-[var(--navy)] hover:text-[var(--navy)]">
          Emails ({b.journeyEmails.length})
        </button>
        {(key === "admitted" || (b.paymentStatus === "paid" && key !== "cancelled" && key !== "no_show" && b.status === "confirmed" && ["admitted"].includes(key))) && (
          <button disabled={busy} onClick={() => { if (window.confirm(`Mark ${b.fullName} as not having attended?`)) act({ markNoShow: true }); }} className="rounded-sm border border-[var(--line)] px-3 py-1.5 text-xs font-semibold text-[var(--ink-soft)] hover:border-[var(--red)] hover:text-[var(--red)]">
            No-show
          </button>
        )}
        {live && (
          <button
            disabled={busy}
            title="Cancelling also frees up this email to book again, if you need to let a test or duplicate entry re-register."
            onClick={() => { const reason = window.prompt("Why is this booking being cancelled?"); if (reason !== null) act({ cancelReason: reason }); }}
            className="rounded-sm border border-[var(--line)] px-3 py-1.5 text-xs font-semibold text-[var(--ink-soft)] hover:border-[var(--red)] hover:text-[var(--red)]"
          >
            Cancel
          </button>
        )}
        {!live && (
          <button
            disabled={busy}
            onClick={async () => {
              if (!window.confirm(`Permanently delete ${b.fullName} (${b.referenceCode})? This cannot be undone.`)) return;
              const res = await fetch(`/api/admin/bookings/${b.id}`, { method: "DELETE" });
              const data = await res.json().catch(() => ({}));
              if (!res.ok) { window.alert(data.error ?? "Could not delete"); return; }
              onUploaded();
            }}
            className="rounded-sm border border-[var(--red)] px-3 py-1.5 text-xs font-semibold text-[var(--red)]"
          >
            Delete permanently
          </button>
        )}
      </div>

      {verifying && (
        <div className="mt-3 rounded-sm bg-[var(--green-soft)]/60 p-3">
          <p className="text-xs font-semibold text-[var(--navy)]">What the Moniepoint statement shows — this fills the receipt&apos;s Payment Confirmation block.</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            <Field label="Amount received (₦)" value={amount} onChange={setAmount} type="number" />
            <Field label="Date received" value={paidOn} onChange={setPaidOn} type="date" />
            <Field label="Transaction reference" value={txRef} onChange={setTxRef} />
          </div>
          {Number(amount) < b.feeTotal && <p className="mt-2 text-xs text-[var(--red)]">That&apos;s less than the ₦{b.feeTotal.toLocaleString()} due — it can&apos;t be verified as paid in full.</p>}
          <button disabled={busy || !Number(amount)} onClick={verify} className="mt-3 rounded-sm bg-[var(--green)] px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-40">
            {busy ? "Verifying…" : "Confirm payment & email the receipt"}
          </button>
        </div>
      )}

      {showDetails && (
        <Modal title={b.fullName} onClose={() => setShowDetails(false)} wide>
          <p className="mb-3 text-xs text-[var(--ink-soft)]">
            <span className="font-mono font-semibold text-[var(--navy)]">{b.referenceCode}</span>
            {" · "}{b.session.title}
            {" · "}{b.derived.label}
          </p>
          <div className="mb-4 flex flex-wrap gap-2">
            <a
              href={`mailto:${b.email}?subject=${encodeURIComponent(`Re: your ÖSD booking ${b.referenceCode}`)}`}
              className="rounded-sm bg-[var(--navy)] px-3 py-1.5 text-xs font-semibold text-white"
            >
              Reply by email
            </a>
            {b.phone && (
              <a href={`tel:${b.phone}`} className="rounded-sm border border-[var(--line)] px-3 py-1.5 text-xs font-semibold text-[var(--navy)]">
                Call {b.phone}
              </a>
            )}
            {b.transferProofUrl && (
              <a href={b.transferProofUrl} target="_blank" rel="noopener noreferrer" className="rounded-sm border border-[var(--line)] px-3 py-1.5 text-xs font-semibold text-[var(--navy)]">
                Payment slip
              </a>
            )}
            {b.passportPhotoUrl && (
              <a href={b.passportPhotoUrl} target="_blank" rel="noopener noreferrer" className="rounded-sm border border-[var(--line)] px-3 py-1.5 text-xs font-semibold text-[var(--navy)]">
                Passport photo
              </a>
            )}
            {b.passportDataPageUrl && (
              <a href={b.passportDataPageUrl} target="_blank" rel="noopener noreferrer" className="rounded-sm border border-[var(--line)] px-3 py-1.5 text-xs font-semibold text-[var(--navy)]">
                ID data page
              </a>
            )}
          </div>
          <dl className="grid gap-px overflow-hidden rounded-sm border border-[var(--line)] bg-[var(--line)] sm:grid-cols-2">
            <DetailCell label="Phone" value={b.phone} />
            <DetailCell label="Email" value={b.email} />
            <DetailCell label="Gender" value={b.gender} />
            <DetailCell label="Date of birth" value={new Date(b.dateOfBirth).toLocaleDateString("en-GB")} />
            <DetailCell label="Place of birth" value={b.placeOfBirth} />
            <DetailCell label="Country of birth" value={b.countryOfBirth} />
            <DetailCell label="Citizenship" value={b.nationality} />
            <DetailCell label="Address" value={b.addressLine} />
            <DetailCell label="City" value={b.city} />
            <DetailCell label="Country (residence)" value={b.country} />
            <DetailCell label="1st ID" value={b.idType && b.idNumber ? `${b.idType} · ${b.idNumber}` : null} />
            <DetailCell label="1st ID expiry" value={b.idExpiry ? new Date(b.idExpiry).toLocaleDateString("en-GB") : null} />
            <DetailCell label="2nd ID to bring" value={b.secondaryIdType} />
            <DetailCell label="Repeat attempt" value={b.isRepeatAttempt ? "Yes" : "No"} />
            <DetailCell label="Express result" value={b.express ? `Yes${b.expressFee ? ` (+₦${b.expressFee.toLocaleString()})` : ""}` : "No"} />
            <DetailCell label="Fee total" value={`₦${b.feeTotal.toLocaleString()}`} />
            <DetailCell label="Payment status" value={b.paymentStatus} />
            <DetailCell label="Booking status" value={b.status} />
            {b.panthexaReference && <DetailCell label="Panthexa reference" value={b.panthexaReference} />}
            {b.registeredAt && <DetailCell label="Registered on Panthexa" value={new Date(b.registeredAt).toLocaleDateString("en-GB")} />}
            {b.consentAcceptedAt && <DetailCell label="Consented" value={new Date(b.consentAcceptedAt).toLocaleString("en-GB")} />}
            {b.examRegistrationLink && <DetailCell label="ÖSD registration link sent" value="Yes — see /admin/registration-links" />}
            {b.specialNeeds && <DetailCell label="Special needs" value={b.specialNeeds} />}
          </dl>

          {b.documentStatus !== "approved" && (
            <div className="mt-4 rounded-sm border border-[var(--line)] bg-[var(--paper)] p-3">
              <p className="text-xs font-bold uppercase tracking-wide text-[var(--ink-soft)]">
                Upload their ID for them (walk-in or if they can&apos;t upload it themselves)
              </p>
              {officeUploadError && <p className="mt-1 text-xs text-[var(--red)]">{officeUploadError}</p>}
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <label className="block text-xs font-semibold text-[var(--navy)]">
                  Passport photograph {b.passportPhotoUrl ? "✓" : ""}
                  <input
                    type="file" accept="image/*" disabled={officeUploadBusy === "photo"}
                    onChange={(e) => e.target.files?.[0] && officeUpload("photo", e.target.files[0])}
                    className="mt-1 block w-full text-sm text-[var(--ink-soft)] file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-[var(--navy)] file:px-4 file:py-2.5 file:text-sm file:font-semibold file:text-white disabled:cursor-not-allowed disabled:file:opacity-40"
                  />
                </label>
                <label className="block text-xs font-semibold text-[var(--navy)]">
                  Passport data page {b.passportDataPageUrl ? "✓" : ""}
                  <input
                    type="file" accept="image/*,application/pdf" disabled={officeUploadBusy === "dataPage"}
                    onChange={(e) => e.target.files?.[0] && officeUpload("dataPage", e.target.files[0])}
                    className="mt-1 block w-full text-sm text-[var(--ink-soft)] file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-[var(--navy)] file:px-4 file:py-2.5 file:text-sm file:font-semibold file:text-white disabled:cursor-not-allowed disabled:file:opacity-40"
                  />
                </label>
              </div>
            </div>
          )}
        </Modal>
      )}

      {docsToReview && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-sm bg-blue-50 p-2.5">
          <span className="text-xs font-semibold text-blue-900">ID documents:</span>
          {b.passportPhotoUrl && <a href={b.passportPhotoUrl} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-blue-700 underline">Photo</a>}
          <a href={b.passportDataPageUrl!} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-blue-700 underline">Data page</a>
          <button disabled={busy} onClick={() => act({ documentAction: "approved" })} className="rounded-sm bg-[var(--green)] px-3 py-1.5 text-xs font-semibold text-white">Approve</button>
          <button
            disabled={busy}
            onClick={() => { const reason = window.prompt("What's wrong with the documents?"); if (reason !== null) act({ documentAction: "rejected", documentRejectReason: reason }); }}
            className="rounded-sm border border-[var(--red)] px-3 py-1.5 text-xs font-semibold text-[var(--red)]"
          >
            Reject
          </button>
        </div>
      )}

      {showEmails && (
        <div className="mt-3 rounded-sm border border-[var(--line)] p-3">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--ink-soft)]">
            Status is SMTP handoff — not inbox proof. Unverified / failed →{" "}
            <a href="/admin/emails" className="text-[var(--navy)] underline">Email attention</a>
          </p>
          {b.journeyEmails.length === 0 ? (
            <p className="text-xs text-[var(--ink-soft)]">No emails logged yet.</p>
          ) : (
            <ul className="space-y-2 text-xs text-[var(--ink-soft)]">
              {b.journeyEmails.map((e) => {
                const d = deliveryLabel({
                  status: e.status ?? "accepted",
                  sentAt: e.sentAt,
                  messageId: e.messageId,
                  lastError: e.lastError,
                  provider: e.provider,
                });
                const tone =
                  d.tone === "bad"
                    ? "text-[var(--red)]"
                    : d.tone === "warn"
                      ? "text-[var(--navy)]"
                      : "text-[var(--green)]";
                return (
                  <li key={e.step} className="rounded-sm bg-[var(--paper)] px-2 py-1.5">
                    <span className="font-semibold text-[var(--navy)]">{STEP_LABEL[e.step] ?? e.step}</span>
                    <span className="text-[var(--ink-soft)]"> — {new Date(e.sentAt).toLocaleString("en-GB")}</span>
                    <p className={`mt-0.5 font-semibold ${tone}`}>{d.label}</p>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <select value={resend} onChange={(e) => setResend(e.target.value)} className="rounded-sm border border-[var(--line)] px-2 py-1.5 text-xs">
              <option value="">Send or resend an email…</option>
              {Object.entries(STEP_LABEL).map(([step, label]) => (
                <option key={step} value={step}>{label}{sent.has(step) ? " (logged — resend)" : ""}</option>
              ))}
            </select>
            <button
              disabled={busy || !resend}
              onClick={async () => { if (await act({ resendStep: resend }, "Email handed to Brevo again.")) setResend(""); }}
              className="rounded-sm bg-[var(--navy)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
            >
              Send
            </button>
          </div>
          <CustomEmailComposer bookingId={b.id} fullName={b.fullName} busy={busy} act={act} />
        </div>
      )}
    </div>
  );
}

/** The office's own free-text note to this one candidate — for whatever isn't one of the fixed journey steps. */
function CustomEmailComposer({ bookingId, fullName, busy, act }: { bookingId: string; fullName: string; busy: boolean; act: (body: Record<string, unknown>, success?: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="mt-2 text-xs font-semibold text-[var(--navy)] underline underline-offset-4">
        Or write a different email…
      </button>
    );
  }

  async function send() {
    setSending(true);
    try {
      const ok = await act({ customEmail: { subject, message } }, `Sent to ${fullName}.`);
      if (ok) { setSubject(""); setMessage(""); setOpen(false); }
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mt-3 rounded-sm border border-[var(--line)] bg-[var(--paper)] p-3">
      <p className="text-xs font-bold uppercase tracking-wide text-[var(--ink-soft)]">Write a different email</p>
      <input
        value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject"
        className="mt-2 w-full rounded-sm border border-[var(--line)] bg-white px-2 py-1.5 text-xs"
      />
      <textarea
        value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Your message to this candidate…" rows={4}
        className="mt-2 w-full rounded-sm border border-[var(--line)] bg-white px-2 py-1.5 text-xs"
      />
      <div className="mt-2 flex gap-2">
        <button disabled={busy || sending || !subject.trim() || !message.trim()} onClick={send} className="rounded-sm bg-[var(--navy)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">
          {sending ? "Sending…" : "Send"}
        </button>
        <button onClick={() => setOpen(false)} className="rounded-sm border border-[var(--line)] px-3 py-1.5 text-xs font-semibold text-[var(--ink-soft)]">Cancel</button>
      </div>
    </div>
  );
}

function DetailCell({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="bg-white px-3 py-2.5">
      <dt className="text-[10px] font-bold uppercase tracking-wide text-[var(--ink-soft)]">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold text-[var(--navy)] break-words">{value}</dd>
    </div>
  );
}

function Field({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <label className="block">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--ink-soft)]">{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} className="mt-0.5 w-full rounded-sm border border-[var(--line)] bg-white px-3 py-1.5 text-xs focus:border-[var(--navy)] focus:outline-none" />
    </label>
  );
}
