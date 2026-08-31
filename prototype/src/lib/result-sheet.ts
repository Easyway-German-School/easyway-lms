import { prisma } from "@/lib/prisma";
import {
  letterFor,
  PASS_MARK,
  REQUIRED_ASSESSMENT_TYPES,
  weightedCourseworkAverage,
} from "@/lib/grading";
import {
  derivePaymentStatus,
  isReceivedPayment,
  requiredDepositFor,
  tuitionFeeFor,
} from "@/lib/payment";

/**
 * One student's result sheet — the printable / downloadable version of what
 * `/results` shows live.
 *
 * WHY A SHARED BUILDER. The student's own copy and the office's copy have to
 * agree to the mark, or a parent phones in with a screenshot the school cannot
 * reconcile. Both the student route and the admin route call this, and the
 * per-skill / overall figures come from `lib/grading.ts` — the exact functions
 * the tutor gradebook and the certificate use.
 *
 * The only thing that changes between the two audiences is VISIBILITY:
 *   - student: exam sittings appear only once the tutor has released them; no
 *     fee information.
 *   - admin:   every sitting is shown, unreleased ones flagged `internalOnly`;
 *     held-back status and the outstanding balance are included.
 */

export type ResultSheetAudience = "student" | "admin";

export type ResultSheetSkill = {
  type: string;
  average: number;
  grade: string;
  latest: number;
  attempts: number;
  change: number | null;
  passed: boolean;
};

export type ResultSheetExam = {
  id: string;
  examName: string;
  examDate: string;
  score: number;
  total: number;
  grade: string;
  passed: boolean;
  reading: number | null;
  listening: number | null;
  writing: number | null;
  speaking: number | null;
  /** Admin view only: the tutor has not released this sitting to the student. */
  internalOnly: boolean;
};

export type ResultSheet = {
  audience: ResultSheetAudience;
  generatedAt: string;
  student: {
    id: string;
    name: string;
    email: string;
    studentCode: string | null;
    level: string;
    branch: string | null;
    batch: string | null;
    sessionSlot: string;
    classType: string;
    classesStartedAt: string | null;
  };
  overall: number | null;
  overallGrade: string | null;
  passMark: number;
  passing: boolean | null;
  /** Required coursework skills with no mark yet — the sheet is incomplete. */
  marksOwed: number;
  skills: ResultSheetSkill[];
  exams: ResultSheetExam[];
  examsPassed: number;
  examsTaken: number;
  attendance: { held: number; present: number; percent: number } | null;
  standing: { band: string; classSize: number; classAverage: number } | null;
  /** Admin audience only. */
  office: {
    heldBackAt: string | null;
    heldBackReason: string | null;
    levelCompletedFor: string | null;
    /** Null when the viewing admin lacks the `payments` capability. */
    finance: {
      paymentStatus: "Pending" | "Partial" | "Completed";
      tuitionFee: number;
      totalPaid: number;
      outstanding: number;
    } | null;
  } | null;
};

function readBatch(admission: unknown): string | null {
  if (typeof admission !== "object" || admission === null) return null;
  const value = (admission as Record<string, unknown>).batch;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function buildResultSheet(
  studentId: string,
  {
    audience,
    includeFinance = audience === "admin",
  }: { audience: ResultSheetAudience; includeFinance?: boolean },
): Promise<ResultSheet | null> {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: {
      id: true,
      level: true,
      sessionSlot: true,
      classType: true,
      branchId: true,
      classesStartedAt: true,
      admission: true,
      heldBackAt: true,
      heldBackReason: true,
      levelCompletedFor: true,
      studentCode: true,
      user: { select: { name: true, email: true } },
      branch: { select: { name: true } },
    },
  });
  if (!student) return null;

  const grades = await prisma.grade.findMany({
    where: {
      studentId: student.id,
      OR: [{ examId: null }, ...(audience === "admin" ? [{ examId: { not: null } }] : [{ exam: { resultsReleased: true } }])],
    },
    orderBy: { createdAt: "desc" },
    include: {
      exam: {
        select: {
          id: true,
          name: true,
          examDate: true,
          totalScore: true,
          resultsReleased: true,
        },
      },
    },
  });

  const courseworkGrades = grades.filter((row) => !row.exam);
  const examGrades = grades.filter((row) => row.exam);

  // Newest mark per skill — the same rule the gradebook and /results use.
  const latestPerSkill = new Map<string, { type: string; score: number }>();
  const scoresBySkill = new Map<string, number[]>();
  for (const row of courseworkGrades) {
    if (!latestPerSkill.has(row.type)) latestPerSkill.set(row.type, { type: row.type, score: row.score });
    const list = scoresBySkill.get(row.type) ?? [];
    list.push(row.score);
    scoresBySkill.set(row.type, list);
  }

  const overall = weightedCourseworkAverage([...latestPerSkill.values()]);

  const skills: ResultSheetSkill[] = [...scoresBySkill.entries()]
    .map(([type, scores]) => {
      const average = Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length);
      const latest = latestPerSkill.get(type)?.score ?? scores[0];
      const first = scores[scores.length - 1];
      return {
        type,
        average,
        grade: letterFor(average),
        latest,
        attempts: scores.length,
        change: scores.length > 1 ? latest - first : null,
        passed: average >= PASS_MARK,
      };
    })
    .sort((a, b) => b.average - a.average);

  const marksOwed = REQUIRED_ASSESSMENT_TYPES.filter((type) => !latestPerSkill.has(type)).length;

  const exams: ResultSheetExam[] = examGrades.map((row) => ({
    id: row.id,
    examName: row.exam!.name,
    examDate: row.exam!.examDate.toISOString(),
    score: row.score,
    total: row.exam!.totalScore ?? 100,
    grade: letterFor(row.score),
    passed: row.score >= PASS_MARK,
    reading: row.readingScore,
    listening: row.listeningScore,
    writing: row.writingScore,
    speaking: row.speakingScore,
    internalOnly: audience === "admin" && !row.exam!.resultsReleased,
  }));

  const attendanceRows = await prisma.attendance.findMany({
    where: { studentId: student.id },
    select: { present: true },
  });
  const attendance = attendanceRows.length
    ? {
        held: attendanceRows.length,
        present: attendanceRows.filter((row) => row.present).length,
        percent: Math.round(
          (attendanceRows.filter((row) => row.present).length / attendanceRows.length) * 100,
        ),
      }
    : null;

  // Class band — never a rank. Same rule and thresholds as /api/student/results.
  let standing: ResultSheet["standing"] = null;
  if (overall !== null && student.branchId) {
    const classmates = await prisma.student.findMany({
      where: {
        branchId: student.branchId,
        level: student.level,
        sessionSlot: student.sessionSlot,
        status: "active",
      },
      select: {
        id: true,
        grades: {
          where: { examId: null },
          orderBy: { createdAt: "desc" },
          select: { score: true, type: true },
        },
      },
    });
    const averages = classmates
      .map((mate) => {
        const latest = new Map<string, { type: string; score: number }>();
        for (const grade of mate.grades) {
          if (!latest.has(grade.type)) latest.set(grade.type, { type: grade.type, score: grade.score });
        }
        return weightedCourseworkAverage([...latest.values()]);
      })
      .filter((value): value is number => value !== null);

    if (averages.length >= 4) {
      const below = averages.filter((value) => value < overall).length;
      const percentile = (below / averages.length) * 100;
      standing = {
        band:
          percentile >= 75
            ? "top quarter"
            : percentile >= 50
              ? "upper half"
              : percentile >= 25
                ? "lower half"
                : "bottom quarter",
        classSize: averages.length,
        classAverage: Math.round(averages.reduce((sum, value) => sum + value, 0) / averages.length),
      };
    }
  }

  let office: ResultSheet["office"] = null;
  if (audience === "admin") {
    let finance: NonNullable<ResultSheet["office"]>["finance"] = null;
    if (includeFinance) {
      const payments = await prisma.payment.findMany({
        where: { studentId: student.id },
        select: { amount: true, status: true },
      });
      const totalPaid = payments
        .filter((payment) => isReceivedPayment(payment.status))
        .reduce((sum, payment) => sum + payment.amount, 0);
      const feeLookup = {
        level: student.level,
        branch: student.branch?.name ?? null,
        classType: student.classType,
      };
      const tuitionFee = tuitionFeeFor(feeLookup);
      const money = derivePaymentStatus({
        totalPaid,
        tuitionFee,
        requiredDeposit: requiredDepositFor(feeLookup),
      });
      finance = {
        paymentStatus: money.status,
        tuitionFee,
        totalPaid,
        outstanding: Math.max(0, tuitionFee - totalPaid),
      };
    }
    office = {
      heldBackAt: student.heldBackAt?.toISOString() ?? null,
      heldBackReason: student.heldBackReason,
      levelCompletedFor: student.levelCompletedFor,
      finance,
    };
  }

  return {
    audience,
    generatedAt: new Date().toISOString(),
    student: {
      id: student.id,
      name: student.user?.name ?? "Unnamed student",
      email: student.user?.email ?? "",
      studentCode: student.studentCode,
      level: student.level,
      branch: student.branch?.name ?? null,
      batch: readBatch(student.admission),
      sessionSlot: student.sessionSlot,
      classType: student.classType,
      classesStartedAt: student.classesStartedAt?.toISOString() ?? null,
    },
    overall,
    overallGrade: overall === null ? null : letterFor(overall),
    passMark: PASS_MARK,
    passing: overall === null ? null : overall >= PASS_MARK,
    marksOwed,
    skills,
    exams,
    examsPassed: exams.filter((row) => row.passed && !row.internalOnly).length,
    examsTaken: exams.length,
    attendance,
    standing,
    office,
  };
}

/** Flat CSV of one sheet — the "Download CSV" button on both pages. */
export function resultSheetToCsv(sheet: ResultSheet): string {
  const esc = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const rows: string[][] = [
    ["Result sheet generated", sheet.generatedAt],
    ["Name", sheet.student.name],
    ["Student ID", sheet.student.studentCode ?? ""],
    ["Level", sheet.student.level],
    ["Branch", sheet.student.branch ?? ""],
    ["Batch", sheet.student.batch ?? ""],
    ["Sitting", sheet.student.sessionSlot],
    ["Overall (coursework)", sheet.overall === null ? "not marked" : `${sheet.overall} (${sheet.overallGrade})`],
    ["Pass mark", String(sheet.passMark)],
    ["Standing", sheet.standing ? `${sheet.standing.band} of ${sheet.standing.classSize}` : "n/a"],
    [
      "Attendance",
      sheet.attendance ? `${sheet.attendance.present}/${sheet.attendance.held} (${sheet.attendance.percent}%)` : "n/a",
    ],
    [],
    ["Skill", "Average", "Grade", "Latest", "Attempts", "Change", "Pass"],
    ...sheet.skills.map((skill) => [
      skill.type,
      String(skill.average),
      skill.grade,
      String(skill.latest),
      String(skill.attempts),
      skill.change === null ? "" : (skill.change > 0 ? `+${skill.change}` : String(skill.change)),
      skill.passed ? "yes" : "no",
    ]),
    [],
    ["Exam sitting", "Date", "Score", "Total", "Grade", "Pass", "Reading", "Listening", "Writing", "Speaking", "Note"],
    ...sheet.exams.map((exam) => [
      exam.examName,
      exam.examDate.slice(0, 10),
      String(exam.score),
      String(exam.total),
      exam.grade,
      exam.passed ? "yes" : "no",
      exam.reading === null ? "" : String(exam.reading),
      exam.listening === null ? "" : String(exam.listening),
      exam.writing === null ? "" : String(exam.writing),
      exam.speaking === null ? "" : String(exam.speaking),
      exam.internalOnly ? "not released to student" : "",
    ]),
  ];
  if (sheet.office) {
    rows.push(
      [],
      ["Office notes (not shown to student)"],
      ["Held back", sheet.office.heldBackAt ? `yes — ${sheet.office.heldBackReason ?? "no reason given"}` : "no"],
      ["Level signed off", sheet.office.levelCompletedFor ?? "no"],
    );
    if (sheet.office.finance) {
      rows.push(
        ["Fees", `${sheet.office.finance.paymentStatus} — paid ${sheet.office.finance.totalPaid} of ${sheet.office.finance.tuitionFee}`],
        ["Outstanding", String(sheet.office.finance.outstanding)],
      );
    }
  }
  return rows.map((row) => row.map(esc).join(",")).join("\n");
}
