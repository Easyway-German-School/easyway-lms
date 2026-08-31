"use client";

export const dynamic = "force-dynamic";

import Link from "next/link";
import { useEffect, useState } from "react";
import ResultSheet from "@/components/ResultSheet";
import { ArrowLeftIcon } from "@/components/icons";
import type { ResultSheet as ResultSheetData } from "@/lib/result-sheet";

/**
 * The student's own result sheet, ready to print or save as PDF.
 *
 * Deliberately outside StudentShell — same reasoning as the certificate print
 * page: the shell's sidebar and padlock would print with it, and this page
 * exists to put one sheet of A4 on screen and then on paper. Download is the
 * browser's own print-to-PDF; the thing printed is literally the thing on
 * screen, so it cannot drift from a separate PDF pipeline.
 */

export default function ResultSheetPage() {
  const [sheet, setSheet] = useState<ResultSheetData | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/student/results/sheet", { cache: "no-store", credentials: "include" });
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok || !json?.sheet) {
          setState("error");
          return;
        }
        setSheet(json.sheet as ResultSheetData);
        setState("ready");
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === "loading") {
    return (
      <main className="grid min-h-screen place-items-center app-canvas text-[var(--muted)]">
        Preparing your result sheet…
      </main>
    );
  }

  if (state === "error" || !sheet) {
    return (
      <main className="grid min-h-screen place-items-center app-canvas px-6 text-center text-[var(--muted)]">
        <div>
          <p className="text-xl font-semibold text-[var(--foreground)]">Result sheet unavailable</p>
          <p className="mt-2 text-sm">We could not build your result sheet. Try again from your results page.</p>
          <Link href="/results" className="mt-6 inline-flex rounded-full border border-[var(--border)] bg-[var(--surface)] px-5 py-2.5 text-sm text-[var(--foreground)]">
            Back to results
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="app-canvas min-h-screen py-8">
      <div className="mx-auto mb-6 flex max-w-[820px] flex-wrap items-center justify-between gap-4 px-6 print:hidden">
        <Link href="/results" className="inline-flex items-center gap-2 text-sm text-[var(--muted)] underline underline-offset-4">
          <ArrowLeftIcon /> Back to results
        </Link>
        <div className="flex items-center gap-3">
          <a
            href="/api/student/results/sheet?format=csv"
            className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-5 py-2.5 text-sm font-semibold text-[var(--foreground)]"
          >
            Download CSV
          </a>
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-full btn-glow px-6 py-3 text-sm font-bold text-white shadow-lg transition hover:brightness-110"
          >
            Print / Save as PDF
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-[820px] px-6 print:max-w-none print:px-0">
        <ResultSheet sheet={sheet} />
      </div>

      <p className="mx-auto mt-6 max-w-[820px] px-6 text-xs text-[var(--muted)] print:hidden">
        Choose “Save as PDF” as the destination in the print dialogue. The sheet is already set to A4.
      </p>
    </main>
  );
}
