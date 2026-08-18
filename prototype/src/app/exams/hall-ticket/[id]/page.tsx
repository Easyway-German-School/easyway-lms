"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import BrandLogo from "@/components/BrandLogo";
import { ArrowLeftIcon, PrinterIcon } from "@/components/icons";
import { safeJson } from "@/lib/safe-json";

/**
 * One admission slip, ready to print.
 *
 * Same shape as `/certificates/[id]`: reads the list endpoint (`/api/my-exams`)
 * rather than a per-registration route, so ownership is enforced in exactly
 * one place — a signed-in student can only ever find their own bookings in
 * that list, which makes guessing an id pointless. Printing is the browser's
 * own print-to-PDF, matching the certificate page rather than adding a second
 * PDF pipeline to maintain.
 */

type Ticket = {
  registrationId: string;
  name: string;
  examBody: string | null;
  level: string | null;
  examDate: string;
  seatNumber: string | null;
  branchName: string | null;
  paymentStatus: string;
};

export default function HallTicketPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [candidate, setCandidate] = useState<{ name: string | null; studentCode: string | null }>({ name: null, studentCode: null });
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/my-exams", { cache: "no-store", credentials: "include" });
        const json = await safeJson(res);
        const all = [...(json?.upcoming ?? []), ...(json?.past ?? [])];
        const found = all.find((r: { registrationId: string }) => r.registrationId === id);
        if (cancelled) return;
        if (!res.ok || !found || (found.paymentStatus !== "paid" && found.paymentStatus !== "waived")) {
          setState("missing");
          return;
        }
        setTicket(found);
        setCandidate({ name: json?.name ?? null, studentCode: json?.studentCode ?? null });
        setState("ready");
      } catch {
        if (!cancelled) setState("missing");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (state === "loading") {
    return (
      <main className="grid min-h-screen place-items-center app-canvas text-[var(--muted)]">
        Preparing your hall ticket…
      </main>
    );
  }

  if (state === "missing" || !ticket) {
    return (
      <main className="grid min-h-screen place-items-center app-canvas px-6 text-center text-[var(--muted)]">
        <div>
          <p className="text-xl font-semibold text-[var(--foreground)]">Hall ticket not available</p>
          <p className="mt-2 text-sm">
            This booking isn't yours, doesn't exist, or its fee hasn't been settled yet.
          </p>
          <Link href="/exams" className="mt-6 inline-flex rounded-full border border-[var(--border)] bg-[var(--surface)] px-5 py-2.5 text-sm text-[var(--foreground)]">
            Back to my exams
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="app-canvas min-h-screen py-8">
      <div className="mx-auto mb-6 flex max-w-2xl flex-wrap items-center justify-between gap-4 px-6 print:hidden">
        <Link href="/exams" className="inline-flex items-center gap-2 text-sm text-[var(--muted)] underline underline-offset-4">
          <ArrowLeftIcon /> All exams
        </Link>
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 rounded-full btn-glow px-6 py-3 text-sm font-bold text-white shadow-lg transition hover:brightness-110"
        >
          <PrinterIcon className="h-4 w-4" /> Print hall ticket
        </button>
      </div>

      <div className="mx-auto max-w-2xl rounded-[28px] cinematic-card p-8 shadow-[var(--shadow)] print:rounded-none print:border-0 print:shadow-none">
        <div className="flex items-center justify-between border-b border-[var(--border)] pb-6">
          <BrandLogo variant="wordmark" className="h-9" />
          <span className="rounded-full bg-[var(--accent-soft)] px-4 py-1.5 text-xs font-bold uppercase tracking-[0.2em] text-[var(--accent)]">
            Admission slip
          </span>
        </div>

        <h1 className="mt-6 text-2xl font-extrabold text-[var(--foreground)]">{ticket.examBody === "internal" ? "EasyWay" : ticket.examBody} exam</h1>
        <p className="text-sm text-[var(--muted)]">{new Date(ticket.examDate).toDateString()}</p>

        <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-[var(--border)] pt-6 text-sm">
          <div>
            <dt className="text-xs uppercase tracking-wide text-[var(--muted)]">Candidate</dt>
            <dd className="mt-1 font-semibold text-[var(--foreground)]">{candidate.name ?? ticket.name}</dd>
          </div>
          {candidate.studentCode && (
            <div>
              <dt className="text-xs uppercase tracking-wide text-[var(--muted)]">Student code</dt>
              <dd className="mt-1 font-mono font-semibold text-[var(--foreground)]">{candidate.studentCode}</dd>
            </div>
          )}
          {ticket.level && (
            <div>
              <dt className="text-xs uppercase tracking-wide text-[var(--muted)]">Level</dt>
              <dd className="mt-1 font-semibold text-[var(--foreground)]">{ticket.level}</dd>
            </div>
          )}
          {ticket.branchName && (
            <div>
              <dt className="text-xs uppercase tracking-wide text-[var(--muted)]">Centre</dt>
              <dd className="mt-1 font-semibold text-[var(--foreground)]">{ticket.branchName}</dd>
            </div>
          )}
          <div>
            <dt className="text-xs uppercase tracking-wide text-[var(--muted)]">Seat number</dt>
            <dd className="mt-1 font-mono text-lg font-bold text-[var(--accent)]">{ticket.seatNumber ?? "—"}</dd>
          </div>
        </dl>

        <p className="mt-8 border-t border-[var(--border)] pt-4 text-xs leading-5 text-[var(--muted)]">
          Bring a valid photo ID and this slip to the exam centre. Arrive at least 30 minutes before the sitting time.
        </p>
      </div>
    </main>
  );
}
