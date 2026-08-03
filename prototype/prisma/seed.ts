import { prisma } from "@/lib/prisma";

const courseStructure: Record<string, Array<{
  title: string;
  description: string;
  modules: Array<{
    title: string;
    lessons: Array<{ title: string; type: string; content: string; duration: number }>
  }>
}>> = {
  "Goethe exam mastery": [
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
      title: "Goethe Essay Prep",
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
  ],
  "IT relocation track": [
    {
      title: "Tech German Essentials",
      description: "Build confidence with workplace vocabulary and common relocation topics.",
      modules: [
        {
          title: "Module 1: Professional Communication",
          lessons: [
            { title: "Lesson 1: Office Environment", type: "lesson", content: "Learn workplace vocabulary and common office phrases.", duration: 15 },
            { title: "Lesson 2: Technical Terms", type: "lesson", content: "Master German translations of common tech terms and tools.", duration: 20 },
            { title: "Assignment 1: Write a professional email", type: "assignment", content: "Draft a professional email in German to a potential employer.", duration: 30 },
          ]
        }
      ]
    }
  ],
  "Ausbildung & Vocational Route": [
    {
      title: "Apprenticeship German",
      description: "Prepare for workplace instructions, interviews, and practical training.",
      modules: [
        {
          title: "Module 1: Workplace Readiness",
          lessons: [
            { title: "Lesson 1: Basic Work Instructions", type: "lesson", content: "Learn German commands and instructions used in apprenticeships.", duration: 20 },
            { title: "Lesson 2: Safety Terms", type: "lesson", content: "Master important safety and workplace vocabulary.", duration: 15 },
            { title: "Assignment 1: Safety checklist", type: "assignment", content: "Create a personal safety checklist using German vocabulary.", duration: 25 },
          ]
        }
      ]
    }
  ]
};

export async function seedCourses() {
  console.log("🌱 Seeding courses with modules and lessons...");

  for (const [pathwayName, coursesData] of Object.entries(courseStructure)) {
    const pathway = await prisma.pathway.findUnique({
      where: { name: pathwayName }
    });

    if (!pathway) {
      console.log(`⚠️  Pathway ${pathwayName} not found, skipping...`);
      continue;
    }

    for (let courseIdx = 0; courseIdx < coursesData.length; courseIdx++) {
      const courseData = coursesData[courseIdx];
      
      const course = await prisma.course.upsert({
        where: {
          id: `course_${pathwayName}_${courseIdx}`.replace(/\s+/g, "_").toLowerCase()
        },
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

      console.log(`  ✓ Course: ${courseData.title}`);

      for (let moduleIdx = 0; moduleIdx < courseData.modules.length; moduleIdx++) {
        const moduleData = courseData.modules[moduleIdx];

        const created = await prisma.module.create({
          data: {
            courseId: course.id,
            title: moduleData.title,
            description: `Module ${moduleIdx + 1}`,
            order: moduleIdx + 1
          }
        });

        console.log(`    ✓ Module: ${moduleData.title}`);

        for (let lessonIdx = 0; lessonIdx < moduleData.lessons.length; lessonIdx++) {
          const lessonData = moduleData.lessons[lessonIdx];

          await prisma.lesson.create({
            data: {
              moduleId: created.id,
              title: lessonData.title,
              description: lessonData.title,
              content: lessonData.content,
              type: lessonData.type,
              order: lessonIdx + 1,
              duration: lessonData.duration
            }
          });

          console.log(`      ✓ Lesson: ${lessonData.title}`);
        }
      }
    }
  }

  console.log("✅ Seeding complete!");
}
