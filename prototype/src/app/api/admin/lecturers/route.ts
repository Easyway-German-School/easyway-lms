import { NextRequest, NextResponse } from "next/server";
import bcryptjs from "bcryptjs";
import { prisma } from "@/lib/prisma";

import { requireCapability } from "@/lib/admin-roles";
import {
  COURSE_LEVELS,
  assignmentToData,
  describeAssignment,
  isAssigned,
  readAssignment,
  studentWhereForAssignment,
  matchesBatch,
  type CourseLevel,
} from "@/lib/lecturer-assignment";
import { KIND, notify } from "@/lib/notify";

/**
 * Tutor administration.
 *
 * A tutor's branches, levels, sittings, class types and batches are set here
 * and nowhere else. The tutor portal reads them; it does not write them. That
 * is the whole point — the school needs one answer to "who teaches this class"
 * that a tutor cannot change out from under it.
 */

async function ensureLecturerTemplateCourse(level: CourseLevel) {
  const pathway = await prisma.pathway.upsert({
    where: { name: "Lecturer Uploaded Courses" },
    update: {},
    create: {
      name: "Lecturer Uploaded Courses",
      headline: "Courses uploaded by lecturers",
      description: "Core course templates for lecturer-led classes.",
      duration: "8 weeks",
      level: "A1-C2",
    },
  });

  return prisma.course.upsert({
    where: {
      source_externalId: {
        source: "lecturer-template",
        externalId: level,
      },
    },
    update: {
      title: `German ${level} Class Materials`,
      description: `Core ${level} materials and updates for students at this level.`,
      level,
      duration: 60,
      pathwayId: pathway.id,
    },
    create: {
      pathwayId: pathway.id,
      title: `German ${level} Class Materials`,
      description: `Core ${level} materials and updates for students at this level.`,
      order: 900,
      duration: 60,
      level,
      source: "lecturer-template",
      externalId: level,
    },
  });
}

/**
 * Give the tutor a Class row per level they teach, so materials they upload
 * have somewhere to hang. Idempotent: re-saving an assignment that already has
 * its classes adds nothing, and levels removed from the assignment keep their
 * classes rather than deleting a tutor's uploaded materials as a side effect.
 */
async function syncLecturerClasses(lecturerId: string, levels: string[]) {
  const existing = await prisma.class.findMany({
    where: { lecturerId },
    include: { course: { select: { level: true } } },
  });
  const covered = new Set(existing.map((klass) => klass.course.level));

  for (const level of levels) {
    if (covered.has(level)) continue;
    const course = await ensureLecturerTemplateCourse(level as CourseLevel);
    await prisma.class.create({
      data: {
        courseId: course.id,
        lecturerId,
        name: `${level} class`,
        description: `Class for ${level} students taught by this lecturer.`,
      },
    });
  }
}

/** How many students an assignment currently reaches. */
async function countStudents(assignment: ReturnType<typeof readAssignment>) {
  const where = studentWhereForAssignment(assignment);
  if (!where) return 0;
  if (!assignment.batches.length) {
    return prisma.student.count({ where: where as any });
  }
  const rows = await prisma.student.findMany({ where: where as any, select: { admission: true } });
  return rows.filter((row) => matchesBatch(assignment, row.admission)).length;
}

export async function GET() {
  const gate = await requireCapability("staff");
  if (!gate.ok) return gate.response;

  const [lecturers, branches] = await Promise.all([
    prisma.lecturer.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        user: { select: { id: true, name: true, email: true, role: true } },
        classes: { include: { course: true }, orderBy: { createdAt: "asc" } },
      },
    }),
    prisma.branch.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, mode: true } }),
  ]);

  const branchNames = new Map(branches.map((branch) => [branch.id, branch.name]));

  const rows = await Promise.all(
    lecturers.map(async (lecturer) => {
      const assignment = readAssignment(lecturer);
      return {
        id: lecturer.id,
        user: lecturer.user,
        specialization: lecturer.specialization,
        bio: lecturer.bio,
        phone: lecturer.phone,
        photoUrl: lecturer.photoUrl,
        assignment,
        assignmentLabel: describeAssignment(assignment, branchNames),
        studentCount: await countStudents(assignment),
        classes: lecturer.classes.map((klass) => ({
          id: klass.id,
          name: klass.name,
          course: { title: klass.course.title, level: klass.course.level },
        })),
      };
    }),
  );

  return NextResponse.json({ lecturers: rows, branches });
}

export async function POST(request: NextRequest) {
  const gate = await requireCapability("staff");
  if (!gate.ok) return gate.response;

  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const specialization = typeof body?.specialization === "string" ? body.specialization.trim() : "";
  const bio = typeof body?.bio === "string" ? body.bio.trim() : "";
  const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
  const photoUrl = typeof body?.photoUrl === "string" ? body.photoUrl.trim() : "";

  if (!name || !email || !password) {
    return NextResponse.json({ error: "Name, email and password are required" }, { status: 400 });
  }

  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "Email already registered" }, { status: 409 });
  }

  const assignment = assignmentToData(body ?? {});

  const hashedPassword = await bcryptjs.hash(password, 10);
  const user = await prisma.user.create({
    data: {
      email,
      name,
      password: hashedPassword,
      role: "LECTURER",
      lecturer: {
        create: {
          specialization: specialization || null,
          bio: bio || null,
          phone: phone || null,
          photoUrl: photoUrl || null,
          ...assignment,
        },
      },
    },
    include: { lecturer: true },
  });

  if (user.lecturer?.id && assignment.levels.length) {
    await syncLecturerClasses(user.lecturer.id, assignment.levels);
  }

  return NextResponse.json(
    {
      success: true,
      lecturer: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        lecturerId: user.lecturer?.id || null,
        // Echoed back once so the admin can hand it over. It is never stored
        // in plain text and never readable again after this response.
        password,
      },
    },
    { status: 201 },
  );
}

/**
 * PATCH — edit an existing tutor.
 *
 * This is the piece that was missing entirely: once a tutor was created their
 * assignment was frozen, so a class that changed hands mid-term could not be
 * recorded at all.
 */
export async function PATCH(request: NextRequest) {
  const gate = await requireCapability("staff");
  if (!gate.ok) return gate.response;

  const body = await request.json().catch(() => null);
  const lecturerId = typeof body?.lecturerId === "string" ? body.lecturerId : "";
  if (!lecturerId) {
    return NextResponse.json({ error: "lecturerId is required" }, { status: 400 });
  }

  const lecturer = await prisma.lecturer.findUnique({
    where: { id: lecturerId },
    include: { user: { select: { id: true, name: true } } },
  });
  if (!lecturer) {
    return NextResponse.json({ error: "Tutor not found" }, { status: 404 });
  }

  const data: Record<string, unknown> = {};
  if (typeof body.specialization === "string") data.specialization = body.specialization.trim() || null;
  if (typeof body.bio === "string") data.bio = body.bio.trim() || null;
  if (typeof body.phone === "string") data.phone = body.phone.trim() || null;
  if (typeof body.photoUrl === "string") data.photoUrl = body.photoUrl.trim() || null;

  // The assignment fields move as a set. Sending any one of them rewrites all
  // of them, so a half-submitted form can never leave a tutor assigned to a
  // branch at a level they no longer teach.
  const touchesAssignment = ["branchIds", "levels", "sessionSlots", "classTypes", "batches"].some(
    (key) => body[key] !== undefined,
  );
  let assignment: ReturnType<typeof assignmentToData> | null = null;
  if (touchesAssignment) {
    assignment = assignmentToData(body);
    Object.assign(data, assignment);
  }

  const updated = await prisma.lecturer.update({ where: { id: lecturerId }, data });

  if (assignment?.levels.length) {
    await syncLecturerClasses(lecturerId, assignment.levels);
  }

  // Tell the tutor their timetable changed. Silently reassigning somebody and
  // letting them find out from a roster that no longer matches their class is
  // how a Monday morning goes wrong.
  if (touchesAssignment) {
    const branches = await prisma.branch.findMany({ select: { id: true, name: true } });
    const label = describeAssignment(
      readAssignment(updated),
      new Map(branches.map((branch) => [branch.id, branch.name])),
    );
    await notify({
      to: { userIds: [lecturer.user.id] },
      kind: KIND.announcement,
      severity: "info",
      title: "Your teaching assignment was updated",
      message: isAssigned(readAssignment(updated))
        ? `You are now assigned to ${label}. Your roster, timetable and attendance lists have already been updated.`
        : "Your class assignment was cleared. Contact the office before your next session.",
      link: "/lecturer/classes",
    }).catch((error) => console.error("Assignment notification failed", error));
  }

  return NextResponse.json({ success: true });
}

export const dynamic = "force-dynamic";
