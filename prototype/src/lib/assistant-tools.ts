/**
 * What the assistant is allowed to look up.
 *
 * ---------------------------------------------------------------------------
 * THE ONE RULE, RESTATED FOR THE TOOL ERA
 *
 * The model still never counts anything. It never sees the database, never
 * writes a query, and never decides who it is allowed to look at. All it does
 * is pick a tool from this file and fill in its arguments; everything after
 * that — the SQL, the capability check, the row limit — happens here, on the
 * server, in code a person reviewed.
 *
 * That is the difference between this and "give the LLM SQL access", which is
 * the obvious version of this feature and is not a thing you do to a database
 * containing four hundred people's fee balances. There is no query the model
 * can compose that this file does not already know the shape of.
 *
 * ---------------------------------------------------------------------------
 * WHY ONE BIG FILTER INSTEAD OF TWENTY LITTLE TOOLS
 *
 * The tempting design is a tool per question: `find_unpaid_students`,
 * `find_absent_students`, `find_students_by_branch`. It reads well and it fails
 * in practice, because the office's real questions are compound — "Lagos, B1,
 * unpaid, and I have not seen them in three weeks" is one question, not four —
 * and a 3B model asked to intersect four tool results by hand will get it
 * wrong. `find_students` takes every filter at once and the intersection
 * happens in Postgres, where it is correct by construction.
 *
 * `count_students` exists alongside it for the same reason in reverse: when the
 * answer is "how many", returning two hundred rows so the model can count them
 * is exactly the failure mode this whole design exists to prevent. It gets a
 * number and a breakdown, and it cannot miscount either.
 *
 * ---------------------------------------------------------------------------
 * CAPABILITIES ARE ENFORCED PER TOOL AND PER FIELD
 *
 * A Secretary has no `payments` capability. They do not merely lose the money
 * TOOLS — the `owed` field is stripped from every student row they get back, so
 * there is no phrasing of any question that returns them a balance. The model
 * cannot leak what was never put in front of it.
 */

import { prisma } from "@/lib/prisma";
import type { AdminContext, Capability } from "@/lib/admin-roles";
import { derivePaymentStatus, requiredDepositFor, tuitionFeeFor } from "@/lib/payment";
import { goalFor } from "@/lib/germany-goals";
import { LEVELS } from "@/lib/levels";
import type { ToolSpec } from "@/lib/ollama";

/** Hard ceiling on rows returned to the model, whatever it asks for. */
const MAX_ROWS = 60;
/** Ceiling on rows returned to the BROWSER, which can render a real table. */
const MAX_TABLE_ROWS = 500;

const DAY = 86_400_000;

/* -------------------------------------------------------------------------- */
/* The shape of an answer                                                     */
/* -------------------------------------------------------------------------- */

export type StudentRow = {
  id: string;
  name: string;
  email: string;
  studentCode: string | null;
  level: string;
  branch: string | null;
  status: string;
  classType: string;
  deliveryMode: string;
  goal: string | null;
  /** Only present when the caller has `payments`. */
  owed?: number;
  paid?: number;
  paymentState?: "unpaid" | "partial" | "paid";
  /** Only present when the caller has `attendance`. */
  lastSeen?: string | null;
  daysSinceSeen?: number | null;
  startedClasses: boolean;
  registeredOn: string;
};

export type ToolOutcome = {
  /** What goes back to the MODEL — trimmed, and never more than MAX_ROWS. */
  forModel: unknown;
  /**
   * What goes back to the BROWSER, if this tool produced a cohort. The page
   * renders these as a real selectable table, so the admin acts on the rows
   * themselves rather than on the model's paraphrase of them — which is the
   * difference between an assistant and a rumour.
   */
  cohort?: { label: string; rows: StudentRow[]; truncated: boolean };
};

/* -------------------------------------------------------------------------- */
/* Filters                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Exported so the ACTION tools resolve their cohort through exactly this code
 * path — see assistant-actions.ts. If "Lagos B1 unpaid" means one set of people
 * when the assistant lists them and a slightly different set when it messages
 * them, the confirm card is describing a group nobody reviewed. One filter
 * implementation, used by both halves.
 */
export type Filters = {
  branch?: string;
  level?: string;
  status?: string;
  classType?: string;
  deliveryMode?: string;
  goal?: string;
  batch?: string;
  search?: string;
  paymentState?: "unpaid" | "partial" | "paid";
  notSeenForDays?: number;
  startedClasses?: boolean;
  registeredWithinDays?: number;
};

export function readFilters(args: Record<string, unknown>): Filters {
  const str = (key: string) => {
    const value = args[key];
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  };
  const num = (key: string) => {
    const value = Number(args[key]);
    return Number.isFinite(value) && value > 0 ? value : undefined;
  };
  const bool = (key: string) => (typeof args[key] === "boolean" ? (args[key] as boolean) : undefined);

  const paymentState = str("paymentState")?.toLowerCase();

  return {
    branch: str("branch"),
    level: str("level")?.toUpperCase(),
    status: str("status")?.toLowerCase(),
    classType: str("classType")?.toLowerCase(),
    deliveryMode: str("deliveryMode")?.toLowerCase(),
    goal: str("goal")?.toLowerCase(),
    batch: str("batch"),
    search: str("search"),
    paymentState:
      paymentState === "unpaid" || paymentState === "partial" || paymentState === "paid"
        ? paymentState
        : undefined,
    notSeenForDays: num("notSeenForDays"),
    startedClasses: bool("startedClasses"),
    registeredWithinDays: num("registeredWithinDays"),
  };
}

/**
 * The half of the filter Postgres can do.
 *
 * Payment state and attendance gaps are deliberately NOT here: both are derived
 * from rows this schema stores per-payment and per-session, and expressing them
 * as SQL means either a raw query or a correlated subquery per student. They
 * are applied in `applyDerivedFilters` after the fetch instead, which is honest
 * about the cost and is why MAX_TABLE_ROWS exists.
 */
function whereFor(filters: Filters, branchIdByName: Map<string, string>) {
  const where: Record<string, unknown> = {};

  if (filters.branch) {
    const id = branchIdByName.get(filters.branch.toLowerCase());
    // An unrecognised branch name must return nothing rather than everything.
    // Silently dropping the filter would answer "all 400 students" to a
    // question about one campus, and the model would report it as fact.
    where.branchId = id ?? "__no_such_branch__";
  }
  if (filters.level) where.level = filters.level;
  if (filters.status) where.status = filters.status;
  if (filters.classType) where.classType = filters.classType;
  if (filters.deliveryMode) where.deliveryMode = filters.deliveryMode;
  if (filters.goal) where.germanyGoal = filters.goal;
  if (filters.startedClasses === true) where.classesStartedAt = { not: null };
  if (filters.startedClasses === false) where.classesStartedAt = null;
  if (filters.batch) where.admission = { path: ["batch"], equals: filters.batch };
  if (filters.registeredWithinDays) {
    where.createdAt = { gte: new Date(Date.now() - filters.registeredWithinDays * DAY) };
  }
  if (filters.search) {
    where.OR = [
      { user: { name: { contains: filters.search } } },
      { user: { email: { contains: filters.search } } },
      { studentCode: { contains: filters.search } },
    ];
  }

  return where;
}

/* -------------------------------------------------------------------------- */
/* Loading                                                                    */
/* -------------------------------------------------------------------------- */

export async function loadStudents(filters: Filters, admin: AdminContext): Promise<StudentRow[]> {
  const canSeeMoney = admin.can("payments");
  const canSeeAttendance = admin.can("attendance");

  const branches = await prisma.branch.findMany({ select: { id: true, name: true } });
  const branchIdByName = new Map(branches.map((b) => [b.name.toLowerCase(), b.id]));

  const students = await prisma.student.findMany({
    where: whereFor(filters, branchIdByName),
    take: MAX_TABLE_ROWS,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      studentCode: true,
      level: true,
      status: true,
      classType: true,
      deliveryMode: true,
      germanyGoal: true,
      classesStartedAt: true,
      createdAt: true,
      branch: { select: { name: true } },
      user: { select: { name: true, email: true } },
      // Only fetched when it can be shown. Reading balances for somebody who
      // may not see them and discarding the field afterwards is one refactor
      // away from a leak.
      ...(canSeeMoney
        ? { payments: { where: { status: "completed" }, select: { amount: true } } }
        : {}),
      ...(canSeeAttendance
        ? {
            attendances: {
              where: { status: { in: ["present", "late"] } },
              orderBy: { date: "desc" as const },
              take: 1,
              select: { date: true },
            },
          }
        : {}),
    },
  });

  const now = Date.now();

  return students.map((student) => {
    const row: StudentRow = {
      id: student.id,
      name: student.user?.name ?? "(no name)",
      email: student.user?.email ?? "",
      studentCode: student.studentCode,
      level: student.level,
      branch: student.branch?.name ?? null,
      status: student.status,
      classType: student.classType,
      deliveryMode: student.deliveryMode,
      goal: student.germanyGoal ? goalFor(student.germanyGoal).label : null,
      startedClasses: Boolean(student.classesStartedAt),
      registeredOn: student.createdAt.toISOString().slice(0, 10),
    };

    if (canSeeMoney) {
      const payments = (student as { payments?: Array<{ amount: number }> }).payments ?? [];
      const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
      const lookup = { level: student.level, branch: student.branch?.name ?? null, classType: student.classType };
      const tuitionFee = tuitionFeeFor(lookup);
      const money = derivePaymentStatus({
        totalPaid,
        tuitionFee,
        requiredDeposit: requiredDepositFor(lookup),
      });
      row.paid = totalPaid;
      row.owed = Math.max(0, tuitionFee - totalPaid);
      row.paymentState = money.fullPaid ? "paid" : totalPaid > 0 ? "partial" : "unpaid";
    }

    if (canSeeAttendance) {
      const attendances = (student as { attendances?: Array<{ date: Date }> }).attendances ?? [];
      const last = attendances[0]?.date ?? null;
      row.lastSeen = last ? last.toISOString().slice(0, 10) : null;
      row.daysSinceSeen = last ? Math.floor((now - last.getTime()) / DAY) : null;
    }

    return row;
  });
}

/**
 * The filters that need the derived fields, applied after loading.
 *
 * `notSeenForDays` treats "never seen at all" as matching, which is the
 * answer the office wants: somebody who has never once been marked present is
 * more overdue for a phone call than somebody last seen four weeks ago, not
 * less.
 */
export function applyDerivedFilters(
  rows: StudentRow[],
  filters: Filters,
  admin: AdminContext,
): StudentRow[] {
  let result = rows;

  if (filters.paymentState) {
    if (!admin.can("payments")) return [];
    result = result.filter((row) => row.paymentState === filters.paymentState);
  }

  if (filters.notSeenForDays) {
    if (!admin.can("attendance")) return [];
    result = result.filter(
      (row) => row.daysSinceSeen === null || (row.daysSinceSeen ?? 0) >= filters.notSeenForDays!,
    );
  }

  return result;
}

/* -------------------------------------------------------------------------- */
/* The tools                                                                  */
/* -------------------------------------------------------------------------- */

export const FILTER_PROPERTIES = {
  branch: { type: "string", description: "Campus name, e.g. Lagos or Abuja. Use list_options to see valid names." },
  level: { type: "string", enum: [...LEVELS], description: "CEFR level: A1, A2, B1, B2, C1 or C2." },
  status: { type: "string", enum: ["active", "inactive", "graduated", "withdrawn"], description: "Enrolment status." },
  classType: { type: "string", enum: ["group", "private"] },
  deliveryMode: { type: "string", enum: ["physical", "hybrid", "online"] },
  goal: {
    type: "string",
    enum: ["study", "ausbildung", "work", "care", "family", "aupair", "settle", "explore", "custom"],
    description: "Why the student is learning German.",
  },
  batch: { type: "string", description: "Batch month, e.g. 'July 2026'." },
  search: { type: "string", description: "Free text matched against name, email and student code." },
  paymentState: {
    type: "string",
    enum: ["unpaid", "partial", "paid"],
    description: "Tuition state. Needs the payments capability.",
  },
  notSeenForDays: {
    type: "number",
    description:
      "Only students not marked present for at least this many days. Students never seen at all are included. Needs the attendance capability.",
  },
  startedClasses: { type: "boolean", description: "Whether they have confirmed their first class." },
  registeredWithinDays: { type: "number", description: "Only students who registered in the last N days." },
} as const;

export type AssistantTool = {
  name: string;
  /** Without this capability the tool is not even offered to the model. */
  capability: Capability | null;
  spec: ToolSpec;
  run: (args: Record<string, unknown>, admin: AdminContext) => Promise<ToolOutcome>;
};

export const ASSISTANT_TOOLS: AssistantTool[] = [
  {
    name: "count_students",
    capability: "students",
    spec: {
      type: "function",
      function: {
        name: "count_students",
        description:
          "Count students matching any combination of filters, with an optional breakdown. Use this for every 'how many' question — never count rows yourself.",
        parameters: {
          type: "object",
          properties: {
            ...FILTER_PROPERTIES,
            groupBy: {
              type: "string",
              enum: ["level", "branch", "status", "goal", "paymentState", "deliveryMode"],
              description: "Optional. Returns a breakdown by this field as well as the total.",
            },
          },
        },
      },
    },
    async run(args, admin) {
      const filters = readFilters(args);
      const rows = applyDerivedFilters(await loadStudents(filters, admin), filters, admin);

      const groupBy = String(args.groupBy ?? "");
      let breakdown: Record<string, number> | undefined;
      if (groupBy) {
        breakdown = {};
        for (const row of rows) {
          const key = String((row as unknown as Record<string, unknown>)[groupBy] ?? "unknown");
          breakdown[key] = (breakdown[key] ?? 0) + 1;
        }
      }

      return {
        forModel: {
          total: rows.length,
          breakdown,
          filtersApplied: filters,
          note:
            rows.length >= MAX_TABLE_ROWS
              ? `Capped at ${MAX_TABLE_ROWS}. The true total may be higher — say so.`
              : undefined,
        },
      };
    },
  },

  {
    name: "find_students",
    capability: "students",
    spec: {
      type: "function",
      function: {
        name: "find_students",
        description:
          "List the actual students matching any combination of filters. Use this when the admin wants to see or act on specific people. Combine every filter the question mentions in ONE call.",
        parameters: {
          type: "object",
          properties: {
            ...FILTER_PROPERTIES,
            sortBy: {
              type: "string",
              enum: ["owed", "daysSinceSeen", "name", "registeredOn"],
              description: "Optional. Largest or longest first.",
            },
            limit: { type: "number", description: `How many to show. Default 25, maximum ${MAX_ROWS}.` },
          },
        },
      },
    },
    async run(args, admin) {
      const filters = readFilters(args);
      let rows = applyDerivedFilters(await loadStudents(filters, admin), filters, admin);

      const sortBy = String(args.sortBy ?? "");
      if (sortBy === "owed") rows = [...rows].sort((a, b) => (b.owed ?? 0) - (a.owed ?? 0));
      else if (sortBy === "daysSinceSeen")
        rows = [...rows].sort((a, b) => (b.daysSinceSeen ?? 9999) - (a.daysSinceSeen ?? 9999));
      else if (sortBy === "name") rows = [...rows].sort((a, b) => a.name.localeCompare(b.name));
      else if (sortBy === "registeredOn")
        rows = [...rows].sort((a, b) => b.registeredOn.localeCompare(a.registeredOn));

      const limit = Math.min(MAX_ROWS, Math.max(1, Number(args.limit) || 25));

      return {
        /**
         * THE MODEL IS NOT GIVEN THE LIST.
         *
         * The obvious shape here is `{ matched: 38, showing: 25, students: [...] }`
         * and it fails, reliably, in the one way that matters. Measured against
         * qwen2.5:3b with exactly that payload: the tool reported `matched: 38`,
         * the sample held three rows, and the model answered "there are 3
         * students who haven't paid" — then dropped one of the three for a
         * reason it invented. Asked to both read a total and look at a list, a
         * small model counts the list. Every time.
         *
         * There is no prompt that reliably fixes that, so the array is gone.
         * The model gets the count, the shape of the group, and at most three
         * rows explicitly labelled as examples. It cannot miscount a list it
         * was never handed, which is the same principle as the original rule —
         * the model never counts anything — applied one level deeper.
         *
         * The full rows still go to the browser, below, where a table renders
         * them exactly as the database returned them.
         */
        forModel: {
          matched: rows.length,
          /**
           * A directive, deliberately not written as a sentence.
           *
           * The first version of this field read "Exactly 38 students matched.
           * State that number. The admin can already see all 38 in a table
           * below your answer, so do NOT list names." The model got the count
           * right and then recited the instruction back to the admin verbatim,
           * telling them not to list names. Anything phrased as prose in a tool
           * result is copy for the model to lift; a snake_case token is not.
           */
          how_to_answer:
            rows.length === 0
              ? "no_matches__say_so_and_suggest_loosening_one_filter"
              : "state_matched_number__then_describe_group_from_breakdown__never_list_names",
          filtersApplied: filters,
          breakdown: summarise(rows),
          examples_only_never_count_these: rows.slice(0, 3).map((row) => ({
            name: row.name,
            level: row.level,
            branch: row.branch,
            ...(row.owed !== undefined ? { owed: row.owed } : {}),
            ...(row.daysSinceSeen !== undefined ? { daysSinceSeen: row.daysSinceSeen } : {}),
          })),
          note:
            rows.length >= MAX_TABLE_ROWS
              ? `Capped at ${MAX_TABLE_ROWS}. The true total may be higher — say so.`
              : undefined,
        },
        // The BROWSER gets every row, so the admin can select and act on all
        // 38 even though the model only read 25 of them.
        cohort: {
          label: describeFilters(filters),
          rows,
          truncated: rows.length >= MAX_TABLE_ROWS,
        },
      };
    },
  },

  {
    name: "list_options",
    capability: null,
    spec: {
      type: "function",
      function: {
        name: "list_options",
        description:
          "List the branch names, batches and levels that actually exist. Call this FIRST whenever the admin names a campus or batch, so you filter on a real value instead of guessing at the spelling.",
        parameters: { type: "object", properties: {} },
      },
    },
    async run() {
      const [branches, batches] = await Promise.all([
        prisma.branch.findMany({ select: { name: true, mode: true }, orderBy: { name: "asc" } }),
        prisma.student.findMany({ select: { admission: true }, take: 400 }),
      ]);

      const batchNames = new Set<string>();
      for (const student of batches) {
        const admission = student.admission as Record<string, unknown> | null;
        const batch = admission && typeof admission.batch === "string" ? admission.batch : null;
        if (batch) batchNames.add(batch);
      }

      return {
        forModel: {
          branches: branches.map((b) => b.name),
          onlineBranches: branches.filter((b) => b.mode === "online").map((b) => b.name),
          levels: [...LEVELS],
          batches: [...batchNames].sort(),
        },
      };
    },
  },

  {
    name: "money_summary",
    capability: "payments",
    spec: {
      type: "function",
      function: {
        name: "money_summary",
        description:
          "Totals for tuition: collected all time, collected this month, total outstanding, how many students owe. Optionally narrowed to one branch or level.",
        parameters: {
          type: "object",
          properties: { branch: FILTER_PROPERTIES.branch, level: FILTER_PROPERTIES.level },
        },
      },
    },
    async run(args, admin) {
      const filters = readFilters(args);
      const rows = await loadStudents({ ...filters, status: "active" }, admin);
      const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

      const collectedThisMonth = await prisma.payment
        .aggregate({
          _sum: { amount: true },
          where: { status: "completed", createdAt: { gte: monthStart } },
        })
        .then((r) => r._sum.amount ?? 0);

      return {
        forModel: {
          currency: "NGN",
          activeStudents: rows.length,
          collectedAllTime: rows.reduce((sum, row) => sum + (row.paid ?? 0), 0),
          collectedThisMonth,
          outstandingTotal: rows.reduce((sum, row) => sum + (row.owed ?? 0), 0),
          studentsOwing: rows.filter((row) => (row.owed ?? 0) > 0).length,
          fullyPaid: rows.filter((row) => row.paymentState === "paid").length,
          scope: filters.branch || filters.level ? filters : "whole school",
        },
      };
    },
  },

  {
    name: "attendance_summary",
    capability: "attendance",
    spec: {
      type: "function",
      function: {
        name: "attendance_summary",
        description:
          "How attendance has gone over the last N days: sessions held, average turnout, and how many students have not been seen at all.",
        parameters: {
          type: "object",
          properties: {
            days: { type: "number", description: "Window in days. Default 7." },
            branch: FILTER_PROPERTIES.branch,
          },
        },
      },
    },
    async run(args) {
      const days = Math.min(120, Math.max(1, Number(args.days) || 7));
      const since = new Date(Date.now() - days * DAY);

      const records = await prisma.attendance.findMany({
        where: { date: { gte: since } },
        select: { status: true, date: true },
      });

      const present = records.filter((r) => r.status === "present" || r.status === "late").length;
      const sessions = new Set(records.map((r) => r.date.toISOString().slice(0, 10))).size;

      return {
        forModel: {
          windowDays: days,
          daysWithSessions: sessions,
          marksRecorded: records.length,
          presentOrLate: present,
          averagePresentPercent: records.length ? Math.round((present / records.length) * 100) : null,
        },
      };
    },
  },

  {
    name: "enquiry_summary",
    capability: "students",
    spec: {
      type: "function",
      function: {
        name: "enquiry_summary",
        description: "Leads and enquiries: how many are open, how many arrived recently, and how many converted.",
        parameters: {
          type: "object",
          properties: { days: { type: "number", description: "Window in days. Default 30." } },
        },
      },
    },
    async run(args) {
      const days = Math.min(365, Math.max(1, Number(args.days) || 30));
      const since = new Date(Date.now() - days * DAY);

      const [total, recent, converted, dropped] = await Promise.all([
        prisma.lead.count(),
        prisma.lead.count({ where: { createdAt: { gte: since } } }),
        prisma.lead.count({ where: { convertedStudentId: { not: null } } }),
        prisma.lead.count({ where: { status: "dropped" } }),
      ]);

      return {
        forModel: {
          windowDays: days,
          totalEnquiries: total,
          newInWindow: recent,
          convertedToStudents: converted,
          dropped,
          stillOpen: Math.max(0, total - converted - dropped),
        },
      };
    },
  },
];

/** Only the tools this admin's role actually covers. */
export function toolsFor(admin: AdminContext): AssistantTool[] {
  return ASSISTANT_TOOLS.filter((tool) => !tool.capability || admin.can(tool.capability));
}

export function toolSpecsFor(admin: AdminContext): ToolSpec[] {
  return toolsFor(admin).map((tool) => tool.spec);
}

/**
 * Run one tool the model asked for.
 *
 * Re-checks the capability rather than trusting that the tool was filtered out
 * of the list: the model chooses the name, and a model that hallucinates
 * `money_summary` at a Secretary must be refused, not obeyed.
 */
export async function runTool(
  name: string,
  args: Record<string, unknown>,
  admin: AdminContext,
): Promise<ToolOutcome> {
  const tool = ASSISTANT_TOOLS.find((candidate) => candidate.name === name);
  if (!tool) return { forModel: { error: `There is no tool called ${name}.` } };
  if (tool.capability && !admin.can(tool.capability)) {
    return { forModel: { error: `Your admin role does not cover ${tool.capability}.` } };
  }

  try {
    return await tool.run(args, admin);
  } catch (error) {
    console.error(`Assistant tool ${name} failed`, error);
    return { forModel: { error: "That lookup failed. Say so rather than guessing." } };
  }
}

/**
 * The shape of a group, without the group itself.
 *
 * Gives the model something true and useful to say about a cohort — "mostly
 * B1, mostly Lagos, between two and nine weeks unseen" — without handing it
 * rows it will try to count. Every number in here is computed here.
 */
function summarise(rows: StudentRow[]): Record<string, unknown> | undefined {
  if (rows.length === 0) return undefined;

  const tally = (pick: (row: StudentRow) => string | null | undefined) => {
    const counts: Record<string, number> = {};
    for (const row of rows) {
      const key = pick(row);
      if (key) counts[key] = (counts[key] ?? 0) + 1;
    }
    return Object.keys(counts).length ? counts : undefined;
  };

  const owed = rows.map((row) => row.owed).filter((value): value is number => typeof value === "number");
  const unseen = rows
    .map((row) => row.daysSinceSeen)
    .filter((value): value is number => typeof value === "number");
  const neverSeen = rows.filter((row) => row.daysSinceSeen === null).length;

  return {
    byLevel: tally((row) => row.level),
    byBranch: tally((row) => row.branch ?? "No branch"),
    byGoal: tally((row) => row.goal ?? "Not asked yet"),
    ...(owed.length
      ? {
          totalOwedNGN: owed.reduce((sum, value) => sum + value, 0),
          largestBalanceNGN: Math.max(...owed),
        }
      : {}),
    ...(unseen.length || neverSeen
      ? {
          longestUnseenDays: unseen.length ? Math.max(...unseen) : null,
          neverAttendedAtAll: neverSeen,
        }
      : {}),
  };
}

/** A human label for the cohort a filter set describes. */
export function describeFilters(filters: Filters): string {
  const parts: string[] = [];
  if (filters.branch) parts.push(filters.branch);
  if (filters.level) parts.push(filters.level);
  if (filters.status) parts.push(filters.status);
  if (filters.classType) parts.push(filters.classType);
  if (filters.deliveryMode) parts.push(filters.deliveryMode);
  if (filters.goal) parts.push(goalFor(filters.goal).label);
  if (filters.batch) parts.push(filters.batch);
  if (filters.paymentState) parts.push(`${filters.paymentState} tuition`);
  if (filters.notSeenForDays) parts.push(`not seen for ${filters.notSeenForDays}+ days`);
  if (filters.startedClasses === false) parts.push("not started classes");
  if (filters.startedClasses === true) parts.push("started classes");
  if (filters.registeredWithinDays) parts.push(`registered in last ${filters.registeredWithinDays} days`);
  if (filters.search) parts.push(`"${filters.search}"`);
  return parts.length ? parts.join(" · ") : "All students";
}
