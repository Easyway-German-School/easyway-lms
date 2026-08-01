import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveAdmin } from "@/lib/admin-roles";
import { ollamaChat, ollamaStatus, type ChatMessage } from "@/lib/ollama";
import { derivePaymentStatus, requiredDepositFor, tuitionFeeFor } from "@/lib/payment";

export const dynamic = "force-dynamic";

/**
 * The admin assistant.
 *
 * The important decision here is that the MODEL NEVER COUNTS ANYTHING. Every
 * figure it is allowed to say is computed by the queries below and handed to
 * it as a briefing; it is asked to read and explain, not to work out. A local
 * 8B model asked "how many students owe money" will produce a confident number
 * out of nothing, and a fee chased from a hallucinated figure is worse than no
 * assistant at all.
 *
 * The briefing is also returned on its own by GET, so the page is useful when
 * Ollama is not running — which, on a fresh clone, it will not be.
 *
 * Only what the admin may see is gathered. A Secretary has no `payments`
 * capability, so the money section is absent from their briefing entirely and
 * the model cannot leak what was never put in front of it.
 */

type Briefing = {
  generatedAt: string;
  students?: {
    total: number;
    active: number;
    byLevel: Record<string, number>;
    byBranch: Record<string, number>;
    newThisWeek: number;
    newThisMonth: number;
  };
  money?: {
    currency: "NGN";
    collectedAllTime: number;
    collectedThisMonth: number;
    outstandingTotal: number;
    studentsOwing: number;
    fullyPaid: number;
    biggestBalances: Array<{ name: string; level: string; branch: string | null; owed: number }>;
  };
  enquiries?: { open: number; newThisWeek: number };
  exams?: { upcoming: number; registrationsUnpaid: number };
  attendance?: { sessionsLast7Days: number; averagePresentPercent: number | null };
};

const DAY = 86_400_000;

async function buildBriefing(can: (c: never) => boolean): Promise<Briefing> {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * DAY);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const briefing: Briefing = { generatedAt: now.toISOString() };

  if (can("students" as never)) {
    const students = await prisma.student.findMany({
      select: {
        status: true,
        level: true,
        createdAt: true,
        branch: { select: { name: true } },
      },
    });

    const byLevel: Record<string, number> = {};
    const byBranch: Record<string, number> = {};
    for (const student of students) {
      byLevel[student.level] = (byLevel[student.level] ?? 0) + 1;
      const branch = student.branch?.name ?? "No branch";
      byBranch[branch] = (byBranch[branch] ?? 0) + 1;
    }

    briefing.students = {
      total: students.length,
      active: students.filter((s) => s.status === "active").length,
      byLevel,
      byBranch,
      newThisWeek: students.filter((s) => s.createdAt >= weekAgo).length,
      newThisMonth: students.filter((s) => s.createdAt >= monthStart).length,
    };
  }

  if (can("payments" as never)) {
    const students = await prisma.student.findMany({
      where: { status: "active" },
      select: {
        level: true,
        classType: true,
        branch: { select: { name: true } },
        user: { select: { name: true, email: true } },
        payments: { where: { status: "completed" }, select: { amount: true, createdAt: true } },
      },
    });

    let collectedAllTime = 0;
    let collectedThisMonth = 0;
    let outstandingTotal = 0;
    let studentsOwing = 0;
    let fullyPaid = 0;
    const balances: Array<{ name: string; level: string; branch: string | null; owed: number }> = [];

    for (const student of students) {
      const lookup = { level: student.level, branch: student.branch?.name ?? null, classType: student.classType };
      const tuitionFee = tuitionFeeFor(lookup);
      const totalPaid = student.payments.reduce((sum, p) => sum + p.amount, 0);

      collectedAllTime += totalPaid;
      collectedThisMonth += student.payments
        .filter((p) => p.createdAt >= monthStart)
        .reduce((sum, p) => sum + p.amount, 0);

      const { fullPaid } = derivePaymentStatus({
        totalPaid,
        tuitionFee,
        requiredDeposit: requiredDepositFor(lookup),
      });

      if (fullPaid) {
        fullyPaid += 1;
      } else {
        const owed = Math.max(0, tuitionFee - totalPaid);
        outstandingTotal += owed;
        studentsOwing += 1;
        if (owed > 0) {
          balances.push({
            name: student.user.name ?? student.user.email,
            level: student.level,
            branch: student.branch?.name ?? null,
            owed,
          });
        }
      }
    }

    briefing.money = {
      currency: "NGN",
      collectedAllTime,
      collectedThisMonth,
      outstandingTotal,
      studentsOwing,
      fullyPaid,
      biggestBalances: balances.sort((a, b) => b.owed - a.owed).slice(0, 8),
    };
  }

  if (can("students" as never)) {
    const [open, newThisWeek] = await Promise.all([
      prisma.lead.count({ where: { status: { notIn: ["converted", "lost"] } } }),
      prisma.lead.count({ where: { createdAt: { gte: weekAgo } } }),
    ]);
    briefing.enquiries = { open, newThisWeek };
  }

  if (can("exams" as never)) {
    const [upcoming, registrationsUnpaid] = await Promise.all([
      prisma.exam.count({ where: { examDate: { gte: now } } }),
      prisma.examRegistration.count({ where: { paymentStatus: "unpaid", examDate: { gte: now } } }),
    ]);
    briefing.exams = { upcoming, registrationsUnpaid };
  }

  if (can("attendance" as never)) {
    const recent = await prisma.attendance.findMany({
      where: { date: { gte: weekAgo } },
      select: { status: true },
    });
    const present = recent.filter((a) => a.status === "present").length;
    briefing.attendance = {
      sessionsLast7Days: recent.length,
      averagePresentPercent: recent.length > 0 ? Math.round((present / recent.length) * 100) : null,
    };
  }

  return briefing;
}

const SYSTEM_PROMPT = `You are the assistant for the office of Easyway German Language School in Nigeria.

You are given a BRIEFING containing the school's real, current figures.

Rules, in order of importance:
1. Every number you state must come from the briefing. If a figure is not
   there, say plainly that you do not have it and name the page in the admin
   portal where it can be found. Never estimate, never extrapolate.
2. If the briefing has no section for what was asked, say so — it means the
   person asking does not have access to that area.
3. Money is Nigerian naira. Write it as NGN 150,000.
4. Answer in at most six sentences unless asked for more. The reader is at a
   front desk with somebody waiting.
5. When asked to draft a message to students or staff, write the message
   itself and nothing else — no preamble, no "here is a draft".`;

async function requireAssistantAdmin() {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null;
  const admin = await resolveAdmin(session?.user?.id);
  if (!admin) {
    return { error: NextResponse.json({ error: "Admin access required" }, { status: 403 }) };
  }
  return { admin };
}

export async function GET() {
  const auth = await requireAssistantAdmin();
  if (auth.error) return auth.error;

  const [status, briefing] = await Promise.all([
    ollamaStatus(),
    buildBriefing(auth.admin.can as (c: never) => boolean),
  ]);

  return NextResponse.json({ status, briefing, capabilities: auth.admin.capabilities });
}

export async function POST(request: Request) {
  const auth = await requireAssistantAdmin();
  if (auth.error) return auth.error;

  const body = await request.json().catch(() => ({}));
  const question = typeof body.question === "string" ? body.question.trim() : "";
  const history: ChatMessage[] = Array.isArray(body.history)
    ? (body.history as unknown[])
        .filter(
          (m): m is ChatMessage =>
            typeof m === "object" &&
            m !== null &&
            (("role" in m && (m as ChatMessage).role === "user") ||
              (m as ChatMessage).role === "assistant") &&
            typeof (m as ChatMessage).content === "string",
        )
        // Enough for the model to follow a thread, short enough that a long
        // session does not slow every reply to a crawl on a local model.
        .slice(-6)
    : [];

  if (!question) {
    return NextResponse.json({ error: "Ask a question" }, { status: 400 });
  }
  if (question.length > 2000) {
    return NextResponse.json({ error: "That question is too long" }, { status: 400 });
  }

  const briefing = await buildBriefing(auth.admin.can as (c: never) => boolean);

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "system",
      content: `BRIEFING (generated ${briefing.generatedAt}):\n${JSON.stringify(briefing, null, 2)}`,
    },
    ...history,
    { role: "user", content: question },
  ];

  const result = await ollamaChat(messages);

  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 503 });
  }

  return NextResponse.json({ answer: result.text, model: result.model, briefing });
}
