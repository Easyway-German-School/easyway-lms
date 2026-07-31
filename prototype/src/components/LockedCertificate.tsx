"use client";

import Link from "next/link";
import { motion } from "framer-motion";

import CertificateDocument from "@/components/CertificateDocument";
import { CheckCircleIcon, LockIcon, SparklesIcon } from "@/components/icons";
import type { CertificateView } from "@/lib/certificates";

/**
 * The certificate a student has not earned yet — shown anyway, sealed.
 *
 * This is the single most motivating object in the portal and it used to be an
 * empty state that said "No certificate yet". A named, dated, sealed document
 * with THEIR name on it, visible but behind glass, is a completely different
 * proposition: it turns an abstract future reward into a specific one they can
 * already picture on a wall. That is the whole reason it exists.
 *
 * Two rules keep this honest, and neither is negotiable:
 *
 * 1. The preview is unmistakably a preview. It is blurred, it carries a
 *    VORSCHAU / PREVIEW band, and the serial reads as pending rather than as a
 *    number. Nobody should be able to screenshot this and pass it off as issued
 *    — that would be forging the school's own document.
 * 2. What unlocks it is stated plainly, in the student's own numbers. The
 *    upsell is "here is what is left", never a vague nudge to pay.
 *
 * The document itself is the real <CertificateDocument />, not a mock-up of
 * one, so the thing they are shown is exactly the thing they will get.
 */

export type LockedIdentity = {
  studentName: string;
  studentCode: string | null;
  branchName: string | null;
  tutorName: string | null;
  batch?: string | null;
};

/**
 * A plausible finished certificate for this student.
 *
 * Deliberately built here rather than imported from `lib/certificates`: that
 * module reaches for Prisma, and this is a client component. The shape is the
 * contract, and it is small enough to state honestly in one place.
 */
function previewCertificate(identity: LockedIdentity, level: string): CertificateView {
  const upper = (level || "A1").toUpperCase();
  return {
    id: "preview",
    kind: "achievement",
    title: "Certificate of Achievement",
    level: upper,
    award: "distinction",
    awardLabel: "Distinction",
    citation: `has satisfied the examiners in the ${upper} course of German language study and is awarded this certificate with Distinction.`,
    serial: `EW/CERT/${new Date().getFullYear()}/${upper}/••••`,
    verifyCode: "•••••-•••••",
    averageScore: null,
    passed: true,
    studentName: identity.studentName,
    studentCode: identity.studentCode,
    branchName: identity.branchName,
    tutorName: identity.tutorName,
    issuedAt: new Date().toISOString(),
    revoked: false,
    provisional: false,
    outstanding: 0,
  };
}

export default function LockedCertificate({
  identity,
  level,
  reason,
  outstanding,
}: {
  identity: LockedIdentity;
  level: string;
  /** Why it is still locked, from the certificates endpoint. */
  reason: string | null;
  outstanding: number;
}) {
  const cert = previewCertificate(identity, level);
  const owesDeposit = Boolean(reason?.toLowerCase().includes("deposit"));

  // The two gates, in the order a student meets them. Each says whether it is
  // already behind them, because a half-finished checklist pulls harder than a
  // list of things you have not started.
  const steps = [
    {
      done: !owesDeposit,
      title: "Start your classes",
      detail: owesDeposit
        ? "Your tuition deposit opens the classroom — and the certificate track with it."
        : "Done. You are enrolled and your attendance is being recorded.",
    },
    {
      done: false,
      title: `Finish your ${level.toUpperCase()} session`,
      detail: "Certificates are issued at the end of the two-month session, automatically.",
    },
  ];

  return (
    <div className="relative overflow-hidden rounded-[32px] border border-[var(--border)] bg-[var(--surface-alt)] p-5 shadow-[var(--shadow)] sm:p-7">
      {/* A warm bloom behind the sealed sheet — the prize is lit even while it
          is out of reach. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full blur-[90px]"
        style={{ background: "radial-gradient(circle, color-mix(in srgb, var(--accent) 40%, transparent), transparent 68%)" }}
      />

      <div className="relative grid gap-7 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
        {/* ---- The sealed document ------------------------------------- */}
        <div className="relative">
          <div className="overflow-hidden rounded-2xl shadow-2xl">
            <div className="scale-[1.02] blur-[3px] saturate-[0.85] transition duration-500 [transform-origin:center] group-hover:blur-[2px]">
              <CertificateDocument certificate={cert} />
            </div>
          </div>

          {/* Frosted glass over the sheet. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-2xl"
            style={{
              background:
                "linear-gradient(160deg, rgba(5,48,46,0.55), rgba(5,48,46,0.30) 45%, rgba(255,102,0,0.22))",
            }}
          />

          {/* The band that keeps this honest: it is a preview, and it says so
              in both languages, across the face of the sheet. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 -rotate-[7deg] border-y border-white/25 bg-black/25 py-1.5 text-center text-[11px] font-black uppercase tracking-[0.5em] text-white/85 backdrop-blur-[1px] sm:text-sm"
          >
            Vorschau · Preview
          </div>

          {/* The padlock. */}
          <motion.div
            className="pointer-events-none absolute inset-0 grid place-items-center"
            initial={{ scale: 0.86, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 220, damping: 18 }}
          >
            <motion.div
              animate={{ y: [0, -6, 0] }}
              transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
              className="grid h-24 w-24 place-items-center rounded-3xl border border-white/30 bg-black/45 text-white shadow-2xl backdrop-blur-md sm:h-28 sm:w-28"
            >
              <LockIcon className="h-11 w-11 sm:h-12 sm:w-12" strokeWidth={1.7} />
            </motion.div>
          </motion.div>
        </div>

        {/* ---- What opens it -------------------------------------------- */}
        <div>
          <p className="inline-flex items-center gap-2 rounded-full bg-[var(--accent-soft)] px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--accent)]">
            <SparklesIcon className="h-3.5 w-3.5" /> Deine Urkunde
          </p>

          <h2 className="mt-4 text-2xl font-extrabold leading-tight text-[var(--foreground)] sm:text-3xl">
            {identity.studentName.split(" ")[0]}, this one already has your name on it.
          </h2>
          <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
            It is printed, sealed and serialised the moment your {level.toUpperCase()} session closes — the same
            document, with the blur taken off. Employers and consulates can verify it from the code on the sheet.
          </p>

          <ol className="mt-6 space-y-3">
            {steps.map((step) => (
              <li
                key={step.title}
                className={`flex gap-3 rounded-2xl border p-3.5 ${
                  step.done
                    ? "border-[var(--success)]/30 bg-[var(--success-soft)]"
                    : "border-[var(--border)] bg-[var(--surface)]"
                }`}
              >
                <span className="mt-0.5 shrink-0">
                  {step.done ? (
                    <CheckCircleIcon className="h-5 w-5 text-[var(--success)]" />
                  ) : (
                    <LockIcon className="h-5 w-5 text-[var(--muted)]" />
                  )}
                </span>
                <span>
                  <span className="block text-sm font-bold text-[var(--foreground)]">{step.title}</span>
                  <span className="mt-0.5 block text-xs leading-5 text-[var(--muted)]">{step.detail}</span>
                </span>
              </li>
            ))}
          </ol>

          {owesDeposit ? (
            <Link
              href="/programs"
              className="mt-6 inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-6 py-3 text-sm font-bold text-white shadow-lg transition hover:brightness-110"
            >
              Pay your deposit and start
            </Link>
          ) : outstanding > 0 ? (
            <Link
              href="/programs"
              className="mt-6 inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-6 py-3 text-sm font-bold text-white shadow-lg transition hover:brightness-110"
            >
              Clear ₦{Math.round(outstanding).toLocaleString()} to keep it unstamped
            </Link>
          ) : null}

          {/* An open balance does not withhold the certificate — it stamps it.
              Saying so here is what makes the stamp a real consequence rather
              than a surprise on the day. */}
          {outstanding > 0 ? (
            <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
              A balance still owing on issue day prints a <strong>PROVISIONAL</strong> watermark across the face of
              it. Clearing the balance removes the watermark on your next reload — nothing to request.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
