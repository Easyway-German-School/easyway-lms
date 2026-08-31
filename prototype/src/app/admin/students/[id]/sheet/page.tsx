"use client";

export const dynamic = "force-dynamic";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import ResultSheet from "@/components/ResultSheet";
import { ArrowLeftIcon } from "@/components/icons";
import type { ResultSheet as ResultSheetData } from "@/lib/result-sheet";

/**
 * The office copy of a student's result sheet, ready to print or save as PDF.
 * Standalone (no AdminShell) for the same reason the certificate print page is:
 * the sheet is the whole page, and the sidebar would print with it.
 */

export default function AdminResultSheetPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [sheet, setSheet] = useState<ResultSheetData | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/admin/students/${id}/sheet`, { cache: "no-store", credentials: "include" });
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
  }, [id]);

  if (state === "loading") {
    return (
      <main className="grid min-h-screen place-items-center bg-[var(--background)] text-[var(--muted)]">
        Preparing the result sheet…
      </main>
    );
  }

  if (state === "error" || !sheet) {
    return (
      <main className="grid min-h-screen place-items-center bg-[var(--background)] px-6 text-center text-[var(--muted)]">
        <div>
          <p className="text-xl font-semibold text-[var(--foreground)]">Result sheet unavailable</p>
          <p className="mt-2 text-sm">This student does not exist, or you do not have access.</p>
          <Link href="/admin/students" className="mt-6 inline-flex rounded-full border border-[var(--border)] bg-[var(--surface)] px-5 py-2.5 text-sm text-[var(--foreground)]">
            Back to students
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[var(--background)] py-8">
      <div className="mx-auto mb-6 flex max-w-[820px] flex-wrap items-center justify-between gap-4 px-6 print:hidden">
        <Link href={`/admin/students/${id}`} className="inline-flex items-center gap-2 text-sm text-[var(--muted)] underline underline-offset-4">
          <ArrowLeftIcon /> Back to student file
        </Link>
        <div className="flex items-center gap-3">
          <a
            href={`/api/admin/students/${id}/sheet?format=csv`}
            className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-5 py-2.5 text-sm font-semibold text-[var(--foreground)]"
          >
            Download CSV
          </a>
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-full bg-[var(--accent)] px-6 py-3 text-sm font-bold text-white shadow-lg transition hover:brightness-110"
          >
            Print / Save as PDF
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-[820px] px-6 print:max-w-none print:px-0">
        <ResultSheet sheet={sheet} />
      </div>
    </main>
  );
}
