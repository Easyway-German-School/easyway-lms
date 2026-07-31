import { NextRequest, NextResponse } from "next/server";
import bcryptjs from "bcryptjs";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

import { requireCapability } from "@/lib/admin-roles";
const COURSE_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;

type CourseLevel = (typeof COURSE_LEVELS)[number];

async function isAdmin(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  return user?.role?.toLowerCase() === "admin";
}

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

async function createClassForLecturer(lecturerId: string, level: CourseLevel) {
  const course = await ensureLecturerTemplateCourse(level);
  return prisma.class.create({
    data: {
      courseId: course.id,
      lecturerId,
      name: `${level} class`,
      description: `Class for ${level} students taught by this lecturer.`,
      schedule: null,
    },
    include: {
      course: true,
    },
  });
}

export async function GET() {
  const gate = await requireCapability("staff");
  if (!gate.ok) return gate.response;

  const session = await getServerSession(authOptions as any) as any;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!(await isAdmin(session.user.id))) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const lecturers = await prisma.lecturer.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      user: true,
      classes: {
        include: { course: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  return NextResponse.json({ lecturers });
}

export async function POST(request: NextRequest) {
  const gate = await requireCapability("staff");
  if (!gate.ok) return gate.response;

  const session = await getServerSession(authOptions as any) as any;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!(await isAdmin(session.user.id))) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const specialization = typeof body?.specialization === "string" ? body.specialization.trim() : "";
  const bio = typeof body?.bio === "string" ? body.bio.trim() : "";
  const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
  const levels = Array.isArray(body?.levels)
    ? body.levels.filter((level: any) => COURSE_LEVELS.includes(level))
    : [];

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
        },
      },
    },
    include: { lecturer: true },
  });

  const classes = [] as Array<{
    id: string;
    name: string;
    courseId: string;
    courseTitle: string;
    level: string;
  }>;

  if (user.lecturer?.id && levels.length > 0) {
    for (const level of levels) {
      const klass = await createClassForLecturer(user.lecturer.id, level as CourseLevel);
      classes.push({
        id: klass.id,
        name: klass.name,
        courseId: klass.courseId,
        courseTitle: klass.course.title,
        level: klass.course.level,
      });
    }
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
        password,
      },
      classes,
    },
    { status: 201 }
  );
}
