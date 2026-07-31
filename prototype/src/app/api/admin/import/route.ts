import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import bcryptjs from "bcryptjs";

import { requireCapability } from "@/lib/admin-roles";
async function isLecturer(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return false;
  return (user.role?.toLowerCase() === "lecturer" || user.role?.toLowerCase() === "admin");
}

export async function POST(request: NextRequest) {
  const gate = await requireCapability("students");
  if (!gate.ok) return gate.response;

  const session = await getServerSession(authOptions as any) as any;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!await isLecturer(session.user.id)) {
    return NextResponse.json({ error: "Lecturer access required" }, { status: 403 });
  }

  const body = await request.json();
  const mode = body.mode;
  const rows = Array.isArray(body.rows) ? body.rows : [];

  if (!mode || rows.length === 0) {
    return NextResponse.json({ error: "Mode and rows are required" }, { status: 400 });
  }

  try {
    if (mode === "students") {
      let created = 0;
      for (const raw of rows) {
        const name = (raw.name || raw.full_name || raw.fullname || "").trim();
        const email = (raw.email || "").trim().toLowerCase();
        const level = (raw.level || "A1").trim() || "A1";
        const pathway = (raw.pathway || raw.course || "Lecturer Uploaded Courses").trim() || "Lecturer Uploaded Courses";

        if (!name || !email) continue;

        const existing = await prisma.user.findUnique({ where: { email } });
        if (existing) {
          const student = await prisma.student.findUnique({ where: { userId: existing.id } });
          if (!student) {
            await prisma.student.create({ data: { userId: existing.id, level, pathway } });
          }
          continue;
        }

        const password = Math.random().toString(36).slice(-10);
        const hashed = await bcryptjs.hash(password, 10);
        const user = await prisma.user.create({ data: { email, name, password: hashed, role: "STUDENT" } });
        await prisma.student.create({ data: { userId: user.id, level, pathway } });
        created += 1;
      }
      return NextResponse.json({ created, message: `${created} students imported.` });
    }

    if (mode === "courses") {
      const pathway = await prisma.pathway.upsert({
        where: { name: "Lecturer Uploaded Courses" },
        update: {},
        create: {
          name: "Lecturer Uploaded Courses",
          headline: "Courses created by lecturers",
          description: "Custom courses uploaded by instructors",
          duration: "Varies",
          level: "A1-C2"
        }
      });

      let courseCount = 0;
      let moduleCount = 0;
      let lessonCount = 0;
      const createdCourses = new Map<string, string>();
      const createdModules = new Map<string, string>();

      for (const raw of rows) {
        const courseTitle = (raw.course_title || raw.title || "Untitled course").trim();
        const courseDescription = (raw.course_description || raw.description || "").trim();
        const level = (raw.level || "A1").trim() || "A1";
        const moduleTitle = (raw.module_title || raw.module || "Module 1").trim();
        const lessonTitle = (raw.lesson_title || raw.lesson || "Lesson 1").trim();
        const lessonType = (raw.lesson_type || raw.type || "lesson").trim() || "lesson";
        const lessonContent = (raw.lesson_content || raw.content || "").trim();
        const duration = Number(raw.duration || 20) || 20;

        if (!courseTitle || !lessonTitle) continue;

        let courseId = createdCourses.get(courseTitle);
        let course;
        if (!courseId) {
          course = await prisma.course.findFirst({
            where: { pathwayId: pathway.id, title: courseTitle }
          });
          if (!course) {
            course = await prisma.course.create({
              data: {
                pathwayId: pathway.id,
                title: courseTitle,
                description: courseDescription,
                order: 999,
                duration,
                level
              }
            });
            courseCount += 1;
          }
          courseId = course.id;
          createdCourses.set(courseTitle, courseId);
        }

        const moduleKey = `${courseId}:${moduleTitle}`;
        let moduleId = createdModules.get(moduleKey);
        let module;
        if (!moduleId) {
          module = await prisma.module.findFirst({
            where: { courseId, title: moduleTitle }
          });
          if (!module) {
            module = await prisma.module.create({
              data: {
                courseId,
                title: moduleTitle,
                description: `Module for ${moduleTitle}`,
                order: 1
              }
            });
            moduleCount += 1;
          }
          moduleId = module.id;
          createdModules.set(moduleKey, moduleId);
        }

        await prisma.lesson.create({
          data: {
            moduleId,
            title: lessonTitle,
            description: lessonTitle,
            content: lessonContent,
            type: lessonType,
            order: 1,
            duration
          }
        });
        lessonCount += 1;
      }

      return NextResponse.json({
        courseCount,
        moduleCount,
        lessonCount,
        message: `${lessonCount} lessons imported across ${courseCount} courses.`
      });
    }

    return NextResponse.json({ error: "Invalid import mode" }, { status: 400 });
  } catch (error) {
    console.error("Import error:", error);
    return NextResponse.json({ error: "Failed to import data" }, { status: 500 });
  }
}
