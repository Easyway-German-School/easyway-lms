import { NextRequest, NextResponse } from "next/server";
import { requireCapability } from "@/lib/admin-roles";
import { prisma } from "@/lib/prisma";
import { KIND, notify } from "@/lib/notify";
import { linkStudentAuto, loadLinkContext, type LinkOutcome } from "@/lib/tutor-link";

/**
 * POST { lecturerId, studentIds[] } — link each student to this tutor by the
 * one rule in `lib/tutor-class-match.ts`:
 *
 *   no tutor yet                 → this tutor becomes their primary
 *   already has a tutor, online  → this tutor is added as a co-tutor
 *   anything else (physical or one-to-one with a tutor, multi-tutor switch off
 *   for a second extra tutor)    → SKIPPED, with the reason
 *
 * It never replaces anybody's tutor. That is the point: "link everyone who
 * fits" is safe to press because the worst it can do is add, and everything it
 * declined to do comes back in `skipped` for a human to decide.
 *
 * Small batches on purpose. Each student is a few writes plus a notification,
 * and a request that has to finish inside the function time limit cannot be
 * asked to do hundreds. The panel sends them in chunks and shows progress.
 */

export const dynamic = "force-dynamic";

const MAX_PER_REQUEST = 25;

export async function POST(request: NextRequest) {
  const gate = await requireCapability("staff");
  if (!gate.ok) return gate.response;

  const body = await request.json().catch(() => null);
  const lecturerId = typeof body?.lecturerId === "string" ? body.lecturerId : "";
  const studentIds: string[] = Array.isArray(body?.studentIds)
    ? [...new Set((body.studentIds as unknown[]).filter((id): id is string => typeof id === "string" && id.length > 0))]
    : [];

  if (!lecturerId) return NextResponse.json({ error: "lecturerId is required" }, { status: 400 });
  if (!studentIds.length) return NextResponse.json({ error: "studentIds is required" }, { status: 400 });
  if (studentIds.length > MAX_PER_REQUEST) {
    return NextResponse.json({ error: `Link at most ${MAX_PER_REQUEST} students per request` }, { status: 400 });
  }

  const context = await loadLinkContext(lecturerId);
  if (!context) return NextResponse.json({ error: "Tutor not found" }, { status: 404 });

  const outcomes: LinkOutcome[] = [];
  for (const studentId of studentIds) {
    try {
      outcomes.push(
        await linkStudentAuto({ context, studentId, assignedById: gate.session.user.id, notifyTutor: false }),
      );
    } catch (error) {
      console.error("Bulk tutor link failed for one student", { studentId, error });
      outcomes.push({ ok: false, studentId, studentName: null, action: "error", reason: "Something went wrong linking this student." });
    }
  }

  const primary = outcomes.filter((outcome) => outcome.ok && outcome.action === "primary").length;
  const coTutor = outcomes.filter((outcome) => outcome.ok && outcome.action === "co_tutor").length;

  // One message for the tutor, not one per student.
  if (primary + coTutor > 0) {
    const parts = [
      primary ? `${primary} as their tutor` : "",
      coTutor ? `${coTutor} as an additional tutor alongside another tutor` : "",
    ].filter(Boolean);
    await notify({
      to: { userIds: [await tutorUserId(lecturerId)].filter(Boolean) as string[] },
      kind: KIND.announcement,
      severity: "info",
      title: `${primary + coTutor} student${primary + coTutor === 1 ? "" : "s"} added to your class`,
      message: `The office linked ${parts.join(" and ")}. They are on your roster, register and gradebook now.`,
      link: "/lecturer/students",
      push: true,
    }).catch((error) => console.error("Bulk tutor link summary notification failed", error));
  }

  return NextResponse.json({
    success: true,
    linked: { primary, coTutor },
    skipped: outcomes
      .filter((outcome): outcome is Extract<LinkOutcome, { ok: false }> => !outcome.ok)
      .map((outcome) => ({
        studentId: outcome.studentId,
        studentName: outcome.studentName,
        action: outcome.action,
        reason: outcome.reason,
      })),
  });
}

async function tutorUserId(lecturerId: string): Promise<string | null> {
  const lecturer = await prisma.lecturer.findUnique({ where: { id: lecturerId }, select: { userId: true } });
  return lecturer?.userId ?? null;
}
