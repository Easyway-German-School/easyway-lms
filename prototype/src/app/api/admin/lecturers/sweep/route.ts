import { NextRequest, NextResponse } from "next/server";
import { requireCapability } from "@/lib/admin-roles";
import { releaseStaleNamedStudents } from "@/lib/tutor-rehome";

/**
 * Manual trigger for the same stale-link sweep the lecturers page already
 * runs on every load (see GET /api/admin/lecturers). Also backfills null
 * tenantId on co-tutor rows (see tutor-pairing.ts) so those links stop being
 * invisible to tenant-scoped admin screens. Visible here as its own action so
 * the office can run it on demand and see the count, instead of trusting an
 * invisible background pass.
 */
export async function POST(request: NextRequest) {
  const gate = await requireCapability("staff");
  if (!gate.ok) return gate.response;

  const body = await request.json().catch(() => ({}));
  const dryRun = body?.dryRun === true;

  const result = await releaseStaleNamedStudents({
    tenantId: gate.session.user.tenantId ?? null,
    dryRun,
  });

  return NextResponse.json({
    success: true,
    dryRun,
    moved: result.moved,
    unlinked: result.unlinked,
    message: dryRun
      ? `Would move ${result.moved} and unlink ${result.unlinked} student link${result.moved + result.unlinked === 1 ? "" : "s"}.`
      : result.moved + result.unlinked === 0
        ? "All tutor links look healthy — nothing to repair."
        : `Moved ${result.moved} student${result.moved === 1 ? "" : "s"} onto matching tutors and cleared ${result.unlinked} stale link${result.unlinked === 1 ? "" : "s"}.`,
  });
}

export const dynamic = "force-dynamic";
