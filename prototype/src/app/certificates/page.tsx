"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import StudentShell from "@/components/StudentShell";
import CertificateDocument from "@/components/CertificateDocument";
import TuitionNudge from "@/components/TuitionNudge";
import { safeJson } from "@/lib/safe-json";
import type { CertificateView } from "@/lib/certificates";

/**
 * The student's certificates.
 *
 * Was four hardcoded placeholder cards ("A1 German Completion", "Passed with
 * excellence") that belonged to nobody. Now every card is a real issued
 * document rendered by the same component that prints it, so the thumbnail is
 * the certificate rather than a description of one.
 */

type Payload = {
  level: string;
  outstanding: number;
  pending: string | null;
  certificates: CertificateView[];
};

export default function CertificatesPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/student/certificates", { cache: "no-store", credentials: "include" });
        const json = await safeJson(res);
        if (!res.ok || !json) throw new Error(json?.error || "Could not load your certificates");
        if (!cancelled) setData(json as Payload);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load your certificates");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const certificates = data?.certificates ?? [];

  return (
    <StudentShell>
      <main className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
        <div className="mx-auto max-w-7xl px-6 py-10">
          <div className="rounded-[32px] border border-[var(--border)] bg-[var(--surface)] p-8 shadow-[var(--shadow)]">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-sm uppercase tracking-[0.3em] text-[var(--muted)]">Certificates</p>
                <h1 className="mt-3 text-3xl font-semibold">Your earned certificates</h1>
                <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">
                  Every completed session is certified. Each certificate carries a serial and a verification code
                  that anyone — an employer, a consulate — can check without contacting the school.
                </p>
              </div>
              <div className="rounded-full bg-[var(--accent-soft)] px-4 py-2 text-sm font-semibold text-[var(--accent)]">
                Verified credentials
              </div>
            </div>

            {/* The one thing that changes the document: an open balance stamps it. */}
            {data && data.outstanding > 0 ? <TuitionNudge className="mt-8" /> : null}

            {loading ? (
              <p className="mt-10 rounded-3xl border border-[var(--border)] bg-[var(--surface-alt)] px-6 py-10 text-center text-sm text-[var(--muted)]">
                Loading your certificates…
              </p>
            ) : error ? (
              <p className="mt-10 rounded-3xl border border-rose-200 bg-rose-50 px-6 py-10 text-center text-sm text-rose-700">
                {error}
              </p>
            ) : certificates.length === 0 ? (
              <div className="mt-10 rounded-3xl border border-[var(--border)] bg-[var(--surface-alt)] px-6 py-12 text-center">
                <p className="text-lg font-semibold">No certificate yet</p>
                <p className="mx-auto mt-3 max-w-xl text-sm text-[var(--muted)]">
                  {data?.pending ??
                    "Your certificate appears here as soon as your session is complete."}
                </p>
                {data?.pending?.includes("deposit") ? (
                  <Link
                    href="/programs"
                    className="mt-6 inline-flex rounded-full bg-[var(--accent)] px-6 py-3 text-sm font-semibold text-white"
                  >
                    Pay tuition
                  </Link>
                ) : null}
              </div>
            ) : (
              <div className="mt-10 grid gap-8 xl:grid-cols-2">
                {certificates.map((cert) => (
                  <CertificateCard key={cert.id} cert={cert} />
                ))}
              </div>
            )}

            {/* Both outcomes are certified, and students should know that up front. */}
            <div className="mt-10 rounded-3xl border border-[var(--border)] bg-[var(--surface-alt)] p-6 text-sm text-[var(--muted)]">
              <p className="font-semibold text-[var(--foreground)]">How certificates are awarded</p>
              <p className="mt-2">
                Reaching the pass mark earns a <strong>Certificate of Achievement</strong>, banded Pass, Merit or
                Distinction by your overall score. Completing the session without reaching it earns a{" "}
                <strong>Certificate of Completion</strong>, recording the level you studied and the session you
                attended. Every student who finishes receives one.
              </p>
            </div>
          </div>
        </div>
      </main>
    </StudentShell>
  );
}

function CertificateCard({ cert }: { cert: CertificateView }) {
  return (
    <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface-alt)] p-5 shadow-sm">
      {/* The thumbnail IS the certificate — same component, same numbers. */}
      <Link href={`/certificates/${cert.id}`} className="block overflow-hidden rounded-2xl shadow-lg">
        <CertificateDocument certificate={cert} />
      </Link>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-lg font-semibold">
            {cert.level} · {cert.title}
          </p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            {cert.serial} · issued{" "}
            {new Date(cert.issuedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
            {cert.provisional ? " · provisional" : ""}
          </p>
        </div>
        <Link
          href={`/certificates/${cert.id}`}
          className="rounded-full bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
        >
          Open &amp; download
        </Link>
      </div>
    </div>
  );
}
