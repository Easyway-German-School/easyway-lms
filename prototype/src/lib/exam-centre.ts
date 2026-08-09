import { prisma } from "@/lib/prisma";

/**
 * The ÖSD exam centre.
 *
 * The school sits members of the public, not only its own students, so a
 * registration may have no Student behind it. Everything here is written to
 * work for both an enrolled student and a walk-in candidate.
 *
 * Seats are the part that has to be right: overselling an exam sitting means
 * turning someone away on the day after taking their money.
 */

export const EXAM_BODIES = ["ÖSD", "telc", "internal"] as const;

/** A seat is held by any registration that has not been cancelled. */
const HOLDING_STATUSES = ["registered", "confirmed", "completed"];

export type SeatState = {
  capacity: number | null;
  taken: number;
  remaining: number | null;
  full: boolean;
  deadlinePassed: boolean;
  open: boolean;
};

export async function seatState(examId: string, now = new Date()): Promise<SeatState | null> {
  const exam = await prisma.exam.findUnique({
    where: { id: examId },
    select: { capacity: true, registrationDeadline: true, published: true, examDate: true },
  });
  if (!exam) return null;

  const taken = await prisma.examRegistration.count({
    where: { examId, status: { in: HOLDING_STATUSES } },
  });

  const remaining = exam.capacity === null ? null : Math.max(0, exam.capacity - taken);
  const full = exam.capacity !== null && taken >= exam.capacity;
  const deadlinePassed = Boolean(exam.registrationDeadline && now > exam.registrationDeadline);

  return {
    capacity: exam.capacity,
    taken,
    remaining,
    full,
    deadlinePassed,
    open: exam.published && !full && !deadlinePassed && exam.examDate > now,
  };
}

export type RegisterInput = {
  examId: string;
  studentId?: string | null;
  /** Account that owns the booking — set for students and candidates alike. */
  userId?: string | null;
  candidateName?: string | null;
  candidateEmail?: string | null;
  candidatePhone?: string | null;
  notes?: string | null;
};

export type RegisterResult =
  | { ok: true; registrationId: string; fee: number | null; seatNumber: string }
  | { ok: false; error: string; code: "not_found" | "closed" | "full" | "duplicate" | "invalid" };

/**
 * Book a seat.
 *
 * The capacity check and the insert run inside one transaction and the count
 * is re-read inside it. Checking first and inserting after leaves a window
 * where two candidates both see the last seat and both get it.
 */
export async function registerForExam(input: RegisterInput, now = new Date()): Promise<RegisterResult> {
  const exam = await prisma.exam.findUnique({ where: { id: input.examId } });
  if (!exam || !exam.published) {
    return { ok: false, error: "That exam sitting is not available.", code: "not_found" };
  }

  if (!input.studentId && !(input.candidateName && input.candidateEmail)) {
    return { ok: false, error: "A name and email are required to register.", code: "invalid" };
  }

  if (exam.registrationDeadline && now > exam.registrationDeadline) {
    return { ok: false, error: "Registration for this sitting has closed.", code: "closed" };
  }
  if (exam.examDate <= now) {
    return { ok: false, error: "That sitting has already taken place.", code: "closed" };
  }

  try {
    return await prisma.$transaction(async (tx) => {
      // Same person, same sitting — twice.
      const existing = await tx.examRegistration.findFirst({
        where: {
          examId: exam.id,
          status: { in: HOLDING_STATUSES },
          ...(input.studentId
            ? { studentId: input.studentId }
            : { candidateEmail: input.candidateEmail!.toLowerCase() }),
        },
        select: { id: true },
      });
      if (existing) {
        return { ok: false as const, error: "You are already registered for this sitting.", code: "duplicate" as const };
      }

      const taken = await tx.examRegistration.count({
        where: { examId: exam.id, status: { in: HOLDING_STATUSES } },
      });
      if (exam.capacity !== null && taken >= exam.capacity) {
        return { ok: false as const, error: "This sitting is full.", code: "full" as const };
      }

      const seatNumber = `${(exam.level ?? "EX").toUpperCase()}-${String(taken + 1).padStart(3, "0")}`;

      const registration = await tx.examRegistration.create({
        data: {
          examId: exam.id,
          studentId: input.studentId ?? null,
          userId: input.userId ?? null,
          candidateName: input.candidateName ?? null,
          candidateEmail: input.candidateEmail?.toLowerCase() ?? null,
          candidatePhone: input.candidatePhone ?? null,
          examName: exam.name,
          examDate: exam.examDate,
          status: "registered",
          // No fee means nothing to collect, so the seat is confirmed outright.
          paymentStatus: exam.fee ? "unpaid" : "waived",
          seatNumber,
          notes: input.notes ?? null,
        },
      });

      return { ok: true as const, registrationId: registration.id, fee: exam.fee, seatNumber };
    });
  } catch (error) {
    console.error("Exam registration failed:", error);
    return { ok: false, error: "Could not complete that registration.", code: "invalid" };
  }
}

/** Sittings a candidate can still book, with live seat counts. */
export async function listOpenExams(opts?: { level?: string | null; branchId?: string | null }) {
  const now = new Date();

  const exams = await prisma.exam.findMany({
    where: {
      published: true,
      examDate: { gt: now },
      ...(opts?.level ? { level: opts.level } : {}),
      ...(opts?.branchId ? { OR: [{ branchId: opts.branchId }, { branchId: null }] } : {}),
    },
    orderBy: { examDate: "asc" },
    include: {
      branch: { select: { id: true, name: true } },
      _count: { select: { registrations: true } },
    },
  });

  // Count only seat-holding registrations; a cancellation frees its seat.
  const held = await prisma.examRegistration.groupBy({
    by: ["examId"],
    where: { examId: { in: exams.map((e) => e.id) }, status: { in: HOLDING_STATUSES } },
    _count: { examId: true },
  });
  const heldBy = new Map(held.map((h) => [h.examId, h._count.examId]));

  return exams.map((exam) => {
    const taken = heldBy.get(exam.id) ?? 0;
    const remaining = exam.capacity === null ? null : Math.max(0, exam.capacity - taken);
    return {
      id: exam.id,
      name: exam.name,
      description: exam.description,
      examBody: exam.examBody,
      level: exam.level,
      examDate: exam.examDate,
      registrationDeadline: exam.registrationDeadline,
      fee: exam.fee,
      branch: exam.branch,
      capacity: exam.capacity,
      taken,
      remaining,
      full: exam.capacity !== null && taken >= exam.capacity,
      deadlinePassed: Boolean(exam.registrationDeadline && now > exam.registrationDeadline),
    };
  });
}
