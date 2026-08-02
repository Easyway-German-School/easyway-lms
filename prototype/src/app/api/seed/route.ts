import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcryptjs from "bcryptjs";

const courseStructure: Record<string, Array<{
  title: string;
  description: string;
  modules: Array<{
    title: string;
    lessons: Array<{ title: string; type: string; content: string; duration: number }>
  }>
}>> = {
  "Language training": [
    {
      title: "German A1 Foundations",
      description: "Build the core grammar, listening, and speaking habits for exam success.",
      modules: [
        {
          title: "Module 1: Basic Greetings & Self-Introduction",
          lessons: [
            { title: "Lesson 1: German Greetings", type: "lesson", content: "Learn essential greetings like Guten Tag, Hallo, and Auf Wiedersehen. Practice pronunciation and when to use formal vs informal.", duration: 15 },
            { title: "Lesson 2: Introducing Yourself", type: "lesson", content: "Master the phrase 'Ich heiße...' and simple biographical sentences. Practice with native speaker audio.", duration: 20 },
            { title: "Quiz 1: Greetings & Self-Introduction", type: "quiz", content: "Test your knowledge of greetings and self-introduction phrases.", duration: 10 },
          ]
        },
        {
          title: "Module 2: Basic Vocabulary",
          lessons: [
            { title: "Lesson 3: Numbers 0-20", type: "lesson", content: "Learn German numbers with pronunciation drills and practical applications.", duration: 15 },
            { title: "Lesson 4: Days and Months", type: "lesson", content: "Master German calendar vocabulary including days of the week and months.", duration: 15 },
            { title: "Assignment 1: Create a personal introduction", type: "assignment", content: "Record a 30-second introduction in German using the structures learned.", duration: 25 },
          ]
        }
      ]
    },
    {
      title: "German Essay Prep",
      description: "Structure paragraphs, improve linking phrases, and write clearer exam essays.",
      modules: [
        {
          title: "Module 1: Essay Structure",
          lessons: [
            { title: "Lesson 1: Essay Planning Framework", type: "lesson", content: "Learn the Goethe exam essay structure: introduction, body, conclusion. Review sample essays.", duration: 20 },
            { title: "Lesson 2: Linking Phrases", type: "lesson", content: "Master German transition words: Erstens, Außerdem, Schließlich, Daher.", duration: 15 },
            { title: "Assignment 1: Write a sample essay", type: "assignment", content: "Write a 250-word essay on a Goethe exam topic.", duration: 45 },
          ]
        }
      ]
    },
    {
      title: "Live Speaking Lab",
      description: "Practice fluency with guided conversation drills and pronunciation coaching.",
      modules: [
        {
          title: "Module 1: Real-World Conversations",
          lessons: [
            { title: "Lesson 1: At the Coffee Shop", type: "lesson", content: "Practice ordering drinks and making small talk. Learn common phrases.", duration: 20 },
            { title: "Lesson 2: At the Train Station", type: "lesson", content: "Master ticket purchase dialogues and asking for directions.", duration: 20 },
            { title: "Speaking Practice 1: Roleplay exercise", type: "assignment", content: "Record yourself in a simulated conversation with an AI tutor.", duration: 30 },
          ]
        }
      ]
    }
  ],
  "Nursing career path": [
    {
      title: "Medical German Basics",
      description: "Learn practical vocabulary for patient interaction and clinical settings.",
      modules: [
        {
          title: "Module 1: Patient Communication",
          lessons: [
            { title: "Lesson 1: Symptoms and Pain", type: "lesson", content: "Learn how to ask about and describe symptoms. Important health vocabulary.", duration: 20 },
            { title: "Lesson 2: Medical Instructions", type: "lesson", content: "Master phrases for giving patient care instructions in German.", duration: 20 },
            { title: "Quiz 1: Medical Vocabulary", type: "quiz", content: "Test your knowledge of health and symptom vocabulary.", duration: 15 },
          ]
        }
      ]
    }
  ]
};

export async function GET() {
  try {
    let seeded = 0;

    const demoAdminEmail = "admin@easyway.test";
    const demoAdminPassword = "AdminPass123!";
    const hashedAdmin = await bcryptjs.hash(demoAdminPassword, 10);
    const adminUser = await prisma.user.upsert({
      where: { email: demoAdminEmail },
      update: { name: "Demo Admin", password: hashedAdmin, role: "ADMIN" },
      create: {
        email: demoAdminEmail,
        name: "Demo Admin",
        password: hashedAdmin,
        role: "ADMIN",
      },
    });
    if (!adminUser) {
      seeded++;
    }

    const demoStudentEmail = "student@easyway.test";
    const demoStudentPassword = "StudentPass123!";
    const hashedStudent = await bcryptjs.hash(demoStudentPassword, 10);
    const studentUser = await prisma.user.upsert({
      where: { email: demoStudentEmail },
      update: { name: "Demo Student", password: hashedStudent, role: "STUDENT" },
      create: {
        email: demoStudentEmail,
        name: "Demo Student",
        password: hashedStudent,
        role: "STUDENT",
      },
    });

    const studentProfile = await prisma.student.upsert({
      where: { userId: studentUser.id },
      update: {
        level: "A1",
        pathway: "Language training",
        examReadiness: 0,
        admission: {
          batch: "August",
          branch: "Lagos",
          level: "A1",
        },
      },
      create: {
        userId: studentUser.id,
        level: "A1",
        pathway: "Language training",
        examReadiness: 0,
        admission: {
          batch: "August",
          branch: "Lagos",
          level: "A1",
        },
      },
    });

    const existingCompletedPayment = await prisma.payment.findFirst({
      where: {
        studentId: studentProfile.id,
        status: "completed",
        amount: 150000,
      },
    });

    if (!existingCompletedPayment) {
      await prisma.payment.create({
        data: {
          studentId: studentProfile.id,
          amount: 150000,
          currency: "usd",
          status: "completed",
          method: "seed",
          description: "Seeded tuition payment for demo student access",
        },
      });
      seeded++;
    }

    const demoLecturerEmail = "lecturer@easyway.test";
    const demoLecturerPassword = "LecturerPass123!";
    const hashedLecturer = await bcryptjs.hash(demoLecturerPassword, 10);
    const lecturerUser = await prisma.user.upsert({
      where: { email: demoLecturerEmail },
      update: { name: "Demo Lecturer", password: hashedLecturer, role: "LECTURER" },
      create: {
        email: demoLecturerEmail,
        name: "Demo Lecturer",
        password: hashedLecturer,
        role: "LECTURER",
      },
    });

    await prisma.lecturer.upsert({
      where: { userId: lecturerUser.id },
      update: {
        specialization: "German language and exam preparation",
        bio: "Demo lecturer account for testing the lecturer portal.",
        phone: "+234 800 000 0000",
      },
      create: {
        userId: lecturerUser.id,
        specialization: "German language and exam preparation",
        bio: "Demo lecturer account for testing the lecturer portal.",
        phone: "+234 800 000 0000",
      },
    });

    for (const [pathwayName, coursesData] of Object.entries(courseStructure)) {
      const pathway = await prisma.pathway.findUnique({
        where: { name: pathwayName }
      });

      if (!pathway) continue;

      for (let courseIdx = 0; courseIdx < coursesData.length; courseIdx++) {
        const courseData = coursesData[courseIdx];
        
        const course = await prisma.course.upsert({
          where: { id: `${pathwayName}_${courseIdx}`.replace(/\s+/g, "_").toLowerCase() },
          update: {},
          create: {
            pathwayId: pathway.id,
            title: courseData.title,
            description: courseData.description,
            order: courseIdx + 1,
            duration: courseData.modules.reduce((acc, m) => acc + m.lessons.reduce((la, l) => la + l.duration, 0), 0),
            level: "A1"
          }
        });

        for (let moduleIdx = 0; moduleIdx < courseData.modules.length; moduleIdx++) {
          const moduleData = courseData.modules[moduleIdx];

          const module = await prisma.module.create({
            data: {
              courseId: course.id,
              title: moduleData.title,
              description: `Module ${moduleIdx + 1}`,
              order: moduleIdx + 1
            }
          });

          for (let lessonIdx = 0; lessonIdx < moduleData.lessons.length; lessonIdx++) {
            const lessonData = moduleData.lessons[lessonIdx];

            await prisma.lesson.create({
              data: {
                moduleId: module.id,
                title: lessonData.title,
                description: lessonData.title,
                content: lessonData.content,
                type: lessonData.type,
                order: lessonIdx + 1,
                duration: lessonData.duration
              }
            });
            seeded++;
          }
        }
      }
    }

    return NextResponse.json({ status: "ok", seeded }, { status: 200 });
  } catch (error) {
    console.error("Seed error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
