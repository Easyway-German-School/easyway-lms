import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse, NextRequest } from "next/server";

const defaultCoursesByPathway: Record<string, Array<{ title: string; description: string; duration: number; level: string; content: string }>> = {
  "Goethe exam mastery": [
    {
      title: "German A1 Foundations",
      description: "Build the core grammar, listening, and speaking habits for exam success.",
      duration: 45,
      level: "A1",
      content: "Sentence building, pronunciation checkpoints, and everyday vocabulary.",
    },
    {
      title: "German Essay Prep",
      description: "Structure paragraphs, improve linking phrases, and write clearer exam essays.",
      duration: 60,
      level: "B2",
      content: "Essay planning, coherence, and formal German writing.",
    },
    {
      title: "Live Speaking Lab",
      description: "Practice fluency with guided conversation drills and pronunciation coaching.",
      duration: 55,
      level: "B1",
      content: "Roleplays, speaking rhythm, and real-world dialogue practice.",
    },
  ],
  "Nursing career path": [
    {
      title: "Medical German Basics",
      description: "Learn practical vocabulary for patient interaction and clinical settings.",
      duration: 50,
      level: "A2",
      content: "Patient communication, symptom descriptions, and hospital language.",
    },
    {
      title: "Clinical Communication",
      description: "Practice conversations for intake, observation, and team handover.",
      duration: 55,
      level: "B1",
      content: "Professional dialogue and healthcare-specific phrasing.",
    },
    {
      title: "Workplace Readiness",
      description: "Prepare for real-world nursing environments with role-based German practice.",
      duration: 45,
      level: "B1",
      content: "Team communication, documentation, and practical language support.",
    },
  ],
  "IT relocation track": [
    {
      title: "Tech German Essentials",
      description: "Build confidence with workplace vocabulary and common relocation topics.",
      duration: 50,
      level: "A2",
      content: "Interview prep, team communication, and technical vocabulary.",
    },
    {
      title: "Interview Readiness",
      description: "Practice German for interviews, remote teams, and professional introductions.",
      duration: 55,
      level: "B1",
      content: "Professional speaking, CV language, and workplace confidence.",
    },
    {
      title: "Relocation Support",
      description: "Get ready for daily life, admin tasks, and team collaboration in Germany.",
      duration: 40,
      level: "A2",
      content: "Everyday German for relocation and work integration.",
    },
  ],
  "Ausbildung & Vocational Route": [
    {
      title: "Apprenticeship German",
      description: "Prepare for workplace instructions, interviews, and practical training.",
      duration: 45,
      level: "A2",
      content: "Trade language, workplace commands, and interview phrases.",
    },
    {
      title: "Company Interview Prep",
      description: "Practice the German you need to enter a training role with confidence.",
      duration: 50,
      level: "B1",
      content: "Formally structured interviews and professional self-presentation.",
    },
    {
      title: "Vocational Communication",
      description: "Strengthen everyday and on-the-job German for apprenticeships.",
      duration: 45,
      level: "A2",
      content: "Tools, procedures, and simple workplace communication.",
    },
  ],
};

function getStatus(progress: number) {
  if (progress >= 90) return "Almost done";
  if (progress >= 50) return "In progress";
  return "Next up";
}

async function getStudentVisibleLecturerCourses() {
  return prisma.course.findMany({
    where: {
      published: true,
      pathway: {
        name: "Lecturer Uploaded Courses",
      },
    },
    include: {
      modules: {
        orderBy: { order: "asc" },
        include: {
          lessons: {
            orderBy: { order: "asc" },
          },
        },
      },
    },
  });
}

async function ensureSeedCourses(pathwayName: string) {
  const existingPathway = await prisma.pathway.findUnique({
    where: { name: pathwayName },
    include: { courses: true },
  });

  if (existingPathway && existingPathway.courses.length > 0) {
    return existingPathway;
  }

  const pathway = await prisma.pathway.upsert({
    where: { name: pathwayName },
    update: {},
    create: {
      name: pathwayName,
      headline: `${pathwayName} learning journey`,
      description: `Structured web-based learning content for ${pathwayName}.`,
      duration: "8 weeks",
      level: "A1-B2",
    },
  });

  const templates = defaultCoursesByPathway[pathwayName] || defaultCoursesByPathway["Goethe exam mastery"];

  for (const [index, course] of templates.entries()) {
    const createdCourse = await prisma.course.create({
      data: {
        pathwayId: pathway.id,
        title: course.title,
        description: course.description,
        order: index + 1,
        duration: course.duration,
        level: course.level,
      },
    });

    const module = await prisma.module.create({
      data: {
        courseId: createdCourse.id,
        title: "Core learning path",
        description: `Structured lessons for ${course.title}`,
        order: 1,
      },
    });

    const lessonTemplates = [
      {
        title: `${course.title} - Warm-up`,
        description: `Starter practice for ${course.title}`,
        content: `${course.content}\n\nPractice task: review key vocabulary and complete a short reflection.`,
        type: "lesson",
        duration: Math.max(15, Math.round(course.duration / 4)),
      },
      {
        title: `${course.title} - Guided practice`,
        description: `Focused explanation and guided exercises for ${course.title}`,
        content: `${course.content}\n\nPractice task: apply the concept in a short speaking or writing exercise.`,
        type: "quiz",
        duration: Math.max(20, Math.round(course.duration / 3)),
      },
      {
        title: `${course.title} - Reflection`,
        description: `Wrap-up tasks and next-step recommendations for ${course.title}`,
        content: `${course.content}\n\nPractice task: reflect on what you learned and identify one improvement target.`,
        type: "assignment",
        duration: Math.max(15, Math.round(course.duration / 4)),
      },
    ];

    for (const [lessonIndex, lesson] of lessonTemplates.entries()) {
      await prisma.lesson.create({
        data: {
          moduleId: module.id,
          title: lesson.title,
          description: lesson.description,
          content: lesson.content,
          type: lesson.type,
          order: lessonIndex + 1,
          duration: lesson.duration,
        },
      });
    }
  }

  return prisma.pathway.findUnique({
    where: { id: pathway.id },
    include: { courses: true },
  });
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions as any) as any;
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const courseId = request.nextUrl.searchParams.get("courseId");
    if (courseId) {
      const course = await prisma.course.findUnique({
        where: { id: courseId },
        include: {
          pathway: true,
          modules: {
            orderBy: { order: "asc" },
            include: {
              lessons: {
                orderBy: { order: "asc" },
              },
            },
          },
        },
      });

      if (!course) {
        return NextResponse.json({ error: "Course not found" }, { status: 404 });
      }

      if (course.published === false) {
        const role = (session.user as any)?.role;
        if (!(role === "LECTURER" || role === "ADMIN")) {
          return NextResponse.json({ error: "Course not found" }, { status: 404 });
        }
      }

      return NextResponse.json({ course });
    }

    let student = await prisma.student.findUnique({
      where: { userId: session.user.id as string },
    });

    if (!student) {
      const userRole = (session.user as any)?.role;
      if (userRole === "LECTURER" || userRole === "ADMIN") {
        return NextResponse.json({ pathway: "Goethe exam mastery", courses: [] });
      }

      student = await prisma.student.create({
        data: {
          userId: session.user.id as string,
          level: "A1",
          pathway: "Goethe exam mastery",
          examReadiness: 0,
        },
      });
    }

    const pathwayName = student.pathway || "Goethe exam mastery";
    const pathway = await ensureSeedCourses(pathwayName);

    if (!pathway) {
      return NextResponse.json({ error: "Pathway not found" }, { status: 404 });
    }

    const progressRows = await prisma.progress.findMany({
      where: { studentId: student.id },
      select: { courseId: true, percentComplete: true },
    });

    const progressMap = new Map(progressRows.map((item) => [item.courseId, item.percentComplete]));
    const fullPathway = await prisma.pathway.findUnique({
      where: { id: pathway.id },
      include: {
        courses: {
          include: {
            modules: {
              include: { lessons: true },
            },
          },
        },
      },
    });

    const pathwayCourseRecords = (fullPathway?.courses || [])
      .filter((course) => course.published !== false)
      .slice()
      .sort((a, b) => a.order - b.order);

    const lecturerCourseRecords = await getStudentVisibleLecturerCourses();

    const completionRows = await prisma.completion.findMany({
      where: { studentId: student.id },
      select: { lessonId: true },
    });

    const completedLessonIds = new Set(completionRows.map((item) => item.lessonId));

    function summarizeCourseRecord(course: any) {
      const lessonCount = course.modules.reduce((acc: number, module: any) => acc + module.lessons.length, 0);
      const completedLessonCount = course.modules.reduce((acc: number, module: any) => {
        return acc + module.lessons.filter((lesson: any) => completedLessonIds.has(lesson.id)).length;
      }, 0);
      const savedProgress = progressMap.get(course.id) ?? null;
      const studentReadiness = student?.examReadiness ?? 0;
      const fallbackProgress = Math.max(12, Math.min(92, studentReadiness + course.order * 7));
      const percent = savedProgress ?? fallbackProgress;

      return {
        id: course.id,
        title: course.title,
        description: course.description,
        progress: percent,
        status: getStatus(percent),
        level: course.level,
        lessonCount,
        completedLessonCount,
      };
    }

    const courses = pathwayCourseRecords.map(summarizeCourseRecord);
    const lecturerCourses = lecturerCourseRecords.map(summarizeCourseRecord);

    return NextResponse.json({
      pathway: pathwayName,
      nextLive: student.nextLive,
      courses,
      lecturerCourses,
    });
  } catch (error) {
    console.error("Courses API fallback triggered:", error);
    return NextResponse.json({
      pathway: "Goethe exam mastery",
      nextLive: "No live session scheduled",
      courses: [
        {
          id: "fallback-1",
          title: "German A1 Foundations",
          description: "Build the core grammar, listening, and speaking habits for exam success.",
          progress: 24,
          status: "Next up",
          level: "A1",
          lessonCount: 3,
          completedLessonCount: 0,
        },
      ],
      lecturerCourses: [],
    });
  }
}
