import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveAdmin } from "@/lib/admin-roles";
import { ollamaWarm } from "@/lib/ollama";
import { runTool, toolSpecsFor, type ToolOutcome } from "@/lib/assistant-tools";
import { actionSpecsFor, isActionName } from "@/lib/assistant-actions";
import { createPlan, type StoredPlan } from "@/lib/action-plans";
import {
  brainProvider,
  brainStatus,
  brainTurn,
  canBrainAct,
  type BrainMessage,
} from "@/lib/assistant-brain";
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

const LOOKUP_RULES = `You are the assistant for the office of Easyway German Language School in Nigeria.

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
 * The half of the prompt that only exists when the brain can act.
 *
 * Kept separate rather than written into one long string because a local model
 * that will never be offered these tools should not be told about them: every
 * token of instruction for a capability it does not have is a token spent
 * making it worse at the ones it does.
 */
const ACTION_RULES = `
YOU CAN ALSO DO THINGS, NOT JUST LOOK THEM UP.

The action tools — message_students, send_fee_reminders, mark_attendance,
promote_students, postpone_class, invite_leads — do NOT happen when you call
them. Calling one prepares a plan and shows the admin a card with the exact
number of people it affects and a Confirm button. You are drafting; they decide.

10. Be willing. If the admin asks you to chase the unpaid B1 students, propose
    the action — do not answer with instructions for how they could do it
    themselves. Doing the work is the job.
11. Propose ONE action per answer. If they asked for two things, do the first
    and say what the second would be.
12. Write the copy yourself. When an action needs a message, compose it in the
    school's voice — warm, plain, direct — rather than asking the admin what to
    write. They will read it on the card before anything is sent.
13. After proposing, say in ONE sentence what you are about to do and what it
    affects. Never say it is done, sent, marked or moved — it has not happened.
    Do not mention buttons, cards or confirming; the admin can see those.
14. If an action tool returns an error, it is telling you how to fix the
    proposal. Fix it and propose again, or ask the admin the one thing you are
    missing.
15. Anything irreversible or wide — messaging the whole school, promoting a
    cohort — deserves one plain sentence about what it covers. Not a warning
    paragraph.`;

/**
 * How many times the model may ask for tools before it must answer.
 *
 * Four rather than three now that actions exist: list_options → find_students →
 * propose an action → answer is a legitimate chain, and cutting it at three
 * would strand the useful case where the model checks who it is about to
 * message before offering to message them. Without any ceiling a confused model
 * calls the same tool forever, and on a local CPU each round is twenty seconds
 * of a front-desk worker watching a spinner.
 */
const MAX_TOOL_ROUNDS = 4;

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
    brainStatus(),
    cachedBriefing(auth.admin as unknown as AdminLike),
  ]);

  // Opening the page is the signal that a question is coming. Start loading the
  // local model now, so the several-second load overlaps with the admin reading
  // the briefing instead of landing on top of their first question. Pointless
  // on the hosted brain, which has nothing to warm.
  if (status.provider === "ollama" && status.ready) ollamaWarm();

  const canAct = canBrainAct();

  return NextResponse.json({
    status,
    briefing,
    capabilities: auth.admin.capabilities,
    // Named so the page can show what this admin's assistant may look up —
    // a Secretary should be able to see that money is absent by design rather
    // than wonder why their question came back empty.
    tools: toolSpecsFor(auth.admin).map((spec) => ({
      name: spec.function.name,
      description: spec.function.description,
    })),
    // Separate from `tools` on purpose: "what it can find out" and "what it can
    // do on your behalf" are different questions, and an admin deciding whether
    // to trust this thing is asking the second one.
    actions: canAct
      ? actionSpecsFor(auth.admin).map((spec) => ({
          name: spec.function.name,
          description: spec.function.description,
        }))
      : [],
  });
}

export async function POST(request: Request) {
  const auth = await requireAssistantAdmin();
  if (auth.error) return auth.error;

  const body = await request.json().catch(() => ({}));
  const question = typeof body.question === "string" ? body.question.trim() : "";
  type HistoryTurn = { role: "user" | "assistant"; content: string };
  const history: HistoryTurn[] = Array.isArray(body.history)
    ? (body.history as unknown[])
        .filter((m): m is HistoryTurn => {
          if (typeof m !== "object" || m === null) return false;
          const turn = m as Partial<HistoryTurn>;
          return (
            (turn.role === "user" || turn.role === "assistant") &&
            typeof turn.content === "string" &&
            // An empty assistant turn is what a failed question leaves behind,
            // and replaying one to Anthropic is a hard validation error rather
            // than a bad answer — the API rejects a message with no content.
            turn.content.trim().length > 0
          );
        })
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

  const canAct = canBrainAct();

  const messages: BrainMessage[] = [
    { role: "system", content: canAct ? `${LOOKUP_RULES}\n${ACTION_RULES}` : LOOKUP_RULES },
    {
      role: "system",
      content:
        "BRIEFING — the school at a glance, already computed. " +
        `Use it for broad questions; use the tools for anything specific:\n${JSON.stringify(briefingForModel)}`,
    },
    ...history,
    { role: "user", content: question },
  ];

  const status = await brainStatus();
  const readSpecs = toolSpecsFor(auth.admin);
  /**
   * Read tools always; action tools only when the brain is one that can be
   * trusted to fill in their arguments. See canBrainAct() — this is the line
   * that keeps a 3B local model out of the write path.
   */
  const specs = canAct ? [...readSpecs, ...actionSpecsFor(auth.admin)] : readSpecs;

  /**
   * From here the answer is STREAMED, as newline-delimited JSON frames.
   *
   * The model's total thinking time did not change and cannot be argued down —
   * on the office machine, generating five sentences is most of half a minute
   * whatever we do. What changed is that the admin now sees the first words in
   * about three seconds instead of a spinner for thirty. That is not a
   * cosmetic difference to somebody holding a queue at a front desk.
   *
   * Frames, one JSON object per line:
   *   {type:"tool",  name, arguments}  — a lookup started (the silent stretch)
   *   {type:"delta", text}             — more of the answer
   *   {type:"done",  answer, model, briefing, toolsUsed, cohort, degraded?}
   *   {type:"error", error}
   *
   * NDJSON rather than SSE because this is a plain `fetch` from our own page,
   * not an EventSource — there is no reason to pay for `data:` framing that
   * the client would only have to strip again.
   *
   * The one real constraint: once the first byte is written the HTTP status is
   * fixed at 200, so every failure past this point must travel as an `error`
   * FRAME rather than a 503. Auth and validation are checked above, before the
   * stream opens, and those still return honest status codes.
   */
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (frame: Record<string, unknown>) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`${JSON.stringify(frame)}\n`));
      };
      const finish = () => {
        if (closed) return;
        closed = true;
        controller.close();
      };

      try {
        /**
         * The brain is not there at all — a local model that is not running, or
         * one that cannot call tools. A briefing-only reply is worth more than
         * an error, and the page says which mode it got.
         */
        if (!status.ready || specs.length === 0) {
          const result = await brainTurn(messages, (text) => send({ type: "delta", text }));
          if (!result.ok) {
            send({ type: "error", error: result.reason });
            return finish();
          }
          send({
            type: "done",
            answer: result.text,
            model: result.model,
            briefing,
            toolsUsed: [],
            cohort: null,
            proposal: null,
            degraded:
              status.reason ??
              "This answer comes from the summary only — no live lookups were available.",
          });
          return finish();
        }

        const toolsUsed: Array<{ name: string; arguments: Record<string, unknown> }> = [];
        /** The last cohort any lookup produced — what the table below shows. */
        let cohort: ToolOutcome["cohort"] | null = null;
        /**
         * The action awaiting a human, if the model proposed one.
         *
         * Singular, and the last one wins. A model that proposes two actions in
         * one answer has produced a screen with two Confirm buttons and no
         * ordering between them, which is how somebody sends the second thing
         * while meaning to send the first. The prompt asks for one; this makes
         * it true regardless.
         */
        let proposal: StoredPlan | null = null;
        /**
         * Which brain is actually answering, once we know.
         *
         * Set the moment a round comes back from the local model, and pinned
         * for the rest of the loop — see the `force` option on brainTurn. One
         * question is answered by one model; re-deciding per round produces a
         * conversation half of which the answering model never saw.
         */
        let pinned: "ollama" | undefined;

        /**
         * The tool loop.
         *
         * The model is asked, it may reply with tool calls instead of an
         * answer, the SERVER runs them, the results go back as tool messages,
         * and it is asked again. The model never touches the database — it
         * names a tool and fills in arguments, and both runTool and createPlan
         * re-check the caller's capability before doing anything, because a
         * model that hallucinates `money_summary` at a Secretary has to be
         * refused rather than obeyed.
         *
         * Every round streams, which is safe precisely because a round that
         * decides to call a tool produces no text at all — the tool rounds are
         * silent and the round that answers is the one the admin watches
         * arrive.
         */
        for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
          const turn = await brainTurn(
            messages,
            (text) => send({ type: "delta", text }),
            // Once pinned to the local brain, the action tools are gone for the
            // rest of the question too — not just for the round that fell back.
            pinned ? readSpecs : specs,
            {
              // Only the lookups travel to the fallback. If the hosted brain is
              // down, the local one answers questions — it does not inherit the
              // right to propose actions it was never trusted with.
              fallbackTools: readSpecs,
              force: pinned,
            },
          );
          if (!turn.ok) {
            send({ type: "error", error: turn.reason });
            return finish();
          }
          if (turn.provider === "ollama") pinned = "ollama";

          if (turn.toolCalls.length === 0) {
            send({
              type: "done",
              answer: turn.text,
              model: turn.model,
              briefing,
              toolsUsed,
              cohort,
              proposal,
              // Said out loud, because an admin who asked it to DO something and
              // got an answer instead needs to know why, not wonder whether it
              // quietly did it.
              degraded:
                canAct && turn.provider === "ollama"
                  ? "The fast assistant was unavailable, so this was answered by the local model — which can look things up but cannot carry out actions."
                  : undefined,
            });
            return finish();
          }

          // Record the assistant's own turn before the results, or the model
          // loses track of what it asked for and asks again.
          messages.push({ role: "assistant", content: turn.text, toolCalls: turn.toolCalls });

          for (const call of turn.toolCalls) {
            toolsUsed.push({ name: call.name, arguments: call.arguments });
            // Told to the page as it happens, so the silent stretch reads as
            // "checking the register" rather than as the app having frozen.
            send({ type: "tool", name: call.name, arguments: call.arguments });

            /**
             * The fork that matters. A lookup runs; an action is only WRITTEN
             * DOWN. `createPlan` never touches the thing being planned — it
             * resolves who would be affected, saves the frozen payload, and
             * hands back a preview for a person to read.
             */
            if (isActionName(call.name)) {
              const outcome = await createPlan(call.name, call.arguments, auth.admin);
              if (outcome.ok) {
                proposal = outcome.stored;
                send({ type: "proposal", proposal: outcome.stored });
              }
              messages.push({
                role: "tool",
                toolCallId: call.id,
                name: call.name,
                content: JSON.stringify(outcome.forModel),
              });
              continue;
            }

            const outcome = await runTool(call.name, call.arguments, auth.admin);
            if (outcome.cohort) cohort = outcome.cohort;

            messages.push({
              role: "tool",
              toolCallId: call.id,
              name: call.name,
              content: JSON.stringify(outcome.forModel),
            });
          }
        }

        /**
         * Out of rounds. Rather than return nothing, ask once more with the
         * tool results already in hand, which forces an answer.
         *
         * Two details that look like they could be simplified and cannot:
         *
         *   The nudge is a USER turn, not a system one. System messages become
         *   Anthropic's top-level `system` parameter, so writing it as a system
         *   message would move it to the FRONT of the prompt — the opposite of
         *   "answer now" — and change the cached prefix on the way past.
         *
         *   The tools are still passed. A conversation whose history contains
         *   tool_use blocks is not valid without the tool definitions that
         *   explain them, so dropping them here trades a missing answer for a
         *   400. Any tool call this round asks for is simply ignored instead.
         */
        const final = await brainTurn(
          [
            ...messages,
            {
              role: "user",
              content: "Answer now using the tool results above. Do not ask for more tools.",
            },
          ],
          (text) => send({ type: "delta", text }),
          pinned ? readSpecs : specs,
          { fallbackTools: readSpecs, force: pinned },
        );

        if (!final.ok) {
          send({ type: "error", error: final.reason });
          return finish();
        }

        send({
          type: "done",
          answer: final.text,
          model: final.model,
          briefing,
          toolsUsed,
          cohort,
          proposal,
        });
        return finish();
      } catch (error) {
        console.error("Assistant stream failed", error);
        send({ type: "error", error: "The assistant stopped unexpectedly. Try asking again." });
        return finish();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      // Nginx and friends will happily buffer a streamed response into one
      // lump, which would undo the entire point of this.
      "X-Accel-Buffering": "no",
    },
  });
}
