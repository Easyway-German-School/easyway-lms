import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { parseQuestions, totalPoints, type Question } from "@/lib/assignments";
import {
  belongsToLecturer,
  readAssignment,
  studentWhereForLecturerScope,
} from "@/lib/lecturer-assignment";
import { notify, KIND } from "@/lib/notify";
import { studentsVisibleToAssignment } from "@/lib/student-assignments";
import { resolveOnlineBranchId } from "@/lib/online-branch-server";
import { groupStudentsByTutorPhrase } from "@/lib/tutor-attribution";
import { batchOfAdmission } from "@/lib/class-batch";

/** Tutors create and review assignments for a level (optionally one branch). */

export const dynamic = "force-dynamic";

type LecturerAssignmentsAuth =
  | { error: NextResponse }
  | { userId: string; lecturerId: string | null; isAdmin: boolean; tenantId: string | null };

const assignmentAudienceStudentSelect = {
  id: true,
  studentCode: true,
  admission: true,
  tutorId: true,
  branchId: true,
  level: true,
  sessionSlot: true,
  coTutors: { select: { lecturerId: true } },
  user: { select: { name: true } },
} as const;

type AssignmentScopeOption = {
  key: string;
  branchId: string;
  branchName: string;
  level: string;
  sessionSlot: string | null;
  batch: string | null;
  label: string;
};

async function requireStaff(): Promise<LecturerAssignmentsAuth> {
  const session = await requireAuthSession();
  if (!session) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!session?.user?.id) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, role: true, tenantId: true, lecturer: { select: { id: true } } },
  });
  const role = String(user?.role ?? "").toLowerCase();
  if (role !== "lecturer" && role !== "admin") {
    return { error: NextResponse.json({ error: "Staff access required" }, { status: 403 }) };
  }
  if (role === "lecturer" && !user?.lecturer?.id) {
    return { error: NextResponse.json({ error: "Tutor account is not linked to a lecturer profile" }, { status: 403 }) };
  }
  return {
    userId: user!.id,
    lecturerId: user?.lecturer?.id ?? null,
    isAdmin: role === "admin",
    tenantId: user?.tenantId ?? null,
  };
}

async function assignmentScopeOptions(
  lecturerId: string | null,
  tenantId: string | null,
): Promise<AssignmentScopeOption[]> {
  if (!lecturerId) return [];
  const lecturer = await prisma.lecturer.findUnique({
    where: { id: lecturerId },
    select: {
      branchId: true,
      level: true,
      sessionSlot: true,
      branchIds: true,
      levels: true,
      sessionSlots: true,
      assignmentGroups: true,
      classTypes: true,
    },
  });
  if (!lecturer) return [];

  const assignment = readAssignment(lecturer);
  const onlineBranchId = await resolveOnlineBranchId(tenantId);
  const onlineOnly = assignment.classTypes.length === 1 && assignment.classTypes[0] === "online";
  const includesOnline = assignment.classTypes.includes("online");
  const campusOnly =
    assignment.classTypes.length === 1 &&
    (assignment.classTypes[0] === "physical" || assignment.classTypes[0] === "private");

  let groups = assignment.groups.length
    ? assignment.groups.map((group) => ({
        branchId: group.branchId,
        level: group.level,
        sessionSlot: group.sessionSlot,
        batch: group.batch ?? null,
      }))
    : assignment.branchIds.flatMap((branchId) =>
        assignment.levels.flatMap((level) =>
          (assignment.sessionSlots.length ? assignment.sessionSlots : [null]).map((sessionSlot) => ({
            branchId,
            level,
            sessionSlot,
            batch: null,
          })),
        ),
      );

  if (includesOnline && onlineBranchId && !groups.some((group) => group.branchId === onlineBranchId)) {
    const onlineGroups = assignment.groups.length
      ? groups.map((group) => ({ ...group, branchId: onlineBranchId }))
      : assignment.levels.flatMap((level) =>
          (assignment.sessionSlots.length ? assignment.sessionSlots : [null]).map((sessionSlot) => ({
            branchId: onlineBranchId,
            level,
            sessionSlot,
            batch: null,
          })),
        );
    groups = onlineOnly ? onlineGroups : [...groups, ...onlineGroups];
  }

  const branchIds = [...new Set(groups.map((group) => group.branchId))];
  if (!branchIds.length) return [];
  const branches = await prisma.branch.findMany({
    where: { id: { in: branchIds } },
    select: { id: true, name: true, mode: true },
  });
  const byId = new Map(branches.map((branch) => [branch.id, branch]));

  return groups.flatMap((group) => {
    const branch = byId.get(group.branchId);
    if (!branch || !group.level) return [];
    if (onlineOnly && branch.mode !== "online") return [];
    if (campusOnly && branch.mode === "online") return [];

    const labelParts = [
      branch.mode === "online" ? "Online" : branch.name,
      group.level,
      group.sessionSlot ? group.sessionSlot.charAt(0).toUpperCase() + group.sessionSlot.slice(1) : "All sittings",
      group.batch ? `${group.batch} batch` : "",
    ].filter(Boolean);

    return [{
      key: JSON.stringify([group.branchId, group.level, group.sessionSlot, group.batch]),
      branchId: group.branchId,
      branchName: branch.name,
      level: group.level,
      sessionSlot: group.sessionSlot,
      batch: group.batch,
      label: labelParts.join(" · "),
    }];
  });
}

export async function GET(req: NextRequest) {
  const auth = await requireStaff();
  if ("error" in auth) return auth.error;

  const level = req.nextUrl.searchParams.get("level");
  let lecturerAssignment: ReturnType<typeof readAssignment> | null = null;
  let rosterWhere: Record<string, unknown> | null = null;
  if (!auth.isAdmin && auth.lecturerId) {
    const lecturer = await prisma.lecturer.findUnique({
      where: { id: auth.lecturerId },
      select: {
        id: true,
        branchId: true,
        level: true,
        sessionSlot: true,
        branchIds: true,
        levels: true,
        sessionSlots: true,
        assignmentGroups: true,
        classTypes: true,
        batches: true,
        pathways: true,
      },
    });
    lecturerAssignment = lecturer ? readAssignment(lecturer) : null;
    rosterWhere = lecturerAssignment ? studentWhereForLecturerScope(lecturerAssignment, auth.lecturerId) : null;
    if (!lecturerAssignment || !rosterWhere) {
      return NextResponse.json({ assignments: [], scopeRequired: true, scopeOptions: [] });
    }
  }

  const assignments = await prisma.assignment.findMany({
    where: {
      ...(level ? { level } : {}),
      ...(!auth.isAdmin ? { lecturerId: auth.lecturerId } : {}),
    },
    orderBy: { createdAt: "desc" },
    include: {
      branch: { select: { id: true, name: true } },
      targets: {
        select: {
          student: { select: assignmentAudienceStudentSelect },
        },
      },
      submissions: {
        where: { submittedAt: { not: null } },
        select: {
          id: true,
          score: true,
          needsReview: true,
          submittedAt: true,
          student: { select: assignmentAudienceStudentSelect },
        },
        orderBy: { submittedAt: "desc" },
      },
    },
  });

  return NextResponse.json({
    assignments: assignments.map((assignment) => {
      const visibleTargets = assignment.targets.filter(
        (target) =>
          auth.isAdmin ||
          Boolean(
            lecturerAssignment &&
              belongsToLecturer(lecturerAssignment, auth.lecturerId, target.student),
          ),
      );
      const visibleSubmissions = assignment.submissions.filter(
        (submission) =>
          auth.isAdmin ||
          Boolean(
            lecturerAssignment &&
              belongsToLecturer(lecturerAssignment, auth.lecturerId, submission.student),
          ),
      );

      return {
        ...assignment,
        targets: visibleTargets.map((target) => ({
          student: {
            id: target.student.id,
            studentCode: target.student.studentCode,
            user: target.student.user,
          },
        })),
        submissions: visibleSubmissions.map((submission) => ({
          id: submission.id,
          score: submission.score,
          needsReview: submission.needsReview,
          submittedAt: submission.submittedAt,
          student: {
            studentCode: submission.student.studentCode,
            user: submission.student.user,
          },
        })),
        questionCount: parseQuestions(assignment.questions).length,
        totalPoints: totalPoints(parseQuestions(assignment.questions)),
        _count: { submissions: visibleSubmissions.length },
        targetStudents: visibleTargets.map((target) => ({
          id: target.student.id,
          name: target.student.user?.name ?? null,
          studentCode: target.student.studentCode,
        })),
        awaitingMarking: visibleSubmissions.filter((submission) => submission.needsReview).length,
      };
    }),
    scopeRequired: !auth.isAdmin,
    scopeOptions: auth.isAdmin ? [] : await assignmentScopeOptions(auth.lecturerId, auth.tenantId),
  });
}

/**
 * Everything that makes a set of questions markable.
 *
 * Checked here rather than trusted from the builder, because the builder is a
 * browser and a browser is not where correctness lives. A question that cannot
 * be marked — no correct option ticked, no accepted spelling given — silently
 * scores every student zero, and nobody finds out until the results are
 * already wrong.
 */
function questionProblem(questions: Question[]): string | null {
  if (questions.length === 0) {
    return "Add at least one complete question. Check every question has its wording filled in, and that choice questions have at least two options.";
  }

  for (const [index, question] of questions.entries()) {
    const where = `Question ${index + 1}`;

    if (question.type === "choice" && (question.answerIndex < 0 || question.answerIndex >= question.options.length)) {
      return `${where}: tick the correct option.`;
    }
    if (question.type === "multi" && question.answerIndexes.length === 0) {
      return `${where}: tick at least one correct option.`;
    }
    if (question.type === "short" && question.accepted.length === 0) {
      return `${where}: give at least one accepted answer.`;
    }
  }

  return null;
}

/** Narrow a list of student ids to the ones that really exist at this level. */
async function resolveTargets(
  studentIds: unknown,
  level: string,
  sessionSlot?: string | null,
  branchId?: string | null,
  lecturerId?: string | null,
  tenantId?: string | null,
  batch?: string | null,
  includeBatch?: boolean,
): Promise<{ ids: string[]; invalid: boolean }> {
  const requestedIds = Array.isArray(studentIds) ? [...new Set(studentIds.map((id) => String(id)).filter(Boolean))] : [];
  if (!requestedIds.length && !(includeBatch && batch)) return { ids: [], invalid: false };

  // Filtered by level and scope as well as id: a tutor should not be able to
  // set morning work for afternoon students by posting an id the picker never
  // offered. Match the actual taught cohort instead of letting a broad level
  // query leak the whole database.
  const lecturer = lecturerId
    ? await prisma.lecturer.findUnique({
        where: { id: lecturerId },
        select: {
          id: true,
          branchId: true,
          level: true,
          sessionSlot: true,
          branchIds: true,
          levels: true,
          sessionSlots: true,
          assignmentGroups: true,
          classTypes: true,
          batches: true,
          pathways: true,
        },
      })
    : null;
  const onlineBranchId = await resolveOnlineBranchId(tenantId);
  const scope = lecturer
    ? studentWhereForLecturerScope(readAssignment(lecturer), lecturer.id, {
        level,
        sessionSlot,
        branchId,
        onlineBranchId,
      })
    : { level, ...(sessionSlot ? { sessionSlot } : {}), ...(branchId ? { branchId } : {}) };
  if (!scope) return { ids: [], invalid: requestedIds.length > 0 };

  const students = await prisma.student.findMany({
    where: {
      ...(requestedIds.length ? { id: { in: requestedIds } } : {}),
      ...(scope ?? {}),
      status: "active",
    } as any,
    select: {
      id: true,
      tutorId: true,
      coTutors: { select: { lecturerId: true } },
      admission: true,
      branchId: true,
      level: true,
      sessionSlot: true,
    },
  });

  const assignment = lecturer ? readAssignment(lecturer) : null;
  const eligible = students.filter(
    (student) =>
      (!assignment || belongsToLecturer(assignment, lecturerId, student)) &&
      (!batch || batchOfAdmission(student.admission).toLowerCase() === batch.toLowerCase()),
  );
  const ids = eligible.map((student) => student.id);
  return {
    ids,
    invalid: requestedIds.length > 0 && ids.length !== requestedIds.length,
  };
}

export async function POST(req: NextRequest) {
  const auth = await requireStaff();
  if ("error" in auth) return auth.error;

  try {
    const body = await req.json();
    const {
      title,
      description,
      level,
      type,
      timeLimitMinutes,
      questions,
      dueAt,
      studentIds,
    } = body;

    if (!title || !level) {
      return NextResponse.json({ error: "title and level are required" }, { status: 400 });
    }

    let normalizedLevel = String(level).toUpperCase();
    let resolvedBranchId = typeof body.branchId === "string" && body.branchId ? body.branchId : null;
    let resolvedSessionSlot =
      typeof body.sessionSlot === "string" &&
      ["morning", "afternoon", "evening", "weekend"].includes(body.sessionSlot.toLowerCase())
        ? body.sessionSlot.toLowerCase()
        : null;
    let resolvedBatch = typeof body.batch === "string" && body.batch ? body.batch : null;

    if (!auth.isAdmin) {
      if (!auth.lecturerId) {
        return NextResponse.json({ error: "Tutor account is not linked to a lecturer profile" }, { status: 403 });
      }
      const options = await assignmentScopeOptions(auth.lecturerId, auth.tenantId);
      const matches = options.filter(
        (option) =>
          option.level === normalizedLevel &&
          (!resolvedBranchId || option.branchId === resolvedBranchId) &&
          (!resolvedSessionSlot || option.sessionSlot === resolvedSessionSlot) &&
          (!resolvedBatch || option.batch?.toLowerCase() === resolvedBatch.toLowerCase()),
      );
      if (matches.length !== 1) {
        return NextResponse.json(
          { error: "Choose one of your assigned classes before creating this assignment." },
          { status: 403 },
        );
      }
      const scope = matches[0];
      normalizedLevel = scope.level;
      resolvedBranchId = scope.branchId;
      resolvedSessionSlot = scope.sessionSlot;
      resolvedBatch = scope.batch;
    }

    const kind = type === "quiz" ? "quiz" : "document";
    const parsed = kind === "quiz" ? parseQuestions(questions) : [];

    if (kind === "quiz") {
      const problem = questionProblem(parsed);
      if (problem) return NextResponse.json({ error: problem }, { status: 400 });
    }

    const resolvedTargets = await resolveTargets(
      studentIds,
      normalizedLevel,
      resolvedSessionSlot,
      resolvedBranchId,
      auth.lecturerId,
      auth.tenantId,
      resolvedBatch,
      Boolean(resolvedBatch),
    );
    if (resolvedTargets.invalid) {
      return NextResponse.json(
        { error: "One or more selected students are outside your assigned class." },
        { status: 403 },
      );
    }
    const targetIds = resolvedTargets.ids;
    if (resolvedBatch && targetIds.length === 0) {
      return NextResponse.json(
        { error: "There are no active students in that batch to receive this assignment." },
        { status: 409 },
      );
    }

    const created = await prisma.assignment.create({
      data: {
        title: String(title).trim(),
        description: typeof description === "string" ? description.trim() || null : null,
        level: normalizedLevel,
        branchId: resolvedBranchId,
        /**
         * Empty means every sitting at this level, which is how assignments
         * behaved before sessions became a boundary. A tutor who teaches the
         * morning A1 class can now set homework for the morning A1 class,
         * rather than for three cohorts taught by three different people.
         */
        sessionSlot: resolvedSessionSlot,
        type: kind,
        timeLimitMinutes: kind === "quiz" && timeLimitMinutes ? Number(timeLimitMinutes) : null,
        questions: kind === "quiz" ? (parsed as object[]) : undefined,
        dueAt: dueAt ? new Date(dueAt) : null,
        lecturerId: auth.lecturerId ?? null,
        targets: targetIds.length ? { create: targetIds.map((studentId) => ({ studentId })) } : undefined,
      },
    });

    if (created.published) {
      const dueLine = created.dueAt ? ` Due ${created.dueAt.toLocaleDateString()}.` : "";
      const notifyBase = {
        kind: KIND.assignmentDue,
        severity: "info" as const,
        title: kind === "quiz" ? "New quiz to take" : "New assignment to submit",
        link: `/assignment?id=${created.id}`,
        dedupeKey: `assignment-created:${created.id}`,
        push: true,
      };

      // Named students get it directly; an untargeted assignment reaches
      // everyone the student list would show it to — resolved to real ids
      // here (not `notify()`'s loose branch/sitting filter) so a hybrid
      // student hears about their ONLINE tutor's homework too, which that
      // filter can't see (their branch/sitting columns are their campus side).
      const onlineBranchId = await resolveOnlineBranchId(auth.tenantId);
      const audienceIds = targetIds.length
        ? targetIds
        : (
            await prisma.student.findMany({
              where: studentsVisibleToAssignment(
                { level: normalizedLevel, branchId: resolvedBranchId, sessionSlot: resolvedSessionSlot },
                onlineBranchId,
              ),
              select: { id: true, admission: true },
            })
          )
            .filter(
              (student) =>
                !resolvedBatch ||
                batchOfAdmission(student.admission).toLowerCase() === resolvedBatch.toLowerCase(),
            )
            .map((row) => row.id);

      // A hybrid student has two tutors, so "was just set for you" is not
      // enough — say whose. Grouped because the same tutor is a hybrid
      // student's *campus* tutor and a physical-only student's plain "tutor".
      const groups = auth.lecturerId
        ? await groupStudentsByTutorPhrase(audienceIds, auth.lecturerId)
        : new Map<string, string[]>([["", audienceIds]]);

      for (const [phrase, ids] of groups) {
        if (!ids.length) continue;
        const setBy = phrase ? `${phrase} set` : "";
        await notify({
          ...notifyBase,
          to: { studentIds: ids },
          message: phrase
            ? `${setBy} "${created.title}" for you.${dueLine} Go to Assignments in the portal to submit it.`
            : `"${created.title}" was just set for you.${dueLine} Go to Assignments in the portal to submit it.`,
        }).catch((error) => console.error("Assignment-created notification failed", error));
      }
    }

    return NextResponse.json({ assignment: created, targeted: targetIds.length });
  } catch (error) {
    console.error("Lecturer assignment POST failed:", error);
    return NextResponse.json({ error: "Unable to create the assignment" }, { status: 500 });
  }
}

/**
 * Edit an assignment.
 *
 * Refused once anybody has handed it in. Changing the questions under a
 * submitted paper would re-mark it against a test the student never sat, and
 * silently rewrite a result they may already have been told.
 */
export async function PATCH(req: NextRequest) {
  const auth = await requireStaff();
  if ("error" in auth) return auth.error;

  try {
    const body = await req.json();
    const { id, title, description, timeLimitMinutes, questions, dueAt, published, studentIds } = body;

    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

    const existing = await prisma.assignment.findUnique({
      where: { id: String(id) },
      select: {
        id: true,
        type: true,
        level: true,
        branchId: true,
        sessionSlot: true,
        lecturerId: true,
        _count: { select: { submissions: true } },
      },
    });
    if (!existing) return NextResponse.json({ error: "Assignment not found" }, { status: 404 });
    if (!auth.isAdmin && existing.lecturerId !== auth.lecturerId) {
      return NextResponse.json({ error: "Assignment not found" }, { status: 404 });
    }

    const hasSubmissions = existing._count.submissions > 0;
    const wantsQuestionChange = questions !== undefined;

    if (hasSubmissions && wantsQuestionChange) {
      return NextResponse.json(
        {
          error:
            "Students have already started this, so the questions cannot be changed. Unpublish it and set a new one instead.",
        },
        { status: 409 },
      );
    }

    let parsed: Question[] | undefined;
    if (wantsQuestionChange && existing.type === "quiz") {
      parsed = parseQuestions(questions);
      const problem = questionProblem(parsed);
      if (problem) return NextResponse.json({ error: problem }, { status: 400 });
    }

    const updated = await prisma.assignment.update({
      where: { id: existing.id },
      data: {
        ...(title !== undefined ? { title: String(title).trim() } : {}),
        ...(description !== undefined
          ? { description: typeof description === "string" ? description.trim() || null : null }
          : {}),
        ...(timeLimitMinutes !== undefined
          ? { timeLimitMinutes: timeLimitMinutes ? Number(timeLimitMinutes) : null }
          : {}),
        ...(dueAt !== undefined ? { dueAt: dueAt ? new Date(dueAt) : null } : {}),
        ...(published !== undefined ? { published: Boolean(published) } : {}),
        ...(parsed ? { questions: parsed as object[] } : {}),
      },
    });

    // Targets are replaced wholesale rather than diffed: the builder always
    // sends the full list, and a diff would need a delete path anyway.
    if (studentIds !== undefined) {
      if (!auth.isAdmin && !existing.branchId && !studentIds?.length) {
        return NextResponse.json(
          { error: "Choose an assigned class before removing the student targets." },
          { status: 403 },
        );
      }
      const resolvedTargets = await resolveTargets(
        studentIds,
        existing.level,
        existing.sessionSlot ?? null,
        existing.branchId ?? null,
        auth.lecturerId,
        auth.tenantId,
      );
      if (resolvedTargets.invalid) {
        return NextResponse.json(
          { error: "One or more selected students are outside your assigned class." },
          { status: 403 },
        );
      }
      const targetIds = resolvedTargets.ids;
      await prisma.assignmentTarget.deleteMany({ where: { assignmentId: existing.id } });
      if (targetIds.length) {
        await prisma.assignmentTarget.createMany({
          data: targetIds.map((studentId) => ({ assignmentId: existing.id, studentId })),
          skipDuplicates: true,
        });
      }
    }

    return NextResponse.json({ assignment: updated });
  } catch (error) {
    console.error("Lecturer assignment PATCH failed:", error);
    return NextResponse.json({ error: "Unable to update the assignment" }, { status: 500 });
  }
}
