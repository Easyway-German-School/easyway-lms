import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";
import {
  AGING_BUCKETS,
  COHORTS,
  FINANCE_STUDENT_SELECT,
  computeAll,
  focusPreset,
  summariseReceivables,
  type Cohort,
  type StudentFinance,
} from "@/lib/finance/receivables";

export const dynamic = "force-dynamic";

/**
 * The accountant's working list: every student who owes the school money, aged.
 *
 * This is the one screen the finance area did not have. `/api/admin/finance`
 * could tell you the school was owed ₦4.2m and could not tell you by whom, how
 * long it had been outstanding, or which branch it was sitting in — so chasing
 * it meant exporting the roster and rebuilding the fee table in a spreadsheet,
 * which is where a second, wrong copy of the pricing rules gets made.
 *
 * Ageing runs off enrolment date rather than invoice due date, for the reason
 * set out in src/lib/finance/receivables.ts: most students who owe money have
 * no invoice row at all, and an ageing report that files them under "current"
 * is a report that says the school is owed nothing.
 */
export async function GET(request: Request) {
  const gate = await requireCapability("payments");
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const branchId = url.searchParams.get("branchId");
  const level = url.searchParams.get("level");
  const bucket = url.searchParams.get("agingBucket");
  const cohortParam = url.searchParams.get("cohort");
  const focus = focusPreset(url.searchParams.get("focus"));
  const search = (url.searchParams.get("search") || "").trim().toLowerCase();
  const format = url.searchParams.get("format");
  const sort = url.searchParams.get("sort") || "owed";
  const limit = Math.min(2000, Math.max(1, parseInt(url.searchParams.get("limit") || "200", 10)));

  const where: Record<string, unknown> = {};
  if (branchId) where.branchId = branchId;
  if (level) where.level = level;

  const students = await prisma.student.findMany({
    where,
    select: FINANCE_STUDENT_SELECT,
    orderBy: { createdAt: "desc" },
  });

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const all = computeAll(students, now);

  /**
   * The summary is taken BEFORE the view filters, deliberately.
   *
   * An accountant who clicks into the 61–90 bucket still needs the totals for
   * the whole book on screen; recomputing them from the filtered rows would
   * show "outstanding ₦310,000" while they are looking at one slice of ₦4.2m,
   * and that is the kind of figure that ends up in a report to the school.
   */
  const summary = summariseReceivables(all);

  let rows = all;
  if (focus) {
    const rawById = new Map(students.map((student) => [student.id, student]));
    rows = rows.filter((row) => {
      const raw = rawById.get(row.id);
      return raw ? focus.matches(row, { now, startOfMonth }, raw) : false;
    });
  }
  if (bucket) rows = rows.filter((row) => row.owed > 0 && row.agingBucket === bucket);
  if (cohortParam && (COHORTS as readonly string[]).includes(cohortParam)) {
    rows = rows.filter((row) => row.cohort === (cohortParam as Cohort));
  }
  if (search) {
    rows = rows.filter(
      (row) =>
        row.name.toLowerCase().includes(search) ||
        row.email.toLowerCase().includes(search) ||
        row.branch.toLowerCase().includes(search),
    );
  }

  rows = sortRows(rows, sort);

  if (format === "csv") {
    return csvResponse(rows);
  }

  return NextResponse.json({
    generatedAt: now.toISOString(),
    summary,
    // The vocabulary the page renders its filters from, so the buckets and
    // cohort names are defined once rather than retyped in the UI.
    buckets: AGING_BUCKETS.map((b) => ({ id: b.id, label: b.label, hint: b.hint })),
    filters: {
      branchId,
      level,
      agingBucket: bucket,
      cohort: cohortParam,
      focus: focus ? { id: focus.id, label: focus.label, hint: focus.hint } : null,
      search: search || null,
      sort,
    },
    totalCount: rows.length,
    rows: rows.slice(0, limit),
  });
}

function sortRows(rows: StudentFinance[], sort: string): StudentFinance[] {
  const sorted = [...rows];
  switch (sort) {
    case "oldest":
      return sorted.sort((a, b) => b.daysEnrolled - a.daysEnrolled);
    case "name":
      return sorted.sort((a, b) => a.name.localeCompare(b.name));
    case "branch":
      return sorted.sort((a, b) => a.branch.localeCompare(b.branch) || b.owed - a.owed);
    case "paid":
      return sorted.sort((a, b) => b.paid - a.paid);
    case "owed":
    default:
      // Largest debt first, and the longest-standing of two equal debts above
      // the other — the order somebody actually works the list in.
      return sorted.sort((a, b) => b.owed - a.owed || b.daysEnrolled - a.daysEnrolled);
  }
}

/* -------------------------------------------------------------------------- */

const CSV_COLUMNS: Array<{ header: string; value: (row: StudentFinance) => string | number }> = [
  { header: "Student", value: (row) => row.name },
  { header: "Email", value: (row) => row.email },
  { header: "Branch", value: (row) => row.branch },
  { header: "Level", value: (row) => row.level },
  { header: "Class type", value: (row) => row.classType },
  { header: "Status", value: (row) => row.status },
  { header: "Tuition fee (NGN)", value: (row) => row.tuitionFee },
  { header: "Required deposit (NGN)", value: (row) => row.requiredDeposit },
  { header: "Paid (NGN)", value: (row) => row.paid },
  { header: "Outstanding (NGN)", value: (row) => row.owed },
  { header: "Short of deposit (NGN)", value: (row) => row.owedOnDeposit },
  { header: "Payments", value: (row) => row.paymentCount },
  { header: "Last payment", value: (row) => (row.lastPaymentAt ? row.lastPaymentAt.slice(0, 10) : "") },
  { header: "Days enrolled", value: (row) => row.daysEnrolled },
  { header: "Ageing", value: (row) => AGING_BUCKETS.find((b) => b.id === row.agingBucket)?.label ?? row.agingBucket },
  { header: "Behind on tuition", value: (row) => (row.behindOnTuition ? "yes" : "no") },
];

function csvResponse(rows: StudentFinance[]): Response {
  const lines = [
    CSV_COLUMNS.map((column) => csvCell(column.header)).join(","),
    ...rows.map((row) => CSV_COLUMNS.map((column) => csvCell(column.value(row))).join(",")),
  ];

  /**
   * Amounts go out as bare integers, not "₦12,000".
   *
   * A thousands separator inside a CSV cell is a second column to Excel, and a
   * currency symbol makes the whole column text — so a file that looks right
   * on screen sums to zero in the spreadsheet it was exported for. The header
   * carries the unit instead.
   *
   * The BOM is there so Excel on Windows reads the file as UTF-8; without it
   * the same spreadsheet renders every non-ASCII name as mojibake.
   */
  const body = `﻿${lines.join("\r\n")}\r\n`;
  const stamp = new Date().toISOString().slice(0, 10);

  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="receivables-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

function csvCell(value: string | number): string {
  const text = String(value ?? "");
  /**
   * A leading =, +, - or @ is a formula to Excel and Sheets. Student names and
   * branch names are typed by hand into this system, so the export is prefixed
   * defensively rather than trusted.
   */
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
