"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { SiteFooter } from "@/components/SiteChrome";
import PageHero from "@/components/PageHero";
import NeedHelp from "@/components/NeedHelp";
import EditBookingDetails from "@/components/EditBookingDetails";
import hallstatt from "@/assets/images/hero-hallstatt.jpg";

type Booking = {
  referenceCode: string;
  fullName: string;
  email: string;
  phone: string;
  addressLine: string | null;
  city: string | null;
  country: string;
  dateOfBirth: string;
  placeOfBirth: string;
  countryOfBirth: string | null;
  nationality: string;
  idType: string | null;
  idNumber: string | null;
  idExpiry: string | null;
  isRepeatAttempt: boolean;
  specialNeeds: string | null;
  modules: string[];
  feeTotal: number;
  paymentMethod: string | null;
  paymentStatus: string;
  transferRejectedReason: string | null;
  passportPhotoUrl: string | null;
  passportDataPageUrl: string | null;
  documentStatus: string;
  documentRejectedReason: string | null;
  seatNumber: number | null;
  status: string;
  invoiceNumber: string;
  derived: { key: string; label: string };
  journey: { key: string; label: string; state: "done" | "current" | "todo"; hint: string | null }[];
  missingFields: string[];
  infoConfirmedAt: string | null;
  admittedAt: string | null;
  prepInterestAt: string | null;
  certificateCollection: string | null;
  session: { title: string; level: string; venueName: string; venueAddress: string; startDate: string; endDate: string; startTime: string | null; arrivalTime: string | null };
};

/**
 * Every upload is tied to the booking it belongs to — the endpoint verifies
 * `reference`+`email` own a real booking before accepting anything, closing
 * off /api/upload as an anonymous file-drop unrelated to any booking.
 */
async function uploadFile(file: File, folder: string, reference: string, email: string): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  form.append("folder", folder);
  form.append("reference", reference);
  form.append("email", email);
  const res = await fetch("/api/upload", { method: "POST", body: form });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Upload failed");
  return data.url as string;
}

export default function BookingPage() {
  return (
    <Suspense>
      <BookingPageInner />
    </Suspense>
  );
}

function BookingPageInner() {
  const params = useParams<{ reference: string }>();
  const search = useSearchParams();
  const email = search.get("email") ?? "";
  const justBooked = search.get("justBooked") === "1";

  const [booking, setBooking] = useState<Booking | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/bookings/${params.reference}?email=${encodeURIComponent(email)}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        setState("missing");
        return;
      }
      setBooking(data.booking);
      setState("ready");
    } catch {
      setState("missing");
    }
  }, [params.reference, email]);

  useEffect(() => { load(); }, [load]);

  if (state === "loading") {
    return <Shell><p className="text-sm text-[var(--ink-soft)]">Loading your booking…</p></Shell>;
  }
  if (state === "missing" || !booking) {
    return <Shell><p className="text-sm text-[var(--red)]">We couldn't find that booking. Check your reference code and email on the <a className="underline" href="/status">status page</a>.</p></Shell>;
  }

  const admitted = Boolean(booking.admittedAt);
  const paid = booking.paymentStatus === "paid";
  const heading = admitted ? "You're admitted" : booking.derived.label;

  return (
    <div className="min-h-screen">
      <PageHero
        eyebrow={`Booking · ${booking.referenceCode}`}
        title={heading}
        subtitle={`${booking.session.title} · ${new Date(booking.session.startDate).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`}
        image={hallstatt}
        alt="Hallstatt, Austria, mirrored in a still alpine lake at dawn"
        position="object-[60%_45%]"
      />
      <main className="relative z-10 mx-auto -mt-16 max-w-2xl px-5 pb-20 sm:px-6">
        {admitted ? (
          <ConfirmedTicket booking={booking} email={email} />
        ) : (
          <div className="rounded-2xl bg-white p-6 shadow-xl shadow-[var(--navy)]/15 ring-1 ring-black/5 sm:p-8">
            <JourneyTracker booking={booking} />
            {paid ? (
              <RegistrationProgress booking={booking} email={email} onChange={load} />
            ) : (
              <PendingBooking booking={booking} email={email} onChange={load} error={error} setError={setError} justBooked={justBooked} />
            )}
          </div>
        )}

        {!admitted && <DocumentsPanel booking={booking} email={email} onChange={load} />}
      </main>
      <SiteFooter />
    </div>
  );
}

/** Where the candidate is on the road, and the one thing that is theirs to do next. */
function JourneyTracker({ booking }: { booking: Booking }) {
  if (booking.derived.key === "cancelled" || booking.derived.key === "no_show") return null;
  return (
    <ol className="mb-7 space-y-0">
      {booking.journey.map((step, i) => (
        <li key={step.key} className="flex gap-3">
          <div className="flex flex-col items-center">
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                step.state === "done"
                  ? "bg-[var(--green)] text-white"
                  : step.state === "current"
                    ? "bg-[var(--gold-bright)] text-[var(--navy-deep)] ring-4 ring-[var(--gold-soft)]"
                    : "border border-[var(--line)] bg-white text-[var(--ink-soft)]"
              }`}
            >
              {step.state === "done" ? "✓" : i + 1}
            </span>
            {i < booking.journey.length - 1 && <span className={`w-px flex-1 ${step.state === "done" ? "bg-[var(--green)]/50" : "bg-[var(--line)]"}`} style={{ minHeight: "14px" }} />}
          </div>
          <div className="pb-3">
            <p className={`text-sm ${step.state === "todo" ? "text-[var(--ink-soft)]" : "font-semibold text-[var(--navy)]"}`}>{step.label}</p>
            {step.hint && <p className="mt-0.5 text-xs text-[var(--ink-soft)]">{step.hint}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

function invoiceHref(booking: Booking, email: string) {
  return `/api/bookings/${booking.referenceCode}/invoice?email=${encodeURIComponent(email)}`;
}

/** Paid, not yet admitted: complete the details, confirm them, and wait for the office. */
function RegistrationProgress({ booking, email, onChange }: { booking: Booking; email: string; onChange: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const missing = booking.missingFields;
  const confirmed = Boolean(booking.infoConfirmedAt);

  async function confirm() {
    setConfirming(true);
    setError("");
    try {
      const res = await fetch(`/api/bookings/${booking.referenceCode}/confirm-info`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not confirm your details");
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not confirm your details");
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div>
      <p className="rounded-lg bg-[var(--green-soft)] px-4 py-3 text-sm font-semibold text-[var(--green)]">
        Payment verified. Your registration is now moving to admission.
      </p>

      {!confirmed && (
        <div className="mt-5">
          <p className="text-sm font-semibold text-[var(--navy)]">Check your details</p>
          <p className="mt-1 text-xs text-[var(--ink-soft)]">
            Your name and details must match the identification document you will bring on the day.
            {missing.length > 0 && <> We still need: <strong>{missing.join(", ")}</strong>.</>}
          </p>
          <EditBookingDetails
            key={missing.join(",")}
            startOpen={missing.length > 0}
            referenceCode={booking.referenceCode}
            email={email}
            initial={booking}
            onSaved={onChange}
          />
          {error && <p className="mt-3 text-xs text-[var(--red)]">{error}</p>}
          <button
            onClick={confirm}
            disabled={confirming || missing.length > 0}
            className="mt-4 rounded-lg bg-[var(--navy)] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
          >
            {confirming ? "Confirming…" : "These details are correct"}
          </button>
          {missing.length > 0 && <p className="mt-2 text-[11px] text-[var(--ink-soft)]">Fill in the missing details above first.</p>}
        </div>
      )}
      {confirmed && (
        <div className="mt-5 text-xs text-[var(--ink-soft)]">
          You confirmed your details. If you spot a mistake before you are admitted, edit them again — you&apos;ll be asked to re-confirm.
          <EditBookingDetails referenceCode={booking.referenceCode} email={email} initial={booking} onSaved={onChange} />
        </div>
      )}

      <p className="mt-5 text-xs text-[var(--ink-soft)]">
        <a className="font-semibold text-[var(--navy)] underline" href={invoiceHref(booking, email)}>Download your receipt (PDF)</a>
      </p>

      {/* Not while they still have chores to do — the soft sell waits for a calm moment (same rule as the email). */}
      {confirmed && (
        <div className="mt-6">
          <PrepInterest booking={booking} email={email} onChange={onChange} />
        </div>
      )}
      <div className="mt-6">
        <NeedHelp bookingReference={booking.referenceCode} defaultName={booking.fullName} defaultEmail={booking.email} />
      </div>
    </div>
  );
}

/** The soft prep-class door: one tap, no price, no payment. */
function PrepInterest({ booking, email, onChange }: { booking: Booking; email: string; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const asked = Boolean(booking.prepInterestAt);

  async function ask() {
    setBusy(true);
    try {
      await fetch(`/api/bookings/${booking.referenceCode}/prep-interest`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      onChange();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--gold-soft)]/30 p-5 print:hidden">
      <p className="text-sm font-semibold text-[var(--navy)]">Want company on the way to exam day?</p>
      <p className="mt-1 text-sm text-[var(--ink-soft)]">
        Easyway runs exam-preparation classes built around this exact examination. Optional — it has no bearing on your registration, admission or result.
      </p>
      {asked ? (
        <p className="mt-3 text-sm font-semibold text-[var(--green)]">Thanks — our classes team will be in touch with dates.</p>
      ) : (
        <button onClick={ask} disabled={busy} className="mt-3 rounded-lg border border-[var(--navy)] px-4 py-2 text-sm font-semibold text-[var(--navy)] disabled:opacity-40">
          {busy ? "Sending…" : "Tell me about prep classes"}
        </button>
      )}
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <PageHero
        eyebrow="Booking"
        title="Your booking"
        image={hallstatt}
        alt="Hallstatt, Austria, mirrored in a still alpine lake at dawn"
        position="object-[60%_45%]"
      />
      <main className="relative z-10 mx-auto -mt-14 max-w-2xl px-5 pb-20 sm:px-6">
        <div className="rounded-2xl bg-white p-6 shadow-xl shadow-[var(--navy)]/15 ring-1 ring-black/5 sm:p-8">{children}</div>
      </main>
      <SiteFooter />
    </div>
  );
}

function ConfirmedTicket({ booking, email }: { booking: Booking; email: string }) {
  return (
    <div>
      <div id="printable-ticket" className="overflow-hidden rounded-2xl bg-white shadow-xl shadow-[var(--navy)]/15 ring-1 ring-black/5 print:rounded-none print:shadow-none print:ring-black/30">
        <div className="flex items-center justify-between gap-3 bg-gradient-to-r from-[var(--navy)] to-[#12325c] px-6 py-4 text-white print:bg-none print:text-[var(--navy)]">
          <span className="font-serif-display text-base font-semibold sm:text-lg">Easyway ÖSD Examination Centre</span>
          <span className="shrink-0 rounded-full bg-[var(--gold-bright)] px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-[var(--navy-deep)] print:bg-transparent print:ring-1 print:ring-black/40">
            Admission Slip
          </span>
        </div>

        <div className={`grid ${booking.seatNumber !== null ? "sm:grid-cols-[1fr_11rem] print:grid-cols-[1fr_11rem]" : ""}`}>
          <div className="p-6 sm:p-8">
            <h2 className="text-xl font-semibold text-[var(--navy)]">{booking.session.title}</h2>
            <p className="mt-1 text-sm text-[var(--ink-soft)]">
              {booking.session.venueName}, {booking.session.venueAddress}
            </p>
            <p className="text-sm text-[var(--ink-soft)]">
              {new Date(booking.session.startDate).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
            </p>
            <p className="mt-1 text-xs font-semibold text-[var(--red)]">
              {booking.session.arrivalTime
                ? `Please arrive by ${booking.session.arrivalTime}${booking.session.startTime ? ` — the examination starts at ${booking.session.startTime}` : ""}.`
                : "Please arrive 60 minutes before the examination starts."}
            </p>

            <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-[var(--line)] pt-6 text-sm">
              <div>
                <dt className="text-xs uppercase tracking-wide text-[var(--ink-soft)]">Candidate</dt>
                <dd className="font-semibold text-[var(--navy)]">{booking.fullName}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-[var(--ink-soft)]">Reference</dt>
                <dd className="font-mono font-semibold text-[var(--navy)]">{booking.referenceCode}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-xs uppercase tracking-wide text-[var(--ink-soft)]">Modules</dt>
                <dd className="font-semibold text-[var(--navy)]">{booking.modules.includes("full") ? "Whole exam" : booking.modules.join(", ")}</dd>
              </div>
            </dl>
          </div>

          {/* The stub: the seat number is the whole point of the page. */}
          {booking.seatNumber !== null && <div className="flex flex-col items-center justify-center border-t border-dashed border-[var(--line)] bg-gradient-to-b from-[var(--gold-soft)] to-[#fbf6e6] p-6 text-center sm:border-l sm:border-t-0 print:border-l print:border-t-0 print:bg-none">
            <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-[var(--ink-soft)]">Seat</p>
            <p className="font-serif-display text-7xl font-bold leading-none text-[var(--navy)]">{booking.seatNumber}</p>
            <div className="barcode mt-5 w-24 text-[var(--navy)]" aria-hidden="true" />
            <p className="mt-2 font-mono text-[10px] tracking-widest text-[var(--ink-soft)]">{booking.referenceCode}</p>
          </div>}
        </div>

        <p className="border-t border-[var(--line)] px-6 py-4 text-xs leading-5 text-[var(--ink-soft)] sm:px-8">
          Bring this slip, your international passport's data page, and a normal ballpoint pen. Mobile phones and
          smart watches must be switched off during the exam.
          {booking.documentStatus !== "approved" && (
            <span className="mt-2 block font-semibold text-[var(--red)]">
              Your documents are {booking.documentStatus === "rejected" ? "awaiting re-upload" : "still awaiting review"} — see below.
            </span>
          )}
        </p>
      </div>

      <div className="mt-5 flex justify-end print:hidden">
        <button onClick={() => window.print()} className="rounded-full bg-[var(--navy)] px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-[var(--navy)]/25 transition hover:brightness-125">
          Print admission slip
        </button>
      </div>

      <div className="mt-8 rounded-lg border border-[var(--line)] p-5 print:hidden">
        <p className="text-sm font-semibold text-[var(--navy)]">What to bring, and what not to do</p>
        <ul className="mt-2 space-y-1.5 text-sm text-[var(--ink-soft)]">
          <li>• This admission slip, printed, and your international passport's data page.</li>
          <li>• A normal ballpoint pen — no pencils, no correction fluid.</li>
          <li>• Arrive on time — 60 minutes before the start. Latecomers may not be admitted.</li>
          <li>• Phones and smart watches off and out of reach for the whole exam.</li>
        </ul>
        <div className="mt-4">
          <NeedHelp bookingReference={booking.referenceCode} defaultName={booking.fullName} defaultEmail={booking.email} />
        </div>
      </div>

      <div className="mt-8">
        <PrepInterest booking={booking} email={email} onChange={() => window.location.reload()} />
      </div>
    </div>
  );
}

function PendingBooking({ booking, email, onChange, error, setError, justBooked }: { booking: Booking; email: string; onChange: () => void; error: string; setError: (s: string) => void; justBooked?: boolean }) {
  const [account, setAccount] = useState<{ bankName: string; accountName: string; accountNumber: string } | null>(null);
  const [cardEnabled, setCardEnabled] = useState(false);
  const [slipFile, setSlipFile] = useState<File | null>(null);
  const [reference, setReference] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [startingCard, setStartingCard] = useState(false);

  useEffect(() => {
    if (booking.paymentStatus !== "unpaid") return;
    fetch(`/api/bookings/${booking.referenceCode}/payment?email=${encodeURIComponent(email)}`)
      .then((r) => r.json())
      .then((d) => {
        setAccount(d.account);
        setCardEnabled(Boolean(d.cardPaymentsEnabled));
      })
      .catch(() => {});
  }, [booking.referenceCode, booking.paymentStatus, email]);

  async function payByCard() {
    setStartingCard(true);
    setError("");
    try {
      const res = await fetch(`/api/bookings/${booking.referenceCode}/card-payment`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not start the card payment");
      // Straight to Flutterwave's hosted checkout; the callback route settles
      // the booking regardless of whether the candidate makes it back here.
      window.location.href = data.paymentLink;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the card payment");
      setStartingCard(false);
    }
  }

  async function submitSlip() {
    if (!slipFile) return;
    setSubmitting(true);
    setError("");
    try {
      const url = await uploadFile(slipFile, "slips", booking.referenceCode, email);
      const res = await fetch(`/api/bookings/${booking.referenceCode}/payment`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, transferProofUrl: url, transferReference: reference.trim() || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not submit that payment");
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not submit that payment");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      {justBooked && (
        <div className="relative mb-6 overflow-hidden rounded-xl bg-gradient-to-br from-[var(--navy)] via-[#12325c] to-[var(--navy)] px-5 py-5 text-white ring-1 ring-[var(--gold-bright)]/50">
          <div className="pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full bg-[var(--gold-bright)]/25 blur-2xl" />
          <p className="font-serif-display relative text-xl font-semibold">
            Congratulations on your booking! <span aria-hidden="true">✈</span>
          </p>
          <p className="relative mt-1.5 text-sm text-white/80">
            We&apos;ve emailed your reference code to {booking.email}. Complete payment below to reserve your seat.
          </p>
        </div>
      )}
      <h2 className="font-serif-display text-2xl font-semibold text-[var(--navy)]">{booking.session.title}</h2>
      <p className="mt-1 text-sm text-[var(--ink-soft)]">Reference: <span className="font-mono">{booking.referenceCode}</span></p>

      {booking.paymentStatus === "unpaid" && (
        <EditBookingDetails referenceCode={booking.referenceCode} email={email} initial={booking} onSaved={onChange} />
      )}

      {error && <p className="mt-4 rounded-lg bg-[var(--red-soft)] px-4 py-3 text-sm text-[var(--red)]">{error}</p>}

      {booking.paymentStatus === "pending_verification" && (
        <p className="mt-6 rounded-lg bg-[var(--gold-soft)] px-4 py-3 text-sm font-semibold text-[var(--navy)]">
          Receipt submitted — the office is confirming your payment landed. This page will update once it is verified.
        </p>
      )}

      {booking.paymentStatus === "unpaid" && (
        <div className="mt-6 seal-border rounded-lg bg-[var(--paper-raised)] p-6">
          <p className="text-sm font-semibold text-[var(--navy)]">Amount due: ₦{booking.feeTotal.toLocaleString()}</p>
          <p className="mt-1 text-xs text-[var(--ink-soft)]">
            Invoice {booking.invoiceNumber} ·{" "}
            <a className="font-semibold text-[var(--navy)] underline" href={invoiceHref(booking, email)}>Download invoice (PDF)</a>
          </p>
          {booking.transferRejectedReason && (
            <p className="mt-2 rounded-lg bg-[var(--red-soft)] p-3 text-xs text-[var(--red)]">
              Your last transfer couldn't be confirmed: {booking.transferRejectedReason}
            </p>
          )}
          {account && (
            <>
              <dl className="mt-4 space-y-1.5 text-sm">
                <div><dt className="inline text-[var(--ink-soft)]">Bank: </dt><dd className="inline font-semibold">{account.bankName}</dd></div>
                <div><dt className="inline text-[var(--ink-soft)]">Account name: </dt><dd className="inline font-semibold">{account.accountName}</dd></div>
                <div><dt className="inline text-[var(--ink-soft)]">Account number: </dt><dd className="inline font-mono font-semibold">{account.accountNumber || "Ask the office"}</dd></div>
              </dl>
              <p className="mt-3 text-xs text-[var(--ink-soft)]">
                Pay from a commercial bank, not a wallet/MFB app. This booking is not reversible or refundable once confirmed.
              </p>
              <label className="mt-4 block text-xs font-semibold text-[var(--navy)]">
                Upload your payment receipt
                <input type="file" accept="image/*,application/pdf" onChange={(e) => setSlipFile(e.target.files?.[0] ?? null)} className="mt-1 block w-full text-xs" />
              </label>
              <input
                type="text" placeholder="Transfer reference (optional)" value={reference} onChange={(e) => setReference(e.target.value)}
                className="mt-2 w-full rounded-lg border border-[var(--line)] px-3 py-2 text-xs"
              />
              <button
                onClick={submitSlip}
                disabled={!slipFile || submitting}
                className="mt-3 rounded-lg bg-[var(--gold)] px-5 py-2.5 text-sm font-semibold text-[var(--navy-deep)] disabled:opacity-40"
              >
                {submitting ? "Submitting…" : "I've paid — submit receipt"}
              </button>
            </>
          )}

          {cardEnabled && (
            <div className="mt-6 border-t border-[var(--line)] pt-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-soft)]">
                Paying from outside Nigeria?
              </p>
              <p className="mt-1 text-xs text-[var(--ink-soft)]">
                If you can't make a Nigerian bank transfer, pay the same ₦{booking.feeTotal.toLocaleString()} by
                international card instead. Your bank may add its own foreign-transaction fee — that's between
                you and your card issuer, not an Easyway charge.
              </p>
              <button
                onClick={payByCard}
                disabled={startingCard}
                className="mt-3 rounded-lg border border-[var(--navy)] px-5 py-2.5 text-sm font-semibold text-[var(--navy)] disabled:opacity-40"
              >
                {startingCard ? "Opening checkout…" : "Pay by international card"}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="mt-6">
        <NeedHelp bookingReference={booking.referenceCode} defaultName={booking.fullName} defaultEmail={booking.email} />
      </div>
    </div>
  );
}

function DocumentsPanel({ booking, email, onChange }: { booking: Booking; email: string; onChange: () => void }) {
  const [busy, setBusy] = useState<null | "photo" | "dataPage">(null);
  const [error, setError] = useState("");

  async function upload(kind: "photo" | "dataPage", file: File) {
    setBusy(kind);
    setError("");
    try {
      const url = await uploadFile(file, kind === "photo" ? "photos" : "documents", booking.referenceCode, email);
      const res = await fetch(`/api/bookings/${booking.referenceCode}/documents`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, ...(kind === "photo" ? { passportPhotoUrl: url } : { passportDataPageUrl: url }) }),
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

  return (
    <div className="mt-8 rounded-lg border border-[var(--line)] bg-[var(--paper-raised)] p-6 print:hidden">
      <p className="text-xs font-bold uppercase tracking-wide text-[var(--ink-soft)]">Documents</p>
      {error && <p className="mt-2 text-xs text-[var(--red)]">{error}</p>}
      {booking.documentRejectedReason && (
        <p className="mt-2 rounded-lg bg-[var(--red-soft)] p-2 text-xs text-[var(--red)]">{booking.documentRejectedReason}</p>
      )}
      {booking.documentStatus === "approved" && <p className="mt-2 text-xs font-semibold text-[var(--green)]">Approved</p>}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-semibold text-[var(--navy)]">
          Passport photograph {booking.passportPhotoUrl ? "✓" : ""}
          <input type="file" accept="image/*" disabled={busy === "photo"} onChange={(e) => e.target.files?.[0] && upload("photo", e.target.files[0])} className="mt-1 block w-full text-xs" />
        </label>
        <label className="block text-xs font-semibold text-[var(--navy)]">
          Passport data page {booking.passportDataPageUrl ? "✓" : ""}
          <input type="file" accept="image/*,application/pdf" disabled={busy === "dataPage"} onChange={(e) => e.target.files?.[0] && upload("dataPage", e.target.files[0])} className="mt-1 block w-full text-xs" />
        </label>
      </div>
    </div>
  );
}
