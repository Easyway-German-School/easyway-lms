import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { resolveAdmin } from "@/lib/admin-roles";
import { completeLevelForStudents, listCohort } from "@/lib/germany-journey-server";

export const dynamic = "force-dynamic";

/**
 * The cohort console.
 *
 * GET  — everybody in a batch and how far each of them has actually got.
 * POST — "this batch has finished", which is the ONLY thing that makes the
 *        student-facing "your level is complete" offer appear.
 *
 * Signing a level off changes what a student is told about their own progress
 * and opens a sale, so it sits behind the `students` capability rather than
 * being readable by anybody with an admin cookie.
 */
async function requireStudentsAdmin() {
  const session = (await getServerSession(authOptions as any)) as any;
  const admin = await resolveAdmin(session?.user?.id);

  if (!admin) {
    return { error: NextResponse.json({ error: "Admin access required" }, { status: 403 }) };
  }
  if (!admin.can("students")) {
    return { error: NextResponse.json({ error: "Your admin role cannot sign off levels" }, { status: 403 }) };
  }
  return { admin };
}

export async function GET(req: NextRequest) {
  const auth = await requireStudentsAdmin();
  if (auth.error) return auth.error;

  try {
    const params = req.nextUrl.searchParams;
    const cohort = await listCohort({
      branchId: params.get("branchId"),
      level: params.get("level"),
      batch: params.get("batch"),
      sessionSlot: params.get("sessionSlot"),
    });

    return NextResponse.json({
      cohort,
      summary: {
        total: cohort.length,
        started: cohort.filter((row) => row.classesStartedAt).length,
        neverStarted: cohort.filter((row) => !row.classesStartedAt).length,
        stalled: cohort.filter((row) => !row.classesStartedAt && row.notStartedCount >= 3).length,
        signedOff: cohort.filter((row) => row.levelCompletedFor === row.level).length,
        owing: cohort.filter((row) => row.outstanding > 0).length,
      },
    });
  } catch (error) {
    console.error("Cohort list failed", error);
    return NextResponse.json({ error: "Unable to build the cohort list" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireStudentsAdmin();
  if (auth.error) return auth.error;

  try {
    const body = await req.json().catch(() => ({}));
    const ids = Array.isArray(body?.studentIds)
      ? body.studentIds.filter((value: unknown) => typeof value === "string")
      : [];

    if (ids.length === 0) {
      return NextResponse.json({ error: "Select at least one student" }, { status: 400 });
    }

    const result = await completeLevelForStudents(ids, { announce: body?.announce !== false });
    return NextResponse.json(result);
  } catch (error) {
    console.error("Level sign-off failed", error);
    return NextResponse.json({ error: "Unable to sign these students off" }, { status: 500 });
  }
}
