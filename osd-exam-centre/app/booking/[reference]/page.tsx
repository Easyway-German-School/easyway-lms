"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { SiteHeader, SiteFooter } from "@/components/SiteChrome";
import NeedHelp from "@/components/NeedHelp";
import EditBookingDetails from "@/components/EditBookingDetails";

type Booking = {
  referenceCode: string;
  fullName: string;
  email: string;
  phone: string;
  addressLine: string;
  city: string;
  country: string;
  dateOfBirth: string;
  placeOfBirth: string;
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
  session: { title: string; level: string; venueName: string; venueAddress: string; startDate: string; endDate: string };
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

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-6 py-12">
        {booking.seatNumber !== null ? (
          <ConfirmedTicket booking={booking} />
        ) : (
          <PendingBooking booking={booking} email={email} onChange={load} error={error} setError={setError} justBooked={justBooked} />
        )}

        <DocumentsPanel booking={booking} email={email} onChange={load} />
      </main>
      <SiteFooter />
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-6 py-16">{children}</main>
      <SiteFooter />
    </div>
  );
}

function ConfirmedTicket({ booking }: { booking: Booking }) {
  return (
    <div>
      <div className="mb-6 flex items-center justify-between print:hidden">
        <h1 className="font-serif-display text-2xl font-semibold text-[var(--navy)]">Your seat is confirmed</h1>
        <button onClick={() => window.print()} className="rounded-sm bg-[var(--navy)] px-5 py-2.5 text-sm font-semibold text-white">
          Print admission slip
        </button>
      </div>

      <div id="printable-ticket" className="seal-border rounded-sm bg-[var(--paper-raised)] p-8">
        <div className="flex items-center justify-between border-b border-[var(--line)] pb-5">
          <span className="font-serif-display text-lg font-semibold text-[var(--navy)]">Easyway ÖSD Examination Centre</span>
          <span className="rounded-sm bg-[var(--gold-soft)] px-3 py-1 text-xs font-bold uppercase tracking-wide text-[var(--navy)]">Admission Slip</span>
        </div>

        <h2 className="mt-5 text-xl font-semibold text-[var(--navy)]">{booking.session.title}</h2>
        <p className="text-sm text-[var(--ink-soft)]">
          {booking.session.venueName}, {booking.session.venueAddress}
        </p>
        <p className="text-sm text-[var(--ink-soft)]">
          {new Date(booking.session.startDate).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
        </p>
        <p className="mt-1 text-xs font-semibold text-[var(--red)]">Please arrive 30 minutes early.</p>

        <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-[var(--line)] pt-6 text-sm">
          <div>
            <dt className="text-xs uppercase tracking-wide text-[var(--ink-soft)]">Candidate</dt>
            <dd className="font-semibold text-[var(--navy)]">{booking.fullName}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-[var(--ink-soft)]">Reference</dt>
            <dd className="font-mono font-semibold text-[var(--navy)]">{booking.referenceCode}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-[var(--ink-soft)]">Modules</dt>
            <dd className="font-semibold text-[var(--navy)]">{booking.modules.includes("full") ? "Whole exam" : booking.modules.join(", ")}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-[var(--ink-soft)]">Seat number</dt>
            <dd className="font-serif-display text-2xl font-bold text-[var(--gold)]">{booking.seatNumber}</dd>
          </div>
        </dl>

        <p className="mt-8 border-t border-[var(--line)] pt-4 text-xs leading-5 text-[var(--ink-soft)]">
          Bring this slip, your international passport's data page, and a normal ballpoint pen. Mobile phones and
          smart watches must be switched off during the exam.
          {booking.documentStatus !== "approved" && (
            <span className="mt-2 block font-semibold text-[var(--red)]">
              Your documents are {booking.documentStatus === "rejected" ? "awaiting re-upload" : "still awaiting review"} — see below.
            </span>
          )}
        </p>
      </div>

      <div className="mt-8 rounded-sm border border-[var(--line)] p-5 print:hidden">
        <p className="text-sm font-semibold text-[var(--navy)]">What to bring, and what not to do</p>
        <ul className="mt-2 space-y-1.5 text-sm text-[var(--ink-soft)]">
          <li>• This admission slip, printed, and your international passport's data page.</li>
          <li>• A normal ballpoint pen — no pencils, no correction fluid.</li>
          <li>• Arrive 30 minutes early. Latecomers may not be admitted.</li>
          <li>• Phones and smart watches off and out of reach for the whole exam.</li>
        </ul>
        <div className="mt-4">
          <NeedHelp bookingReference={booking.referenceCode} defaultName={booking.fullName} defaultEmail={booking.email} />
        </div>
      </div>

      <div className="mt-8 rounded-sm border border-[var(--line)] bg-[var(--gold-soft)]/30 p-5 print:hidden">
        <p className="text-sm font-semibold text-[var(--navy)]">Ready to prepare?</p>
        <p className="mt-1 text-sm text-[var(--ink-soft)]">
          ÖSD rewards candidates who know its format. Easyway's prep classes practise exactly the way the exam is marked.
        </p>
        <a href="https://easywayschoollms.com.ng/exams/osd" className="mt-3 inline-block text-sm font-semibold text-[var(--navy)] underline">
          Explore prep classes →
        </a>
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
        <div className="mb-6 rounded-sm border border-[var(--gold)] bg-[var(--gold-soft)] px-5 py-4">
          <p className="font-serif-display text-lg font-semibold text-[var(--navy)]">Congratulations on your booking!</p>
          <p className="mt-1 text-sm text-[var(--ink-soft)]">
            We've emailed your reference code to {booking.email}. Complete payment below to reserve your seat.
          </p>
        </div>
      )}
      <h1 className="font-serif-display text-2xl font-semibold text-[var(--navy)]">{booking.session.title}</h1>
      <p className="mt-1 text-sm text-[var(--ink-soft)]">Reference: <span className="font-mono">{booking.referenceCode}</span></p>

      {booking.paymentStatus === "unpaid" && (
        <EditBookingDetails
          referenceCode={booking.referenceCode}
          email={email}
          initial={{
            fullName: booking.fullName, phone: booking.phone, addressLine: booking.addressLine,
            city: booking.city, country: booking.country, dateOfBirth: booking.dateOfBirth, placeOfBirth: booking.placeOfBirth,
          }}
          onSaved={onChange}
        />
      )}

      {error && <p className="mt-4 rounded-sm bg-[var(--red-soft)] px-4 py-3 text-sm text-[var(--red)]">{error}</p>}

      {booking.paymentStatus === "pending_verification" && (
        <p className="mt-6 rounded-sm bg-[var(--gold-soft)] px-4 py-3 text-sm font-semibold text-[var(--navy)]">
          Payment slip submitted — the office is confirming it landed. Your seat number will appear here once confirmed.
        </p>
      )}

      {booking.paymentStatus === "unpaid" && (
        <div className="mt-6 seal-border rounded-sm bg-[var(--paper-raised)] p-6">
          <p className="text-sm font-semibold text-[var(--navy)]">Amount due: ₦{booking.feeTotal.toLocaleString()}</p>
          {booking.transferRejectedReason && (
            <p className="mt-2 rounded-sm bg-[var(--red-soft)] p-3 text-xs text-[var(--red)]">
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
                className="mt-2 w-full rounded-sm border border-[var(--line)] px-3 py-2 text-xs"
              />
              <button
                onClick={submitSlip}
                disabled={!slipFile || submitting}
                className="mt-3 rounded-sm bg-[var(--gold)] px-5 py-2.5 text-sm font-semibold text-[var(--navy-deep)] disabled:opacity-40"
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
                className="mt-3 rounded-sm border border-[var(--navy)] px-5 py-2.5 text-sm font-semibold text-[var(--navy)] disabled:opacity-40"
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
    <div className="mt-8 rounded-sm border border-[var(--line)] bg-[var(--paper-raised)] p-6 print:hidden">
      <p className="text-xs font-bold uppercase tracking-wide text-[var(--ink-soft)]">Documents</p>
      {error && <p className="mt-2 text-xs text-[var(--red)]">{error}</p>}
      {booking.documentRejectedReason && (
        <p className="mt-2 rounded-sm bg-[var(--red-soft)] p-2 text-xs text-[var(--red)]">{booking.documentRejectedReason}</p>
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
