import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-roles";
import { buildAdminBrief, type AdminBriefPeriod } from "@/lib/admin-brief";

export const dynamic = "force-dynamic";

const PERIODS: AdminBriefPeriod[] = ["daily", "weekly", "monthly"];

/**
 * The office's daily / weekly / monthly brief, scoped to what the caller may
 * see. A Secretary gets registrations and activity; only a `payments` holder
 * gets the money half. See lib/admin-brief.ts.
 */
export async function GET(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const raw = url.searchParams.get("period");
  const period: AdminBriefPeriod = PERIODS.includes(raw as AdminBriefPeriod)
    ? (raw as AdminBriefPeriod)
    : "daily";

  // Nobody without students or payments has anything to read here.
  if (!auth.admin.can("students") && !auth.admin.can("payments")) {
    return NextResponse.json(
      { error: "Your admin role does not cover the office brief." },
      { status: 403 },
    );
  }

  const brief = await buildAdminBrief(auth.admin, period);
  return NextResponse.json(brief);
}
