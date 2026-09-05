import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/admin-roles";
import { monthRange, payrollSummaryFor } from "@/lib/payroll";

/** What every rated tutor earned, was paid, and is owed for one calendar month — defaults to the current month. `?month=2026-09` picks another. */
export async function GET(request: Request) {
  const gate = await requireCapability("payroll");
  if (!gate.ok) return gate.response;

  const monthParam = new URL(request.url).searchParams.get("month");
  const anchor = monthParam && /^\d{4}-\d{2}$/.test(monthParam)
    ? new Date(Date.UTC(Number(monthParam.slice(0, 4)), Number(monthParam.slice(5, 7)) - 1, 1))
    : new Date();

  const { from, to, label } = monthRange(anchor);
  const tutors = await payrollSummaryFor(from, to);

  return NextResponse.json({
    period: { from: from.toISOString(), to: to.toISOString(), label },
    tutors,
    totals: {
      earned: tutors.reduce((sum, t) => sum + (t.earned ?? 0), 0),
      paid: tutors.reduce((sum, t) => sum + t.paid, 0),
      owed: tutors.reduce((sum, t) => sum + (t.owed ?? 0), 0),
    },
  });
}
