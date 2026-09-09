import { prisma } from "@/lib/prisma";
import { KIND, notify } from "@/lib/notify";
import { liveWhere } from "@/lib/live-presence";
import { studentCanEnterLiveClass } from "@/lib/live-eligibility";

/**
 * Putting a named student on a named tutor.
 *
 * WHY THIS IS ONE FUNCTION AND NOT THREE WRITES.
 *
 * `Student.tutorId` is now settable from three screens — the tutor's own edit
 * panel, the student roster, and the student's file — and every one of them
 * has to do the same three things: move the column, tell the student who
 * teaches them, and tell the tutor they have somebody new. Three copies of
 * that is three chances to write the column and tell nobody, which is the
 * quiet failure here: the pairing works, the register updates, and neither
 * person finds out until somebody does not turn up.
 *
 * Passing `lecturerId: null` clears the pairing. That is a real operation
 * rather than an oversight — a student named onto a tutor for cover goes back
 * to their ordinary class afterwards — so it notifies too, in its own words.
 */

export type TutorPairingResult =
  | { ok: true; tutorName: string | null; studentName: string; changed: boolean }
  | { ok: false; error: string; status: number };

export async function setStudentTutor(input: {
  studentId: string;
  lecturerId: string | null;
  /** Skip the notifications — used by bulk paths that send their own summary. */
  quiet?: boolean;
}): Promise<TutorPairingResult> {
  const { studentId, lecturerId, quiet = false } = input;

  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: {
      id: true,
      tutorId: true,
      classType: true,
      user: { select: { name: true, email: true } },
    },
  });
  if (!student) return { ok: false, error: "Student not found", status: 404 };

  const lecturer = lecturerId
    ? await prisma.lecturer.findUnique({
        where: { id: lecturerId },
        select: { id: true, status: true, user: { select: { id: true, name: true, email: true } } },
      })
    : null;

  if (lecturerId && !lecturer) return { ok: false, error: "Tutor not found", status: 404 };

  const studentName = student.user.name || student.user.email;
  const tutorName = lecturer ? lecturer.user.name || lecturer.user.email : null;

  // Nothing to do, and nothing to announce. Saving a form that happens to
  // contain the tutor it already had must not buzz two people about it.
  if ((student.tutorId ?? null) === (lecturerId ?? null)) {
    return { ok: true, tutorName, studentName, changed: false };
  }

  await prisma.student.update({ where: { id: studentId }, data: { tutorId: lecturerId } });

  if (quiet) return { ok: true, tutorName, studentName, changed: true };

  if (lecturer) {
    await notify({
      to: { studentIds: [studentId] },
      kind: KIND.announcement,
      severity: "success",
      title: "Your tutor has been assigned",
      // The name is the entire point of the message. A student told only that
      // "a tutor was assigned" has to ring the office to find out who.
      message:
        student.classType === "private"
          ? `${tutorName} will be taking your private classes. They will be in touch to agree your times, and your sessions will appear on your calendar once booked.`
          : `${tutorName} is now your tutor. They can see your progress and will be marking your work.`,
      link: student.classType === "private" ? "/calendar" : "/classes",
      push: true,
    }).catch((error) => console.error("Tutor pairing notification failed", error));

    await notify({
      to: { userIds: [lecturer.user.id] },
      kind: KIND.announcement,
      severity: "info",
      title: "A student was added to your class",
      message: `The office assigned ${studentName} to you. They are on your roster, your register and your gradebook from now.`,
      link: "/lecturer/students",
      push: true,
    }).catch((error) => console.error("Tutor pairing notification failed", error));

    /**
     * ASSIGNED MID-LESSON.
     *
     * If this tutor has a live class going right now, the student who was just
     * handed to them should be able to walk straight in — not find out at the
     * next sitting. `liveSessionForStudent` will now let them join (it reads
     * `tutorId`), but nothing would have TOLD them, because the "class started"
     * push already went out before this student existed on the roster. Same
     * dedupe key as that push, so a student who somehow got both is buzzed once.
     */
    if (student.classType !== "private" && (await studentCanEnterLiveClass(studentId))) {
      const liveNow = await prisma.liveClassSession.findFirst({
        where: { kind: "cohort", lecturerId: lecturer.id, ...liveWhere() },
        orderBy: { startedAt: "desc" },
        select: { id: true, title: true, joinCode: true },
      });
      if (liveNow) {
        await notify({
          to: { studentIds: [studentId] },
          kind: KIND.classStarting,
          severity: "warning",
          title: "Your new tutor is teaching right now",
          message: `${tutorName} has a live class on — ${liveNow.title}. Tap to join.`,
          link: `/live?code=${liveNow.joinCode}`,
          dedupeKey: `live-start:${liveNow.id}`,
          push: true,
        }).catch((error) => console.error("Live-now nudge on tutor pairing failed", error));
      }
    }
  } else if (student.tutorId) {
    const previous = await prisma.lecturer.findUnique({
      where: { id: student.tutorId },
      select: { user: { select: { id: true } } },
    });
    if (previous) {
      await notify({
        to: { userIds: [previous.user.id] },
        kind: KIND.announcement,
        severity: "info",
        title: "A student was removed from your class",
        message: `The office moved ${studentName} off your roster. They no longer appear on your register or gradebook.`,
        link: "/lecturer/students",
        push: true,
      }).catch((error) => console.error("Tutor pairing notification failed", error));
    }
  }

  return { ok: true, tutorName, studentName, changed: true };
}

/**
 * The EXTRA tutors on a student, beyond the primary set by `setStudentTutor`.
 *
 * WHY A SECOND FUNCTION. The primary tutor is one column and one relationship —
 * "who is responsible for this student". Co-tutors are a set, they only exist
 * for online and hybrid students, and adding or dropping one has to tell the
 * same people the primary pairing tells: the tutor who just gained or lost a
 * student, and the student whose teaching team changed. Reusing
 * `setStudentTutor` for this would mean overloading "the tutor" to sometimes
 * mean a list, which is exactly how the register and the gradebook end up
 * disagreeing about who teaches whom.
 *
 * `lecturerIds` is the COMPLETE desired set of extra tutors, not a delta — the
 * caller passes what the roster should look like afterwards and this works out
 * the adds and removes. The primary tutor is filtered out of it: a student's
 * own `tutorId` is not also a co-tutor row, or every roster query would count
 * them twice.
 *
 * The delivery-mode rule is enforced here as well as at the API, because it is
 * a fact about the data ("a physical student sits one room") rather than a
 * policy toggle — the `roster.sharedStudents` feature flag is the caller's to
 * check, this is the floor under it.
 */

export type CoTutorResult =
  | {
      ok: true;
      studentName: string;
      changed: boolean;
      /** Tutor display names now on this student, primary first is NOT included. */
      coTutorNames: string[];
      added: string[];
      removed: string[];
    }
  | { ok: false; error: string; status: number };

export async function setStudentCoTutors(input: {
  studentId: string;
  lecturerIds: string[];
  /** Admin User.id making the change, stored on each new row for audit. */
  assignedById?: string | null;
  /** Skip the notifications — used by bulk paths that send their own summary. */
  quiet?: boolean;
}): Promise<CoTutorResult> {
  const { studentId, assignedById = null, quiet = false } = input;

  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: {
      id: true,
      tutorId: true,
      deliveryMode: true,
      user: { select: { name: true, email: true } },
      coTutors: {
        select: {
          lecturerId: true,
          lecturer: { select: { user: { select: { id: true, name: true, email: true } } } },
        },
      },
    },
  });
  if (!student) return { ok: false, error: "Student not found", status: 404 };

  const studentName = student.user.name || student.user.email;

  // The primary tutor is never also a co-tutor. De-duplicate and drop it.
  const desiredIds = Array.from(new Set(input.lecturerIds.filter(Boolean))).filter(
    (id) => id !== student.tutorId,
  );

  if (desiredIds.length && !["online", "hybrid"].includes(student.deliveryMode)) {
    return {
      ok: false,
      error: "Only online or hybrid students can be shared across more than one tutor.",
      status: 400,
    };
  }

  const currentIds = student.coTutors.map((row) => row.lecturerId);
  const currentSet = new Set(currentIds);
  const desiredSet = new Set(desiredIds);

  const toRemove = currentIds.filter((id) => !desiredSet.has(id));
  const toAddCandidates = desiredIds.filter((id) => !currentSet.has(id));

  // Only real, current tutors get a row. An id that matches no lecturer is
  // dropped rather than stored — the same call from a stale form must not
  // wedge on one bad option.
  const validToAdd = toAddCandidates.length
    ? (
        await prisma.lecturer.findMany({
          where: { id: { in: toAddCandidates } },
          select: { id: true, user: { select: { id: true, name: true, email: true } } },
        })
      )
    : [];
  const validToAddIds = validToAdd.map((lecturer) => lecturer.id);

  const nameFor = (lecturer: { user: { name: string | null; email: string } }) =>
    lecturer.user.name || lecturer.user.email;

  if (!toRemove.length && !validToAddIds.length) {
    return {
      ok: true,
      studentName,
      changed: false,
      coTutorNames: student.coTutors.map((row) => nameFor(row.lecturer)),
      added: [],
      removed: [],
    };
  }

  await prisma.$transaction([
    ...(toRemove.length
      ? [
          prisma.studentCoTutor.deleteMany({
            where: { studentId, lecturerId: { in: toRemove } },
          }),
        ]
      : []),
    ...(validToAddIds.length
      ? [
          prisma.studentCoTutor.createMany({
            data: validToAddIds.map((lecturerId) => ({ studentId, lecturerId, assignedById })),
            skipDuplicates: true,
          }),
        ]
      : []),
  ]);

  const finalNames = [
    ...student.coTutors.filter((row) => !toRemove.includes(row.lecturerId)).map((row) => nameFor(row.lecturer)),
    ...validToAdd.map(nameFor),
  ];

  if (!quiet) {
    for (const lecturer of validToAdd) {
      await notify({
        to: { userIds: [lecturer.user.id] },
        kind: KIND.announcement,
        severity: "info",
        title: "A student was added to your class",
        message: `The office added ${studentName} to you as a co-tutor. They are on your roster, your register and your gradebook from now, alongside their main tutor.`,
        link: "/lecturer/students",
        push: true,
      }).catch((error) => console.error("Co-tutor pairing notification failed", error));
    }

    if (toRemove.length) {
      const removedLecturers = await prisma.lecturer.findMany({
        where: { id: { in: toRemove } },
        select: { user: { select: { id: true } } },
      });
      for (const lecturer of removedLecturers) {
        await notify({
          to: { userIds: [lecturer.user.id] },
          kind: KIND.announcement,
          severity: "info",
          title: "A student was removed from your class",
          message: `The office removed ${studentName} from your co-tutor list. They no longer appear on your register or gradebook.`,
          link: "/lecturer/students",
          push: true,
        }).catch((error) => console.error("Co-tutor pairing notification failed", error));
      }
    }

    if (validToAddIds.length) {
      await notify({
        to: { studentIds: [studentId] },
        kind: KIND.announcement,
        severity: "success",
        title: "Your teaching team has changed",
        message:
          finalNames.length === 1
            ? `${finalNames[0]} is now also teaching you.`
            : `You now have ${finalNames.length + 1} tutors: ${finalNames.join(", ")} alongside your main tutor. They can all see your progress and mark your work.`,
        link: "/classes",
        push: true,
      }).catch((error) => console.error("Co-tutor pairing notification failed", error));
    }
  }

  return {
    ok: true,
    studentName,
    changed: true,
    coTutorNames: finalNames,
    added: validToAddIds,
    removed: toRemove,
  };
}
