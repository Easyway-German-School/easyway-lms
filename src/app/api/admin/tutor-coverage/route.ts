import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability, scopedBranchIds } from "@/lib/admin-roles";
import {
  CLASS_TYPES,
  SESSION_SLOTS,
  readAssignment,
  teachingGroups,
} from "@/lib/lecturer-assignment";
import { LECTURER_STATUS_META, readLecturerStatus } from "@/lib/lecturer-status";

export const dynamic = "force-dynamic";

/**
 * Who teaches each group class — split into the campus (physical) tutor and
 * the online tutor, because a hybrid cohort is really two rooms and the class
 * timetable never surfaced that. A cohort is branch + level + sitting; a tutor
 * covers it when their assignment does, and the tutor's own `classTypes`
 * ("physical" / "online") decides which side of a hybrid cohort they take.
 *
 * Feeds the "Who teaches each class" panel on /admin/schedule. The panel writes
 * changes through the existing PATCH /api/admin/lecturers, so this route is
 * read-only.
 */

type Role = "campus" | "online" | "both";

/** Which side(s) of a hybrid cohort this tutor's class-type setting covers. */
function roleOf(classTypes: string[]): Role | null {
  const set = new Set(classTypes.map((value) => value.toLowerCase()));
  const groupRoles = [...set].filter((value) => value !== "private");
  if (groupRoles.length === 0) {
    // No class type chosen at all — only counts as a group tutor if they are
    // not explicitly a private-only tutor.
    return set.has("private") ? null : "both";
  }
  const hasPhysical = groupRoles.includes("physical");
  const hasOnline = groupRoles.includes("online");
  if (hasPhysical && hasOnline) return "both";
  if (hasPhysical) return "campus";
  if (hasOnline) return "online";
  return null;
}

export async function GET() {
  const gate = await requireCapability("classes");
  if (!gate.ok) return gate.response;

  const tenantId = gate.session.user.tenantId;
  const branchFilter = tenantId ? { tenantId } : {};
  const allowedBranchIds = scopedBranchIds(gate.admin);

  const [students, lecturers, branches] = await Promise.all([
    prisma.student.findMany({
      where: { status: "active", classType: { not: "private" }, branch: branchFilter },
      select: {
        level: true,
        sessionSlot: true,
        deliveryMode: true,
        branch: { select: { id: true, name: true, mode: true } },
      },
    }),
    prisma.lecturer.findMany({
      include: { user: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.branch.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, mode: true } }),
  ]);

  const branchNames = new Map<string, string>(
    branches.map((branch: { id: string; name: string }): [string, string] => [branch.id, branch.name]),
  );

  /* --------------------------------------------------------------- cohorts */

  type CohortAccum = {
    key: string;
    branchId: string;
    branchName: string;
    branchMode: string;
    level: string;
    sessionSlot: string;
    total: number;
    physical: number;
    hybrid: number;
    online: number;
  };
  const cohorts = new Map<string, CohortAccum>();

  for (const student of students) {
    if (!student.branch) continue;
    if (allowedBranchIds && !allowedBranchIds.includes(student.branch.id)) continue;
    const level = (student.level ?? "").toUpperCase();
    if (!level) continue;
    const slot = (student.sessionSlot ?? "evening").toLowerCase();
    const key = `${student.branch.id}:${level}:${slot}`;
    let cohort = cohorts.get(key);
    if (!cohort) {
      cohort = {
        key,
        branchId: student.branch.id,
        branchName: student.branch.name,
        branchMode: student.branch.mode,
        level,
        sessionSlot: slot,
        total: 0,
        physical: 0,
        hybrid: 0,
        online: 0,
      };
      cohorts.set(key, cohort);
    }
    cohort.total += 1;
    const mode = (student.deliveryMode ?? "physical").toLowerCase();
    if (mode === "online") cohort.online += 1;
    else if (mode === "hybrid") cohort.hybrid += 1;
    else cohort.physical += 1;
  }

  /* --------------------------------------------------------------- tutors */

  type TutorRow = {
    lecturerId: string;
    name: string;
    status: string;
    assignable: boolean;
    role: Role;
    classTypes: string[];
    assignment: {
      branchIds: string[];
      levels: string[];
      sessionSlots: string[];
      assignmentGroups: Array<{ branchId: string; level: string; sessionSlot: string; batch?: string }>;
      classTypes: string[];
      batches: string[];
    };
    /** `branchId:LEVEL:slot` keys this tutor teaches (slotless groups expanded). */
    cohortKeys: string[];
  };

  const tutorRows: TutorRow[] = [];

  for (const lecturer of lecturers) {
    const assignment = readAssignment(lecturer);
    const role = roleOf(assignment.classTypes);
    if (!role) continue; // private-only tutor — not part of the group timetable

    const groups = teachingGroups(assignment, branchNames);
    const cohortKeys = new Set<string>();
    for (const group of groups) {
      if (group.sessionSlot) {
        cohortKeys.add(`${group.branchId}:${group.level.toUpperCase()}:${group.sessionSlot.toLowerCase()}`);
      } else {
        for (const slot of SESSION_SLOTS) {
          cohortKeys.add(`${group.branchId}:${group.level.toUpperCase()}:${slot}`);
        }
      }
    }
    if (cohortKeys.size === 0) continue;

    const status = readLecturerStatus(lecturer.status);
    tutorRows.push({
      lecturerId: lecturer.id,
      name: lecturer.user.name ?? "Unnamed tutor",
      status,
      assignable: LECTURER_STATUS_META[status].assignable,
      role,
      classTypes: assignment.classTypes,
      assignment: {
        branchIds: assignment.branchIds,
        levels: assignment.levels,
        sessionSlots: assignment.sessionSlots,
        assignmentGroups: assignment.groups,
        classTypes: assignment.classTypes,
        batches: assignment.batches,
      },
      cohortKeys: [...cohortKeys],
    });
  }

  /* ---------------------------------------------------- stitch + gap flags */

  const rows = [...cohorts.values()]
    .sort((a, b) => a.branchName.localeCompare(b.branchName) || a.level.localeCompare(b.level) || a.sessionSlot.localeCompare(b.sessionSlot))
    .map((cohort) => {
      const teachers = tutorRows.filter((tutor) => tutor.cohortKeys.includes(cohort.key));
      const pick = (roles: Role[]) =>
        teachers
          .filter((tutor) => roles.includes(tutor.role))
          .map((tutor) => ({ lecturerId: tutor.lecturerId, name: tutor.name, status: tutor.status, role: tutor.role }));

      const campusTutors = pick(["campus", "both"]);
      const onlineTutors = pick(["online", "both"]);
      const assignableCampus = campusTutors.some((t) => LECTURER_STATUS_META[readLecturerStatus(t.status)].assignable);
      const assignableOnline = onlineTutors.some((t) => LECTURER_STATUS_META[readLecturerStatus(t.status)].assignable);

      const needsCampusSeat = cohort.physical + cohort.hybrid > 0;
      const needsOnlineSeat = cohort.online + cohort.hybrid > 0;

      const gaps: string[] = [];
      if (teachers.length === 0) gaps.push("No tutor assigned");
      else {
        if (needsCampusSeat && !assignableCampus) gaps.push("Needs a campus tutor");
        if (needsOnlineSeat && !assignableOnline) gaps.push("Needs an online tutor");
      }

      return {
        key: cohort.key,
        branchId: cohort.branchId,
        branchName: cohort.branchName,
        branchMode: cohort.branchMode,
        level: cohort.level,
        sessionSlot: cohort.sessionSlot,
        students: {
          total: cohort.total,
          physical: cohort.physical,
          hybrid: cohort.hybrid,
          online: cohort.online,
        },
        campusTutors,
        onlineTutors,
        gaps,
      };
    });

  return NextResponse.json({
    cohorts: rows,
    tutors: tutorRows
      .map((tutor) => ({
        lecturerId: tutor.lecturerId,
        name: tutor.name,
        status: tutor.status,
        assignable: tutor.assignable,
        role: tutor.role,
        classTypes: tutor.classTypes,
        assignment: tutor.assignment,
        cohortCount: tutor.cohortKeys.length,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    classTypes: CLASS_TYPES,
    summary: {
      cohorts: rows.length,
      missingAnyTutor: rows.filter((r) => r.gaps.includes("No tutor assigned")).length,
      missingCampusTutor: rows.filter((r) => r.gaps.includes("Needs a campus tutor")).length,
      missingOnlineTutor: rows.filter((r) => r.gaps.includes("Needs an online tutor")).length,
    },
  });
}
