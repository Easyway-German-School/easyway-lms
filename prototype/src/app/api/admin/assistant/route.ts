import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveAdmin } from "@/lib/admin-roles";
import {
  ollamaChat,
  ollamaChatWithTools,
  ollamaStatus,
  ollamaSupportsTools,
  ollamaWarm,
  toolArguments,
  type ChatMessage,
} from "@/lib/ollama";
import { runTool, toolSpecsFor, type ToolOutcome } from "@/lib/assistant-tools";
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

/**
 * The briefing is expensive twice over, so it is cached for a minute.
 *
 * The obvious cost is the database: building it reads every student and every
 * completed payment, and it ran on page load AND on every question asked.
 *
 * The larger cost is one the code could not see. Ollama reuses the evaluated
 * prompt cache when a request's prefix is byte-identical to the last one, and
 * the briefing sits near the front of the prompt — so any difference in it
 * forces the model to re-evaluate everything after it. Measured on the
 * development machine, that is the difference between 0.2 seconds and
 * 37 SECONDS for a ~900-token prompt.
 *
 * The old code lost that cache every single time, because the briefing carried
 * `generatedAt: new Date().toISOString()` — a fresh timestamp, right at the
 * front, guaranteeing a full re-evaluation on every question. Thirty seconds
 * of an admin's life, spent so the model could be told the current time and
 * then not use it.
 *
 * A minute of staleness on "how many students are in Lagos" is not a number
 * anybody is going to act differently on; thirty seconds of spinner is.
 *
 * Keyed by capability set, because a Secretary and a Director get genuinely
 * different briefings and must never be served each other's.
 */
const BRIEFING_TTL_MS = 60_000;
const briefingCache = new Map<string, { at: number; briefing: Briefing }>();

async function cachedBriefing(admin: AdminLike): Promise<Briefing> {
  const key = [...admin.capabilities].sort().join(",");
  const hit = briefingCache.get(key);
  if (hit && Date.now() - hit.at < BRIEFING_TTL_MS) return hit.briefing;

  const briefing = await buildBriefing(admin.can as (c: never) => boolean);
  briefingCache.set(key, { at: Date.now(), briefing });
  return briefing;
}

type AdminLike = { can: (c: never) => boolean; capabilities: readonly string[] };

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

You have TOOLS that query the school's live database. Use them.

Rules, in order of importance:
1. NEVER state a number you were not given by a tool or by the briefing. Do not
   count, estimate, add up or extrapolate anything yourself. If you need a
   figure, call a tool for it.
2. Use ONLY the filters the question actually mentions. Omit every other
   parameter completely — do not pass it as null, and never add a condition
   nobody asked for. Adding "startedClasses" to a question about unpaid fees
   silently answers a different question, and the admin will act on it.
3. Put every filter the question DOES mention into ONE tool call. "Lagos B1 who
   have not paid" is a single find_students call with branch, level and
   paymentState — not three calls you combine afterwards.
4. Call list_options first whenever the question names a campus or a batch, so
   you filter on a real value instead of guessing the spelling.
5. NEVER list students by name. The admin already has every matching row in a
   table under your answer. Give the count and what stands out about the group
   — the levels, the branches, the worst balance — and stop.
6. If a tool returns an error saying the role does not cover something, tell the
   person plainly that it is outside their access. Do not try another route to it.
7. Money is Nigerian naira. Write it as NGN 150,000.
8. Answer in at most five sentences unless asked for more. The reader is at a
   front desk with somebody waiting.
9. When asked to draft a message to students or staff, write the message itself
   and nothing else — no preamble, no "here is a draft".`;

/**
 * How many times the model may ask for tools before it must answer.
 *
 * Three is enough for list_options → find_students → answer, which is the
 * longest legitimate chain. Without a ceiling a confused model will call the
 * same tool forever, and on a local CPU each round is twenty seconds of a
 * front-desk worker watching a spinner.
 */
const MAX_TOOL_ROUNDS = 3;

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
    cachedBriefing(auth.admin as unknown as AdminLike),
  ]);

  // Only worth asking when the model is actually there; /api/show on a missing
  // model is a wasted round trip on every page load. Cached after the first.
  const supportsTools = status.modelReady ? await ollamaSupportsTools() : false;

  // Opening the page is the signal that a question is coming. Start loading the
  // model now, so the several-second load overlaps with the admin reading the
  // briefing instead of landing on top of their first question.
  if (status.modelReady) ollamaWarm();

  return NextResponse.json({
    status: { ...status, supportsTools },
    briefing,
    capabilities: auth.admin.capabilities,
    // Named so the page can show what this admin's assistant may look up —
    // a Secretary should be able to see that money is absent by design rather
    // than wonder why their question came back empty.
    tools: toolSpecsFor(auth.admin).map((spec) => ({
      name: spec.function.name,
      description: spec.function.description,
    })),
  });
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

  const briefing = await cachedBriefing(auth.admin as unknown as AdminLike);

  /**
   * The prompt is assembled most-stable-first, and that ordering is load
   * bearing rather than tidy: Ollama reuses its evaluated prompt cache only
   * for the prefix that has not changed, so everything constant belongs ahead
   * of everything that varies.
   *
   * `generatedAt` is stripped for the same reason. The model was never asked
   * to do anything with the timestamp, and carrying it made the briefing
   * different on every request, which threw away the cache for the whole
   * prompt behind it. The page still receives the real `briefing` object with
   * the timestamp intact — this trimming applies only to the model's copy.
   *
   * Compact JSON, not indented: the pretty-printed version measured 1012
   * tokens against 890 for the same data, and the model does not read the
   * whitespace.
   */
  const { generatedAt: _ignored, ...briefingForModel } = briefing;

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "system",
      content:
        "BRIEFING — the school at a glance, already computed. " +
        `Use it for broad questions; use the tools for anything specific:\n${JSON.stringify(briefingForModel)}`,
    },
    ...history,
    { role: "user", content: question },
  ];

  /**
   * The tool loop.
   *
   * The model is asked, it may reply with tool calls instead of an answer, the
   * SERVER runs them, the results go back as `tool` messages, and it is asked
   * again. The model never touches the database — it names a tool and fills in
   * arguments, and `runTool` re-checks the caller's capability before doing
   * anything, because a model that hallucinates `money_summary` at a Secretary
   * has to be refused rather than obeyed.
   *
   * Falls straight through to a plain answer when the configured model has no
   * tool support (falcon does not) — a briefing-only reply is worth more than
   * an error, and the page says which mode it got.
   */
  const supportsTools = await ollamaSupportsTools();
  const specs = toolSpecsFor(auth.admin);

  if (!supportsTools || specs.length === 0) {
    const result = await ollamaChat(messages);
    if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 503 });
    return NextResponse.json({
      answer: result.text,
      model: result.model,
      briefing,
      toolsUsed: [],
      cohort: null,
      degraded: !supportsTools
        ? `${result.model} cannot call tools, so this answer comes from the summary only. Switch OLLAMA_MODEL to qwen2.5:3b for live lookups.`
        : undefined,
    });
  }

  const toolsUsed: Array<{ name: string; arguments: Record<string, unknown> }> = [];
  /** The last cohort any tool produced — what the table below the answer shows. */
  let cohort: ToolOutcome["cohort"] | null = null;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const turn = await ollamaChatWithTools(messages, specs);
    if (!turn.ok) return NextResponse.json({ error: turn.reason }, { status: 503 });

    if (turn.toolCalls.length === 0) {
      return NextResponse.json({
        answer: turn.text,
        model: turn.model,
        briefing,
        toolsUsed,
        cohort,
      });
    }

    // Record the assistant's own turn before the results, or the model loses
    // track of what it asked for and asks again.
    messages.push({ role: "assistant", content: turn.text, tool_calls: turn.toolCalls });

    for (const call of turn.toolCalls) {
      const name = call.function?.name ?? "";
      const args = toolArguments(call);
      toolsUsed.push({ name, arguments: args });

      const outcome = await runTool(name, args, auth.admin);
      if (outcome.cohort) cohort = outcome.cohort;

      messages.push({
        role: "tool",
        tool_name: name,
        content: JSON.stringify(outcome.forModel),
      });
    }
  }

  // Out of rounds. Rather than return nothing, ask once more with the tool
  // results already in hand and no tools offered, which forces an answer.
  const final = await ollamaChat([
    ...messages,
    {
      role: "system",
      content: "Answer now using the tool results above. Do not ask for more tools.",
    },
  ]);

  if (!final.ok) return NextResponse.json({ error: final.reason }, { status: 503 });

  return NextResponse.json({
    answer: final.text,
    model: final.model,
    briefing,
    toolsUsed,
    cohort,
  });
}
