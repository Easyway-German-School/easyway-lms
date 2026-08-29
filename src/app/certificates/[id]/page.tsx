"use client";

import Link from "next/link";
import { ArrowLeftIcon } from "@/components/icons";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import CertificateDocument from "@/components/CertificateDocument";
import { safeJson } from "@/lib/safe-json";
import type { CertificateView } from "@/lib/certificates";
import { DEFAULT_CERTIFICATE_TEMPLATE, type CertificateTemplate } from "@/lib/certificate-template";

/**
 * One certificate, full size, ready to print or save as PDF.
 *
 * Deliberately outside StudentShell. The shell's sidebar and padlock logic have
 * no business on a page whose whole purpose is to put one sheet of A4 on screen
 * and then on paper — and the shell would print with it.
 *
 * Download is the browser's own print-to-PDF rather than a server-rendered PDF.
 * Adding a headless-Chrome or pdfkit pipeline to reproduce this design would
 * mean maintaining the certificate twice, and the two would drift; here the
 * thing printed is literally the thing on screen. The `@page` rule in
 * CertificateDocument sets A4 landscape so the default print dialogue is
 * already correct.
 *
 * It reads the list endpoint rather than a per-certificate route so that
 * ownership is enforced in exactly one place: `/api/student/certificates`
 * returns only the signed-in student's own certificates, which makes guessing
 * an id pointless.
 */

export default function CertificatePrintPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [cert, setCert] = useState<CertificateView | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");
  const [origin, setOrigin] = useState("");
  // The school's own wording, from the same response as the certificate — this
  // is the page people actually print, so it must not fall back to the
  // built-in defaults while the roster thumbnail shows the edited version.
  const [template, setTemplate] = useState<CertificateTemplate>(DEFAULT_CERTIFICATE_TEMPLATE);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/student/certificates", { cache: "no-store", credentials: "include" });
        const json = await safeJson(res);
        const found = (json?.certificates as CertificateView[] | undefined)?.find((c) => c.id === id);
        if (cancelled) return;
        if (!res.ok || !found) {
          setState("missing");
          return;
        }
        if (json?.template) setTemplate(json.template as CertificateTemplate);
        setCert(found);
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
        Preparing your certificate…
      </main>
    );
  }

  if (state === "missing" || !cert) {
    return (
      <main className="grid min-h-screen place-items-center app-canvas px-6 text-center text-[var(--muted)]">
        <div>
          <p className="text-xl font-semibold text-[var(--foreground)]">Certificate not found</p>
          <p className="mt-2 text-sm">This certificate does not exist, or it is not yours to view.</p>
          <Link href="/certificates" className="mt-6 inline-flex rounded-full border border-[var(--border)] bg-[var(--surface)] px-5 py-2.5 text-sm text-[var(--foreground)]">
            Back to certificates
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="app-canvas min-h-screen py-8">
      {/* The toolbar must not print — hence `print:hidden` on every part of it. */}
      <div className="mx-auto mb-6 flex max-w-[1180px] flex-wrap items-center justify-between gap-4 px-6 print:hidden">
        <div>
          <Link href="/certificates" className="inline-flex items-center gap-2 text-sm text-[var(--muted)] underline underline-offset-4">
            <ArrowLeftIcon /> All certificates
          </Link>
          <p className="mt-2 text-lg font-semibold text-[var(--foreground)]">
            {cert.level} · {cert.title}
          </p>
          <p className="text-xs text-[var(--muted)]">{cert.serial}</p>
        </div>
        <div className="flex items-center gap-3">
          {cert.provisional ? (
            <Link
              href="/programs"
              className="rounded-full border border-[var(--accent)]/60 px-5 py-2.5 text-sm font-semibold text-[var(--accent)]"
            >
              Clear ₦{cert.outstanding.toLocaleString()} to remove the stamp
            </Link>
          ) : null}
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-full btn-glow px-6 py-3 text-sm font-bold text-white shadow-lg transition hover:brightness-110"
          >
            Download as PDF
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-[1180px] px-6 print:max-w-none print:px-0">
        <CertificateDocument certificate={cert} verifyBaseUrl={origin} template={template} />
      </div>

      <p className="mx-auto mt-6 max-w-[1180px] px-6 text-xs text-[var(--muted)] print:hidden">
        Choose “Save as PDF” as the destination in the print dialogue. The sheet is already set to A4 landscape.
      </p>
    </main>
  );
}
