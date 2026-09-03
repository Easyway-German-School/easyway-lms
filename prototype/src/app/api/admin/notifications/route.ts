import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";
import { KIND, notify, type NotifyTarget } from "@/lib/notify";

/**
 * The office's own announcement desk.
 *
 * THIS USED TO WRITE ONE ROW BY HAND AND REACH NOBODY. Three separate faults,
 * each enough on its own to make an announcement vanish:
 *
 *   1. It wrote `channel` straight from the form, which defaults to "email".
 *      The bell's read filter is `channel: { not: "email" }` — that column is
 *      how a mailed copy is told apart from an in-app one — so every single
 *      notification the office composed was excluded from every recipient's
 *      bell by the one field nobody thought was load-bearing.
 *   2. It never set `userId` OR `audience`. A staff member's bell only matches
 *      broadcasts via `{ userId: null, audience: <their role> }`, so with
 *      `audience` null a tutor could not be reached at all, however the form
 *      was filled in. That is the "I sent it to tutors and nothing happened".
 *   3. One row, never fanned out — so no push, no email, and no way to record
 *      which of two hundred readers had read it.
 *
 * It now goes through `notify()` like every other sender in the app, which owns
 * fan-out, dedupe, push, the email queue and per-person mute preferences. The
 * form picks WHO; this route turns that into a NotifyTarget and gets out of the
 * way.
 */

async function requireNotificationAdmin() {
  return requireCapability("emails");
}

export async function GET() {
  const gate = await requireNotificationAdmin();
  if (!gate.ok) return gate.response;

  /**
   * Folded by batch, because the list is a record of SENDS, not of rows.
   *
   * An announcement to two hundred students is two hundred rows sharing a
   * `batchId`; listing them raw made the page a wall of the same message and
   * pushed everything older off the first screen.
   */
  const notifications = await prisma.notification.findMany({
    orderBy: { createdAt: "desc" },
    take: 400,
    include: {
      student: { include: { user: true } },
      branch: true,
    },
  });

  const seenBatch = new Set<string>();
  const folded: Array<Record<string, unknown>> = [];
  for (const row of notifications) {
    if (row.batchId) {
      if (seenBatch.has(row.batchId)) continue;
      seenBatch.add(row.batchId);
    }
    folded.push({
      ...row,
      recipientCount: row.batchId
        ? notifications.filter((other) => other.batchId === row.batchId).length
        : 1,
    });
  }

  return NextResponse.json({ notifications: folded.slice(0, 100) });
}

export async function POST(request: NextRequest) {
  const gate = await requireNotificationAdmin();
  if (!gate.ok) return gate.response;

  const body = await request.json().catch(() => ({}));
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const studentId = typeof body.studentId === "string" && body.studentId.trim() ? body.studentId : null;
  const lecturerId = typeof body.lecturerId === "string" && body.lecturerId.trim() ? body.lecturerId : null;
  const branchId = typeof body.branchId === "string" && body.branchId.trim() ? body.branchId : null;
  const level = typeof body.level === "string" && body.level.trim() ? body.level.trim().toUpperCase() : null;
  const link = typeof body.link === "string" && body.link.trim() ? body.link.trim() : null;
  /** students | lecturers | everyone — who this is addressed to. */
  const audience = ["students", "lecturers", "everyone"].includes(String(body.audience))
    ? String(body.audience)
    : "students";
  const alsoEmail = body.alsoEmail === true;
  const alsoPush = body.alsoPush !== false;

  if (!title || !message) {
    return NextResponse.json({ error: "Title and message are required" }, { status: 400 });
  }

  /**
   * The `studentId` filter only means anything for students; `lecturerId` only
   * for tutors. Branch and level now narrow BOTH audiences (a tutor's branch
   * and level come from the assignment an admin set — see the `lecturers`
   * target in notify.ts). "Everyone" takes no filter at all — a school-wide
   * notice that quietly went to one branch would be the worst kind of wrong.
   */
  if (audience === "everyone" && (studentId || lecturerId || branchId || level)) {
    return NextResponse.json(
      { error: "Sending to everyone takes no filters — pick Students or Tutors to narrow it." },
      { status: 400 },
    );
  }
  if (studentId && audience !== "students") {
    return NextResponse.json(
      { error: "The single-student filter only applies when sending to students." },
      { status: 400 },
    );
  }
  if (lecturerId && audience !== "lecturers") {
    return NextResponse.json(
      { error: "The single-tutor filter only applies when sending to tutors." },
      { status: 400 },
    );
  }

  let target: NotifyTarget;
  if (audience === "lecturers") {
    target = { lecturers: { branchId, level, lecturerIds: lecturerId ? [lecturerId] : undefined } };
  } else if (audience === "everyone") {
    target = { audience: "all" };
  } else if (studentId) {
    target = { studentIds: [studentId] };
  } else {
    // Both optional — omitting them reaches every active student, which is what
    // a school-wide notice wants.
    target = { students: { branchId, level } };
  }

  try {
    const result = await notify({
      to: target,
      kind: KIND.announcement,
      severity: "info",
      title,
      message,
      link,
      senderId: gate.session.user.id,
      push: alsoPush,
      email: alsoEmail,
    });

    if (result.created === 0) {
      return NextResponse.json(
        {
          error:
            "That reached nobody — no active accounts matched. Check the branch and level, or that tutors exist.",
        },
        { status: 409 },
      );
    }

    return NextResponse.json(
      {
        sent: result.created,
        pushed: result.pushed,
        emailed: result.queuedEmails,
        batchId: result.batchId,
      },
      { status: 201 },
    );
  } catch (error) {
    return NextResponse.json(
      { error: "Unable to send notification", detail: error instanceof Error ? error.message : "Unknown" },
      { status: 500 },
    );
  }
}
