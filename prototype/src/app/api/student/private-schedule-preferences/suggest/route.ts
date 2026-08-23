import { NextResponse } from "next/server";

import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { adviseSchedule } from "@/lib/private-schedule-advisor";
import { normalizeSchedulePreferences, parseSchedulePreferencesInput } from "@/lib/private-schedule-preferences";
import { profileFor } from "@/lib/learner-intelligence";
import { SCHEDULE_DAYS } from "@/lib/private-schedule-preferences";
import { becomeBecca } from "@/lib/ai";

/**
 * "ASK BECCA" — a real recommendation, not a form that says a name.
 *
 * WHAT THIS FIXES. The private-class scheduler carried Becca's name, her
 * voice and her introduction, and behind all of it was a plain availability
 * form whose answer was emailed to a tutor. Nothing read it, nothing thought
 * about it, and no model was ever called. Calling that "the AI area" was a
 * label on an empty box.
 *
 * THE DIVISION OF LABOUR, which is the important part:
 *
 *   THE SLOTS ARE COMPUTED, NOT GENERATED. `adviseSchedule` ranks real hours
 *   against the student's stated availability, their observed study rhythm and
 *   the tutor's existing diary, in code that can be read and tested. A model
 *   asked to invent a timetable will produce a confident one that double-books
 *   a tutor, and nobody will be able to say why.
 *
 *   THE MODEL WRITES, AND ONLY WRITES. It is handed the finished ranking and
 *   asked for two or three sentences in Becca's voice. If it is unavailable,
 *   out of credit, or slow, the deterministic prose ships instead and the
 *   student gets the same recommendation in slightly plainer words. The
 *   feature never depends on the network to be useful.
 *
 * It reads a DRAFT. The picker posts what the student has ticked so far, not
 * what is saved, so advice arrives while they are still deciding rather than
 * after they have committed. Nothing here writes.
 */

export const dynamic = "force-dynamic";

/** How far ahead we look at the tutor's diary when marking slots busy. */
const DIARY_DAYS = 28;

function readStoredPreferences(admission: unknown) {
  if (!admission || typeof admission !== "object" || Array.isArray(admission)) return null;
  const value = (admission as Record<string, unknown>).privateSchedulePreferences;
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

export async function POST(request: Request) {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const student = await prisma.student.findUnique({
    where: { userId: session.user.id as string },
    select: {
      id: true,
      classType: true,
      level: true,
      admission: true,
      tutorId: true,
      user: { select: { name: true } },
    },
  });
  if (!student) return NextResponse.json({ error: "Student not found" }, { status: 404 });
  if (student.classType !== "private") {
    return NextResponse.json({ error: "This schedule is for private students only" }, { status: 400 });
  }

  /**
   * The draft if one was posted, otherwise whatever is already saved. Advice
   * on an empty draft is still useful — it is entirely behavioural, and
   * "you are always here at 9pm" is worth hearing before you tick anything.
   */
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const parsed = body ? parseSchedulePreferencesInput(body) : { error: "no draft" };
  const preferences = "preferences" in parsed
    ? normalizeSchedulePreferences(parsed.preferences)
    : (() => {
        const stored = readStoredPreferences(student.admission);
        return stored ? normalizeSchedulePreferences(stored) : null;
      })();

  /* ---- The tutor's diary, as day:hour keys ---------------------------- */
  const tutorBusyAt = new Set<string>();
  if (student.tutorId) {
    const booked = await prisma.privateClass.findMany({
      where: {
        lecturerId: student.tutorId,
        status: { in: ["scheduled", "postponed"] },
        scheduledAt: { gte: new Date(), lte: new Date(Date.now() + DIARY_DAYS * 86400000) },
      },
      select: { scheduledAt: true },
      take: 200,
    });
    for (const row of booked) {
      // getDay() is 0=Sunday; SCHEDULE_DAYS is 0=Monday.
      const day = SCHEDULE_DAYS[(row.scheduledAt.getDay() + 6) % 7];
      tutorBusyAt.add(`${day}:${row.scheduledAt.getHours()}`);
    }
  }

  const behaviour = await profileFor(session.user.id as string, student.user.name ?? "You");
  const advice = adviseSchedule({ preferences, profile: behaviour, tutorBusyAt });

  const message = await becomeBecca({
    studentName: (student.user.name ?? "").split(" ")[0] || "there",
    level: student.level,
    advice,
  });

  return NextResponse.json({
    message: message ?? advice.fallbackMessage,
    /** Whether the wording came from the model or from the deterministic writer. */
    wordedBy: message ? "claude" : "rules",
    candidates: advice.candidates,
    mismatch: advice.mismatch,
    evidence: advice.evidence,
  });
}
