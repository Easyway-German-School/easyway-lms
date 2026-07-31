import Link from "next/link";

import { AWARD_LABELS, type Award } from "@/lib/grading";
import { prisma } from "@/lib/prisma";
import { CERTIFICATE_TITLES, type CertificateKind } from "@/lib/certificates";
import { CheckCircleIcon } from "@/components/icons";

/**
 * The page a printed verification URL leads to.
 *
 * Server-rendered and public. Someone checking a certificate is usually not a
 * student, will not sign in, and may be pasting the code from paper — so this
 * has to work on a cold visit with no JavaScript state and no account.
 *
 * It reads the database directly rather than calling `/api/verify/[code]`: an
 * internal fetch from a server component to our own route would double the
 * round trip for no gain. The route stays for anyone integrating against it.
 */

export const dynamic = "force-dynamic";

export default async function VerifyPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const normalised = decodeURIComponent(String(code ?? "")).trim().toUpperCase();

  const certificate = /^[A-Z0-9-]{6,24}$/.test(normalised)
    ? await prisma.certificate.findUnique({
        where: { verifyCode: normalised },
        select: {
          kind: true,
          level: true,
          award: true,
          serial: true,
          studentName: true,
          studentCode: true,
          branchName: true,
          issuedAt: true,
          revokedAt: true,
        },
      })
    : null;

  return (
    <main className="grid min-h-screen place-items-center bg-gradient-to-b from-[#070f22] via-[#0b1830] to-[#070f22] px-6 py-16">
      <div className="w-full max-w-xl rounded-[32px] border border-[#c8a24a]/30 bg-white/[0.03] p-8 text-slate-200 shadow-[0_30px_80px_-40px_rgba(200,162,74,0.4)]">
        <p className="text-[0.7rem] font-semibold uppercase tracking-[0.3em] text-[#c8a24a]">
          Easyway German Language School
        </p>
        <h1 className="mt-3 font-serif text-3xl font-semibold text-white">Certificate verification</h1>

        {!certificate ? (
          <div className="mt-8 rounded-2xl border border-rose-400/30 bg-rose-950/30 p-6">
            <p className="text-lg font-semibold text-rose-200">No match</p>
            <p className="mt-2 text-sm text-rose-200/80">
              No certificate on record carries the code <span className="font-mono">{normalised || "—"}</span>. Check
              it against the printed document — the code has ten characters and one hyphen.
            </p>
          </div>
        ) : certificate.revokedAt ? (
          <div className="mt-8 rounded-2xl border border-rose-400/30 bg-rose-950/30 p-6">
            <p className="text-lg font-semibold text-rose-200">Revoked</p>
            <p className="mt-2 text-sm text-rose-200/80">
              Certificate {certificate.serial} was issued but has since been revoked by the school and should not be
              relied upon.
            </p>
          </div>
        ) : (
          <>
            <div className="mt-8 flex items-center gap-3 rounded-2xl border border-emerald-400/30 bg-emerald-950/30 px-5 py-4">
              <CheckCircleIcon className="h-7 w-7 shrink-0 text-emerald-300" />
              <p className="text-sm font-semibold text-emerald-200">
                Genuine — this certificate was issued by the school.
              </p>
            </div>

            <dl className="mt-8 grid gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 sm:grid-cols-2">
              <Row label="Awarded to" value={certificate.studentName} />
              <Row label="Student ID" value={certificate.studentCode ?? "—"} />
              <Row label="Certificate" value={CERTIFICATE_TITLES[certificate.kind as CertificateKind]} />
              <Row label="Level" value={certificate.level} />
              <Row label="Award" value={AWARD_LABELS[certificate.award as Award] ?? certificate.award} />
              <Row label="Branch" value={certificate.branchName ?? "—"} />
              <Row label="Serial" value={certificate.serial} />
              <Row
                label="Issued"
                value={certificate.issuedAt.toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              />
            </dl>
          </>
        )}

        <p className="mt-8 text-xs text-[var(--muted)]">
          Verification confirms the document and the name on it. For anything further, contact the branch that issued
          it.{" "}
          <Link href="/" className="underline underline-offset-4">
            Easyway home
          </Link>
        </p>
      </div>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#0b1830] px-5 py-4">
      <dt className="text-[0.65rem] uppercase tracking-[0.2em] text-[#c8a24a]/80">{label}</dt>
      <dd className="mt-1 text-sm font-semibold text-white">{value}</dd>
    </div>
  );
}
