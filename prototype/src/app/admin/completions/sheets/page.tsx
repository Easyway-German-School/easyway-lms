"use client";

export const dynamic = "force-dynamic";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import ResultSheet from "@/components/ResultSheet";
import type { ResultSheet as ResultSheetData } from "@/lib/result-sheet";

/**
 * Every selected student's result sheet on one page, one per printed page,
 * ready for a single Ctrl-P → "Save as PDF". Opened in a new tab by the
 * completions page with `?ids=a,b,c`.
 */

function Sheets() {
  const params = useSearchParams();
  const ids = (params.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const [sheets, setSheets] = useState<ResultSheetData[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "empty">("loading");

  useEffect(() => {
    if (ids.length === 0) {
      setState("empty");
      return;
    }
    let cancelled = false;
    (async () => {
      const results = await Promise.all(
        ids.map(async (id) => {
          try {
            const res = await fetch(`/api/admin/students/${id}/sheet`, { cache: "no-store", credentials: "include" });
            const json = await res.json();
            return res.ok && json?.sheet ? (json.sheet as ResultSheetData) : null;
          } catch {
            return null;
          }
        }),
      );
      if (cancelled) return;
      const ok = results.filter((s): s is ResultSheetData => s !== null);
      setSheets(ok);
      setState(ok.length ? "ready" : "empty");
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.get("ids")]);

  useEffect(() => {
    if (state === "ready") {
      const timer = setTimeout(() => window.print(), 600);
      return () => clearTimeout(timer);
    }
  }, [state]);

  if (state === "loading") {
    return <main className="grid min-h-screen place-items-center bg-white text-slate-500">Building {ids.length} result sheets…</main>;
  }
  if (state === "empty") {
    return <main className="grid min-h-screen place-items-center bg-white text-slate-500">No result sheets to show.</main>;
  }

  return (
    <main className="bg-white">
      <style>{`.sheet-break { break-after: page; }`}</style>
      {sheets.map((sheet, index) => (
        <div key={sheet.student.id} className={index < sheets.length - 1 ? "sheet-break" : ""}>
          <ResultSheet sheet={sheet} />
        </div>
      ))}
    </main>
  );
}

export default function CompletionSheetsPage() {
  return (
    <Suspense fallback={<main className="grid min-h-screen place-items-center bg-white text-slate-500">Loading…</main>}>
      <Sheets />
    </Suspense>
  );
}
