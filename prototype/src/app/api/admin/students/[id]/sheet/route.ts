import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-roles";
import { buildResultSheet, resultSheetToCsv } from "@/lib/result-sheet";

/**
 * The office copy of a student's result sheet.
 *
 * Gated on `students` (cohort management). The fee lines are only built for an
 * admin who also holds `payments` — the same split the student dossier uses, so
 * a secretary sees the academic record without the money.
 *
 * `?format=csv` returns the flat CSV; otherwise JSON for the print page.
 */
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  if (!auth.admin.can("students")) {
    return NextResponse.json({ error: "Not permitted" }, { status: 403 });
  }

  const { id } = await params;
  const sheet = await buildResultSheet(id, {
    audience: "admin",
    includeFinance: auth.admin.can("payments"),
  });
  if (!sheet) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  if (new URL(request.url).searchParams.get("format") === "csv") {
    const safeName = (sheet.student.studentCode ?? sheet.student.name).replace(/[^a-z0-9]+/gi, "-");
    return new NextResponse(resultSheetToCsv(sheet), {
      headers: {
        "Content-Type": "text/csv;charset=utf-8",
        "Content-Disposition": `attachment; filename="result-sheet-${safeName}.csv"`,
      },
    });
  }

  return NextResponse.json({ sheet });
}
