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
import {
  isEmploymentType,
  isLecturerStatus,
  LECTURER_STATUS_META,
  readLecturerStatus,
} from "@/lib/lecturer-status";
import { lecturerFeatures, parseLecturerFeatures } from "@/lib/lecturer-features";

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
        status: readLecturerStatus(lecturer.status),
        statusNote: lecturer.statusNote,
        statusChangedAt: lecturer.statusChangedAt,
        // Resolved rather than raw, so the admin form shows the same answer the
        // tutor's own portal acts on — including the null-means-everything
        // default, which a raw column would render as no boxes ticked.
        features: lecturerFeatures(lecturer.features),
        employmentType: lecturer.employmentType,
        startedAt: lecturer.startedAt,
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

  // A newly created tutor is active unless the office says otherwise — the
  // usual case is hiring somebody, and "probation" is the only other sensible
  // starting point.
  const status = isLecturerStatus(body?.status) ? body.status : "active";
  const employmentType = isEmploymentType(body?.employmentType) ? body.employmentType : null;
  const startedAtRaw = body?.startedAt ? new Date(body.startedAt) : null;
  const startedAt = startedAtRaw && !Number.isNaN(startedAtRaw.getTime()) ? startedAtRaw : null;

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
          status,
          statusChangedAt: new Date(),
          employmentType,
          startedAt,
          // Absent from the form means everything, which is what a tutor
          // created before this field has. The office narrows it deliberately.
          features: parseLecturerFeatures(body?.features),
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

  // Employment terms and start date are plain record-keeping — they change
  // nothing about access, so they move independently of the status below.
  if (body.employmentType !== undefined) {
    if (body.employmentType === null || body.employmentType === "") {
      data.employmentType = null;
    } else if (isEmploymentType(body.employmentType)) {
      data.employmentType = body.employmentType;
    } else {
      return NextResponse.json({ error: "Unknown employment type" }, { status: 400 });
    }
  }
  if (body.startedAt !== undefined) {
    if (body.startedAt === null || body.startedAt === "") {
      data.startedAt = null;
    } else {
      const started = new Date(body.startedAt);
      if (Number.isNaN(started.getTime())) {
        return NextResponse.json({ error: "Invalid start date" }, { status: 400 });
      }
      data.startedAt = started;
    }
  }

  const previousStatus = readLecturerStatus(lecturer.status);
  let nextStatus = previousStatus;
  const statusChanged = body.status !== undefined && readLecturerStatus(body.status) !== previousStatus;

  if (body.status !== undefined) {
    if (!isLecturerStatus(body.status)) {
      return NextResponse.json({ error: "Unknown status" }, { status: 400 });
    }
    nextStatus = body.status;
    data.status = body.status;
    // Only stamped when the status actually moves, so the date answers "how
    // long has this held?" rather than "when was this row last touched?".
    if (statusChanged) data.statusChangedAt = new Date();
  }
  if (typeof body.statusNote === "string") data.statusNote = body.statusNote.trim() || null;

  /**
   * Which optional areas this tutor may reach. Only written when the key is
   * actually present, so a form that does not carry the checkboxes cannot
   * silently reset a tutor to "everything" — or to nothing.
   */
  if (body.features !== undefined) {
    data.features = parseLecturerFeatures(body.features);
  }

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

  /**
   * Tell the tutor their status moved — except when it moved to inactive,
   * which is the one case where a portal notification reaches nobody: they can
   * no longer sign in to read it. That conversation belongs to the office.
   */
  if (statusChanged && nextStatus !== "inactive") {
    await notify({
      to: { userIds: [lecturer.user.id] },
      kind: KIND.announcement,
      severity: nextStatus === "on_leave" ? "warning" : "info",
      title: `Your tutor status is now ${LECTURER_STATUS_META[nextStatus].label.toLowerCase()}`,
      message:
        typeof body.statusNote === "string" && body.statusNote.trim()
          ? body.statusNote.trim()
          : LECTURER_STATUS_META[nextStatus].description,
      link: "/lecturer/dashboard",
    }).catch((error) => console.error("Status notification failed", error));
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
