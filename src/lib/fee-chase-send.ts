import { prisma, unguardedPrisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/prisma-guard";
import { KIND, notify } from "@/lib/notify";
import { drainQueue } from "@/lib/email-queue";
import {
  CHASE_CATEGORIES,
  FINANCE_STUDENT_SELECT,
  chaseCategoryOf,
  chasePriorityOf,
  computeStudentFinance,
  type ChaseCategory,
  type StudentFinance,
} from "@/lib/finance/receivables";
import { chaseMessage, noteHasAmount, CHASE_NOTE_MAX, type ChaseMessage } from "@/lib/finance/chase";
import {
  buildRosterWhereClause,
  ROSTER_INCLUDE,
  scoreAndFilterRoster,
  type RosterFilters,
} from "@/lib/student-roster-query";

/**
 * THE MASS FEE REMINDER — who it reaches, and the sending itself.
 *
 * Two steps, both driven from the Reminders tab:
 *
 *   1. AUDIENCE  Resolve "everyone on the chase list" (optionally narrowed by the
 *      roster's own filters) into the students who would be messaged, WITHOUT
 *      sending anything. The office sees the count, the biggest debt and a
 *      sample message before it commits.
 *   2. SEND      Deliver to a small chunk of those students at a time. The browser
 *      walks the list in chunks of CHUNK_MAX and shows a progress bar, because
 *      one request that messages four hundred people one-by-one would outrun the
 *      serverless time limit and lose the tail of the list.
 *
 * EVERY MESSAGE STATES THAT STUDENT'S OWN FIGURE, taken from the same finance
 * rules as the list — see finance/chase.ts. The chunk re-checks each student
 * against those rules at send time, so somebody who paid two minutes ago while
 * the office was reading the preview is skipped rather than nagged.
 *
 * ONE PER STUDENT PER DAY (dedupeKey), and by default nobody who was already
 * reminded in the last RECENT_DAYS days — pressing the button twice, or once
 * each from two desks, cannot double-message anybody.
 */

export const CHASE_KEY_PREFIX = "fee-chase:";
export const CHUNK_MAX = 40;
export const RECENT_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

const dayKeyOf = (now: Date) => now.toISOString().slice(0, 10);

type Ctx = {
  tenantId: string | null | undefined;
  allowedBranchIds: string[] | null;
  now?: Date;
};

export type AudienceRequest = {
  filters: RosterFilters;
  category: ChaseCategory | null;
  /** Learners still waiting for a future intake have their own reminders (Upcoming intake). Off by default. */
  includeAwaitingBatch: boolean;
  /** Leave out anyone already sent a fee reminder in the last RECENT_DAYS days. On by default. */
  skipRecent: boolean;
};

export type AudienceMember = {
  studentId: string;
  name: string;
  category: ChaseCategory;
  owed: number;
  priority: number;
};

export type Audience = {
  /** Who WOULD be messaged, most urgent first. */
  members: AudienceMember[];
  /** On the list but left out, with the reason — so the office can see nobody was lost silently. */
  excluded: { awaitingBatch: number; recentlyReminded: number };
  byCategory: Record<ChaseCategory, number>;
  totalOwed: number;
  /** One real message, worded exactly as it will be sent, so the preview is not a mock-up. */
  sample: (ChaseMessage & { name: string; category: ChaseCategory }) | null;
};

const firstNameOf = (name: string | null | undefined) => (name ?? "").trim().split(/\s+/)[0] ?? "";

/** Students reminded through this tool within the window, by id. */
async function recentlyReminded(studentIds: string[], since: Date): Promise<Set<string>> {
  if (studentIds.length === 0) return new Set();
  const rows = await prisma.notification.findMany({
    where: {
      dedupeKey: { startsWith: CHASE_KEY_PREFIX },
      studentId: { in: studentIds },
      createdAt: { gte: since },
    },
    select: { studentId: true },
  });
  return new Set(rows.map((row) => row.studentId).filter((id): id is string => Boolean(id)));
}

export async function resolveChaseAudience(request: AudienceRequest, ctx: Ctx): Promise<Audience> {
  const now = ctx.now ?? new Date();

  // The SAME query and derived-filter pass the roster and its CSV run — so the
  // audience is exactly the list the office was looking at when it pressed send.
  const where = buildRosterWhereClause(request.filters, {
    tenantId: ctx.tenantId,
    allowedBranchIds: ctx.allowedBranchIds,
  });
  const students = await prisma.student.findMany({
    where,
    include: ROSTER_INCLUDE,
    orderBy: { createdAt: "desc" },
  });
  const scored = scoreAndFilterRoster(students, request.filters, now);

  const onList = scored
    .map((entry) => ({ entry, category: chaseCategoryOf(entry.finance) }))
    .filter((row): row is { entry: (typeof scored)[number]; category: ChaseCategory } => row.category !== null)
    .filter((row) => !request.category || row.category === request.category);

  let awaitingBatch = 0;
  const afterBatch = onList.filter((row) => {
    if (row.entry.finance.awaitingBatch && !request.includeAwaitingBatch) {
      awaitingBatch++;
      return false;
    }
    return true;
  });

  let recent = 0;
  let eligible = afterBatch;
  if (request.skipRecent) {
    const already = await recentlyReminded(
      afterBatch.map((row) => row.entry.student.id),
      new Date(now.getTime() - RECENT_DAYS * DAY_MS),
    );
    eligible = afterBatch.filter((row) => {
      if (already.has(row.entry.student.id)) {
        recent++;
        return false;
      }
      return true;
    });
  }

  const members: AudienceMember[] = eligible
    .map((row) => ({
      studentId: row.entry.student.id,
      name: row.entry.student.user?.name ?? row.entry.finance.name,
      category: row.category,
      owed: row.entry.finance.owed,
      priority: chasePriorityOf(row.entry.finance, now),
    }))
    .sort((a, b) => a.priority - b.priority || b.owed - a.owed);

  const byCategory = CHASE_CATEGORIES.reduce(
    (acc, category) => ({ ...acc, [category]: members.filter((m) => m.category === category).length }),
    {} as Record<ChaseCategory, number>,
  );

  const first = eligible[0];
  const sample = first
    ? {
        name: first.entry.student.user?.name ?? first.entry.finance.name,
        category: first.category,
        ...chaseMessage({
          firstName: firstNameOf(first.entry.student.user?.name),
          category: first.category,
          finance: first.entry.finance,
        }),
      }
    : null;

  return {
    members,
    excluded: { awaitingBatch, recentlyReminded: recent },
    byCategory,
    totalOwed: members.reduce((sum, m) => sum + m.owed, 0),
    sample,
  };
}

/* -------------------------------------------------------------------------- */

export type ChunkRequest = {
  studentIds: string[];
  /** Also email it. The bell and the phone push always go. */
  email: boolean;
  /** An optional line from the office, appended after the student's own figures. No amounts. */
  note?: string;
  skipRecent: boolean;
  category?: ChaseCategory | null;
};

export type ChunkResult = {
  /** Students a reminder was written for. */
  sent: number;
  pushed: number;
  emailsQueued: number;
  /** Paid (or otherwise stopped owing) since the list was drawn. */
  noLongerOwing: number;
  recentlyReminded: number;
  failed: number;
};

/** Validates the note the way the assistant's fee action does — see finance/chase.ts. */
export function validateChaseNote(note: unknown): { ok: true; note: string } | { ok: false; error: string } {
  const text = typeof note === "string" ? note.trim() : "";
  if (text.length > CHASE_NOTE_MAX) {
    return { ok: false, error: `Keep the note under ${CHASE_NOTE_MAX} characters — a sentence or two is plenty.` };
  }
  if (noteHasAmount(text)) {
    return {
      ok: false,
      error:
        "The note can't contain an amount — each student's own balance is filled in for them. Rewrite it without numbers.",
    };
  }
  return { ok: true, note: text };
}

export async function sendChaseChunk(request: ChunkRequest, ctx: Ctx): Promise<ChunkResult> {
  const now = ctx.now ?? new Date();
  const result: ChunkResult = { sent: 0, pushed: 0, emailsQueued: 0, noLongerOwing: 0, recentlyReminded: 0, failed: 0 };
  const ids = [...new Set(request.studentIds)].slice(0, CHUNK_MAX);
  if (ids.length === 0) return result;

  // Tenant and branch fence first, then the ids — a chunk can never reach a
  // student the caller could not have listed.
  const fence = buildRosterWhereClause({}, { tenantId: ctx.tenantId, allowedBranchIds: ctx.allowedBranchIds });
  const students = await prisma.student.findMany({
    where: { AND: [fence, { id: { in: ids } }] },
    select: FINANCE_STUDENT_SELECT,
  });

  const skip = request.skipRecent
    ? await recentlyReminded(ids, new Date(now.getTime() - RECENT_DAYS * DAY_MS))
    : new Set<string>();

  const dedupeKey = `${CHASE_KEY_PREFIX}${dayKeyOf(now)}`;

  for (const student of students) {
    const finance: StudentFinance = computeStudentFinance(student, now);
    const category = chaseCategoryOf(finance);
    if (!category || (request.category && category !== request.category)) {
      result.noLongerOwing++;
      continue;
    }
    if (skip.has(student.id)) {
      result.recentlyReminded++;
      continue;
    }

    const { title, message } = chaseMessage({
      firstName: firstNameOf(student.user?.name),
      category,
      finance,
      note: request.note,
    });

    try {
      const res = await notify({
        to: { studentIds: [student.id] },
        kind: KIND.tuitionReminder,
        // Warning, so it buzzes the phone — a fee reminder nobody sees is one that gets sent again.
        severity: "warning",
        title,
        message,
        link: "/payments",
        dedupeKey,
        push: true,
        email: request.email,
        // Never text: this kind texts by default and a school-wide blast is real money.
        sms: false,
      });
      if (res.created > 0) result.sent++;
      else if (res.skipped > 0) result.recentlyReminded++; // already got today's reminder
      result.pushed += res.pushed;
      result.emailsQueued += res.queuedEmails;
    } catch (error) {
      console.error("fee-chase: notify failed", { studentId: student.id, error });
      result.failed++;
    }
  }

  // Put this chunk's emails on the wire now rather than waiting for the next
  // 15-minute flush, so a 400-student send does not trickle out over two hours.
  if (result.emailsQueued > 0) {
    try {
      await drainQueue(Math.min(result.emailsQueued, CHUNK_MAX));
    } catch (error) {
      console.warn("fee-chase: immediate email flush failed; the scheduled flush will pick them up", error);
    }
  }

  if (result.sent > 0) {
    await writeAudit(unguardedPrisma, {
      action: "feeReminderSent",
      model: "Student",
      recordId: dedupeKey,
      severity: "notice",
      affectedCount: result.sent,
      summary: `Fee reminder sent to ${result.sent} student${result.sent === 1 ? "" : "s"}${
        request.email ? " (bell, push and email)" : " (bell and push)"
      }${request.category ? ` — ${request.category.replace("_", " ")}` : ""}`,
      after: { email: request.email, note: request.note ? true : false, pushed: result.pushed },
    });
  }

  return result;
}

/** Sends grouped by day, newest first — for the "recent sends" strip. */
export async function recentChaseSends(limit = 8): Promise<Array<{ day: string; students: number; lastAt: string }>> {
  const rows = await prisma.notification.groupBy({
    by: ["dedupeKey"],
    where: { dedupeKey: { startsWith: CHASE_KEY_PREFIX } },
    _count: { _all: true },
    _max: { createdAt: true },
  });
  return rows
    .filter((row): row is typeof row & { dedupeKey: string } => Boolean(row.dedupeKey))
    .map((row) => ({
      day: row.dedupeKey.slice(CHASE_KEY_PREFIX.length),
      students: row._count._all,
      lastAt: (row._max.createdAt ?? new Date(0)).toISOString(),
    }))
    .sort((a, b) => b.lastAt.localeCompare(a.lastAt))
    .slice(0, limit);
}
