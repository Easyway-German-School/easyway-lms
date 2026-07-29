/**
 * Populates the operational layer of the LMS: course materials, exams,
 * registrations, grades, attendance, lesson progress and announcements.
 *
 * Community content is seeded separately by scripts/seed-community-spaces.mjs.
 *
 * SAFETY: this script is strictly additive and idempotent. It never deletes or
 * overwrites existing rows — every section is guarded by an existence check or
 * an upsert, so re-running it will not duplicate data or disturb real records.
 *
 *   node scripts/seed-demo-data.mjs
 */
import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";

const prisma = new PrismaClient();
const MATERIALS_DIR = path.join(process.cwd(), "public", "uploads", "materials");
const summary = [];
const log = (s, n, note = "") => summary.push({ s, n, note });

/** Build a genuinely valid one-page PDF so downloads actually open. */
function buildPdf(title, subtitle) {
  const esc = (t) => String(t).replace(/([()\\])/g, "\\$1");
  const content =
    `BT /F1 20 Tf 60 780 Td (${esc(title)}) Tj ET\n` +
    `BT /F1 12 Tf 60 750 Td (${esc(subtitle)}) Tj ET\n` +
    `BT /F1 11 Tf 60 715 Td (Easyway German Language School) Tj ET\n` +
    `BT /F1 10 Tf 60 690 Td (This is course material provided for your level.) Tj ET`;
  const objs = [
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Kids[3 0 R]/Count 1>>",
    "<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>",
    `<</Length ${content.length}>>\nstream\n${content}\nendstream`,
    "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((o) => (pdf += `${String(o).padStart(10, "0")} 00000 n \n`));
  pdf += `trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

const MATERIALS_BY_LEVEL = {
  A1: [
    ["Begrüßung und Vorstellung", "Greetings, introductions and the verb 'sein'", "pdf"],
    ["Artikel: der, die, das", "Definite articles and noun gender patterns", "pdf"],
    ["Zahlen und Uhrzeit", "Numbers, telling the time and making appointments", "pdf"],
    ["Hörübung: Im Café", "Listening practice — ordering food and drink", "video"],
  ],
  A2: [
    ["Perfekt und Präteritum", "Talking about the past in everyday conversation", "pdf"],
    ["Trennbare Verben", "Separable verbs and word order in main clauses", "pdf"],
    ["Wohnen und Alltag", "Housing vocabulary and describing your routine", "pdf"],
    ["Hörübung: Beim Arzt", "Listening practice — a visit to the doctor", "video"],
  ],
  B1: [
    ["Konjunktiv II", "Polite requests, wishes and hypothetical situations", "pdf"],
    ["Nebensätze mit weil, dass, wenn", "Subordinate clauses and verb-final word order", "pdf"],
    ["Bewerbung und Lebenslauf", "Writing a German CV and application letter", "pdf"],
    ["Sprechen: Meinung äußern", "Speaking practice — expressing and defending an opinion", "video"],
  ],
  B2: [
    ["Passiv in allen Zeitformen", "The passive voice across tenses", "pdf"],
    ["Konnektoren und Textaufbau", "Connectors and structuring a written argument", "pdf"],
    ["Arbeitswelt und Fachsprache", "Workplace German and professional register", "pdf"],
    ["Schreiben: Erörterung", "Writing practice — structured essay for the exam", "pdf"],
  ],
  C1: [
    ["Nominalisierung und Stil", "Nominal style and formal register", "pdf"],
    ["Wissenschaftliches Schreiben", "Academic writing conventions", "pdf"],
    ["Redewendungen und Idiomatik", "Idiomatic expressions for advanced speakers", "pdf"],
  ],
  C2: [
    ["Textanalyse und Interpretation", "Analysing literary and journalistic texts", "pdf"],
    ["Debatte und Rhetorik", "Rhetorical devices and structured debate", "pdf"],
  ],
};

async function seedMaterials() {
  const existing = await prisma.material.count();
  if (existing > 0) return log("Materials", 0, `skipped — ${existing} already present`);

  fs.mkdirSync(MATERIALS_DIR, { recursive: true });
  const courses = await prisma.course.findMany({ orderBy: { createdAt: "asc" } });
  const lecturers = await prisma.lecturer.findMany();
  let made = 0;

  for (const [level, items] of Object.entries(MATERIALS_BY_LEVEL)) {
    const levelCourses = courses.filter((c) => c.level === level);
    if (levelCourses.length === 0) continue;

    for (let i = 0; i < items.length; i++) {
      const [title, description, fileType] = items[i];
      const course = levelCourses[i % levelCourses.length];
      const lecturer = lecturers[i % Math.max(lecturers.length, 1)] ?? null;
      const slug = `${level.toLowerCase()}-${title.toLowerCase().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "")}`;
      const fileName = `${slug}.${fileType === "video" ? "pdf" : fileType}`;
      const abs = path.join(MATERIALS_DIR, fileName);
      const buf = buildPdf(title, description);
      fs.writeFileSync(abs, buf);

      await prisma.material.create({
        data: {
          courseId: course.id,
          lecturerId: lecturer?.id ?? null,
          title,
          description,
          filePath: `/uploads/materials/${fileName}`,
          fileName,
          fileType,
          fileSize: buf.length,
        },
      });
      made++;
    }
  }
  log("Materials", made, "with real downloadable PDFs");
}

const EXAMS = [
  ["Goethe-Zertifikat A1: Start Deutsch 1", "A1", -35],
  ["Goethe-Zertifikat A2", "A2", -14],
  ["telc Deutsch B1", "B1", 12],
  ["Goethe-Zertifikat B2", "B2", 26],
  ["ÖSD Zertifikat C1", "C1", 45],
];

async function seedExamsAndGrades() {
  if ((await prisma.exam.count()) > 0) return log("Exams", 0, "skipped — already present");

  const courses = await prisma.course.findMany();
  const lecturers = await prisma.lecturer.findMany();
  if (!lecturers.length) return log("Exams", 0, "skipped — no lecturers");

  const students = await prisma.student.findMany({ include: { user: true } });
  let exams = 0, regs = 0, grades = 0;

  for (let i = 0; i < EXAMS.length; i++) {
    const [name, level, dayOffset] = EXAMS[i];
    const course = courses.find((c) => c.level === level) ?? courses[0];
    if (!course) continue;
    const examDate = new Date(Date.now() + dayOffset * 86400000);

    const exam = await prisma.exam.create({
      data: {
        courseId: course.id,
        lecturerId: lecturers[i % lecturers.length].id,
        name,
        description: `Official ${level} examination covering reading, listening, writing and speaking.`,
        examDate,
        totalScore: 100,
      },
    });
    exams++;

    const cohort = students.filter((s) => s.level === level);
    const isPast = dayOffset < 0;

    for (const student of cohort) {
      await prisma.examRegistration.create({
        data: {
          studentId: student.id,
          examId: exam.id,
          examName: name,
          examDate,
          status: isPast ? "completed" : "registered",
          notes: isPast ? "Result released." : "Seat confirmed.",
        },
      });
      regs++;

      if (isPast) {
        const score = 62 + Math.floor(Math.random() * 34);
        const letter = score >= 90 ? "A" : score >= 80 ? "B" : score >= 70 ? "C" : score >= 60 ? "D" : "F";
        await prisma.grade.create({
          data: {
            studentId: student.id,
            examId: exam.id,
            type: "exam",
            score,
            grade: letter,
            feedback:
              score >= 80
                ? "Strong performance. Listening and reading were excellent; keep refining written accuracy."
                : "Solid pass. Focus on sentence structure and expanding active vocabulary before the next level.",
          },
        });
        grades++;
      }
    }
  }
  log("Exams", exams);
  log("Exam registrations", regs);
  log("Grades", grades);
}

async function seedAttendance() {
  if ((await prisma.attendance.count()) > 0) return log("Attendance", 0, "skipped — already present");

  const classes = await prisma.class.findMany();
  const students = await prisma.student.findMany();
  if (!classes.length || !students.length) return log("Attendance", 0, "skipped — no classes/students");

  let made = 0;
  // Last 5 weeks, Mon/Wed/Fri. The model is unique on (studentId, date), so
  // each student gets at most one record per calendar day.
  const days = [];
  for (let back = 35; back >= 1; back--) {
    const d = new Date();
    d.setHours(9, 0, 0, 0);
    d.setDate(d.getDate() - back);
    if ([1, 3, 5].includes(d.getDay())) days.push(d);
  }

  for (const student of students) {
    const cls = classes[students.indexOf(student) % classes.length];
    for (const date of days) {
      const roll = Math.random();
      const status = roll < 0.82 ? "present" : roll < 0.9 ? "late" : roll < 0.97 ? "absent" : "excused";
      await prisma.attendance.upsert({
        where: { studentId_date: { studentId: student.id, date } },
        update: {},
        create: {
          studentId: student.id,
          classId: cls.id,
          date,
          present: status === "present" || status === "late",
          status,
          notes: status === "excused" ? "Excused — medical appointment." : null,
        },
      });
      made++;
    }
  }
  log("Attendance records", made, "5 weeks, Mon/Wed/Fri");
}

async function seedProgress() {
  if ((await prisma.completion.count()) > 0) return log("Progress", 0, "skipped — already present");

  const students = await prisma.student.findMany();
  let progress = 0, completions = 0;

  for (const student of students) {
    const courses = await prisma.course.findMany({
      where: { level: student.level },
      include: { modules: { include: { lessons: true } } },
      take: 3,
    });

    for (const course of courses) {
      const lessons = course.modules.flatMap((m) => m.lessons);
      if (!lessons.length) continue;

      const doneCount = Math.max(1, Math.floor(lessons.length * (0.3 + Math.random() * 0.5)));
      for (const lesson of lessons.slice(0, doneCount)) {
        await prisma.completion.upsert({
          where: { studentId_lessonId: { studentId: student.id, lessonId: lesson.id } },
          update: {},
          create: {
            studentId: student.id,
            lessonId: lesson.id,
            status: "completed",
            score: 70 + Math.floor(Math.random() * 30),
            completedAt: new Date(Date.now() - Math.floor(Math.random() * 20) * 86400000),
          },
        });
        completions++;
      }

      await prisma.progress.upsert({
        where: { studentId_courseId: { studentId: student.id, courseId: course.id } },
        update: {},
        create: {
          studentId: student.id,
          courseId: course.id,
          percentComplete: Math.round((doneCount / lessons.length) * 100),
        },
      });
      progress++;
    }
  }
  log("Lesson completions", completions);
  log("Course progress rows", progress);
}

const ANNOUNCEMENTS = [
  ["New B1 speaking lab every Thursday", "Live conversation labs now run Thursdays at 18:00 at all branches. Places are limited to twelve learners per session.", "in_app"],
  ["Goethe B2 registration closes soon", "Registration for the next Goethe B2 sitting closes at the end of this month. Speak to your branch coordinator to reserve a seat.", "in_app"],
  ["Library expanded for A2 and B1", "Fresh grammar and listening material has been added to your course library. Check the Materials page for the latest uploads.", "in_app"],
];

async function seedNotifications() {
  const students = await prisma.student.findMany({ take: 12 });
  let made = 0;
  for (const [title, message, channel] of ANNOUNCEMENTS) {
    for (const student of students) {
      const exists = await prisma.notification.findFirst({ where: { studentId: student.id, title } });
      if (exists) continue;
      await prisma.notification.create({
        data: { studentId: student.id, title, message, channel, status: "sent", sentAt: new Date() },
      });
      made++;
    }
  }
  log("Notifications", made);
}

async function main() {
  console.log("Seeding operational data (additive, idempotent)...\n");
  await seedMaterials();
  await seedExamsAndGrades();
  await seedAttendance();
  // Community seeding moved to scripts/seed-community-spaces.mjs when the
  // course-based Discussion model was retired for branch+level Spaces.
  await seedProgress();
  await seedNotifications();

  console.log("Section                     Created");
  console.log("-----------------------------------");
  for (const { s, n, note } of summary) {
    console.log(`${s.padEnd(26)} ${String(n).padStart(6)}${note ? "   (" + note + ")" : ""}`);
  }
  console.log("\nDone. Re-running this script will not duplicate anything.");
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
