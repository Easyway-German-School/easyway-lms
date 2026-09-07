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
import { derivePaymentStatus, receivedPaymentFilter, requiredDepositFor, tuitionFeeFor } from "@/lib/payment";
import { goalFor } from "@/lib/germany-goals";
import { LEVELS } from "@/lib/levels";
import { EMPLOYMENT_TYPE_LABELS, lecturerStatusLabel } from "@/lib/lecturer-status";
import { buildLedger } from "@/lib/finance/ledger";
import type { ToolSpec } from "@/lib/ollama";

/** Hard ceiling on rows returned to the model, whatever it asks for. */
const MAX_ROWS = 60;
/** Ceiling on rows returned to the BROWSER, which can render a real table. */
const MAX_TABLE_ROWS = 500;

const DAY = 86_400_000;

/* -------------------------------------------------------------------------- */
/* The shape of an answer                                                     */
/* -------------------------------------------------------------------------- */

/**
 * How usable a student's email address is.
 *
 *  - `ok`          a syntactically valid address that is not an obvious stand-in.
 *  - `placeholder` a stand-in the office never expects to reach: the importer's
 *                  minted `noemail.…@students.placeholder.…` address (see
 *                  api/admin/students/import/route.ts), an `@example.com`, an
 *                  `.invalid` / `.test` domain, a `noreply@` sender.
 *  - `invalid`     malformed — no `@`, no domain dot, a stray space, a double
 *                  dot, or a bare word like `nil` someone typed to clear a form.
 *  - `missing`     nothing on file at all.
 *
 * The office imports from spreadsheets whose email column is often blank, so a
 * large intake leaves a tail of `placeholder` / `missing` rows that have to be
 * chased for a real address — or a phone number — later. This is how the
 * assistant finds them again.
 */
export type EmailQuality = "ok" | "placeholder" | "invalid" | "missing";

export type StudentRow = {
  id: string;
  name: string;
  email: string;
  /** Always set. How reachable `email` is — see EmailQuality. */
  emailQuality: EmailQuality;
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
  /**
   * Best phone number on file — the typed `StudentProfile.phone`, then its
   * `whatsapp` / `altPhone`, then a number salvaged from the free-form
   * admission blob. Only present when the caller has `contact`; `null` means
   * the row was checked and no number was found anywhere.
   */
  phone?: string | null;
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
  /**
   * Filter on how reachable the email is. `"problem"` is the union of
   * placeholder + invalid + missing — "everyone whose email we can't use".
   */
  emailQuality?: EmailQuality | "problem";
  /** Only students with no phone number on file anywhere. Needs `contact`. */
  missingPhone?: boolean;
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
  const emailQuality = str("emailQuality")?.toLowerCase();

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
    emailQuality:
      emailQuality === "ok" ||
      emailQuality === "placeholder" ||
      emailQuality === "invalid" ||
      emailQuality === "missing" ||
      emailQuality === "problem"
        ? (emailQuality as Filters["emailQuality"])
        : undefined,
    missingPhone: bool("missingPhone"),
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
      { user: { name: { contains: filters.search, mode: "insensitive" } } },
      { user: { email: { contains: filters.search, mode: "insensitive" } } },
      { studentCode: { contains: filters.search, mode: "insensitive" } },
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
  const canSeeContact = admin.can("contact");

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
      pathway: true,
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
        ? { payments: { where: receivedPaymentFilter(), select: { amount: true } } }
        : {}),
      // Same rule for contact details: the typed phone fields plus the raw
      // admission blob (an older intake path only wrote the number there).
      ...(canSeeContact
        ? {
            profile: { select: { phone: true, altPhone: true, whatsapp: true } },
            admission: true,
          }
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
    const email = student.user?.email ?? "";
    const row: StudentRow = {
      id: student.id,
      name: student.user?.name ?? "(no name)",
      email,
      emailQuality: classifyEmail(email),
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

    if (canSeeContact) {
      const profile = (student as {
        profile?: { phone: string | null; altPhone: string | null; whatsapp: string | null } | null;
      }).profile;
      const admission = (student as { admission?: unknown }).admission;
      row.phone =
        profile?.phone?.trim() ||
        profile?.whatsapp?.trim() ||
        profile?.altPhone?.trim() ||
        phoneFromAdmission(admission) ||
        null;
    }

    if (canSeeMoney) {
      const payments = (student as { payments?: Array<{ amount: number }> }).payments ?? [];
      const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
      const lookup = { level: student.level, branch: student.branch?.name ?? null, classType: student.classType, pathway: student.pathway };
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

  if (filters.emailQuality) {
    // Email is on every row already, so this needs no extra capability — it is
    // a fact about a field the caller can see, not a new field.
    result = result.filter((row) =>
      filters.emailQuality === "problem"
        ? row.emailQuality !== "ok"
        : row.emailQuality === filters.emailQuality,
    );
  }

  if (filters.missingPhone) {
    if (!admin.can("contact")) return [];
    result = result.filter((row) => !row.phone);
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
  emailQuality: {
    type: "string",
    enum: ["problem", "placeholder", "invalid", "missing", "ok"],
    description:
      "Filter by how usable the student's email is. 'placeholder' = a stand-in address the importer minted for a spreadsheet row that had no email; 'invalid' = malformed (no @, a typo, a bare word); 'missing' = none on file; 'problem' = any of those three. Use 'problem' for 'students with a wrong or template email' and pair it with missingPhone or the contact details to find who has to be chased another way.",
  },
  missingPhone: {
    type: "boolean",
    description:
      "true = only students with no phone number on file anywhere. Needs the contact capability. Combine with emailQuality:'problem' to find students with no working way to reach them.",
  },
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
              enum: ["level", "branch", "status", "goal", "paymentState", "deliveryMode", "emailQuality"],
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
           *
           * The contact variant exists because "give me their phone numbers" is
           * a real request and the honest answer is "they are in the table, use
           * Export CSV" — not the model reading three of sixty numbers aloud and
           * stopping.
           */
          how_to_answer:
            rows.length === 0
              ? "no_matches__say_so_and_suggest_loosening_one_filter"
              : rows.some((row) => row.phone !== undefined)
                ? "state_matched_number__then_say_the_contact_details_are_in_the_table_below_and_the_admin_can_Export_CSV__never_list_them"
                : "state_matched_number__then_describe_group_from_breakdown__never_list_names",
          filtersApplied: filters,
          breakdown: summarise(rows),
          examples_only_never_count_these: rows.slice(0, 3).map((row) => ({
            name: row.name,
            level: row.level,
            branch: row.branch,
            ...(row.emailQuality !== "ok" ? { emailQuality: row.emailQuality } : {}),
            ...(row.phone !== undefined ? { phone: row.phone ?? "(none on file)" } : {}),
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
          "List the real values you can filter on: branch names, batches, levels, tutor names, course names, upcoming exam names, community rooms. Call this FIRST whenever the admin names a campus, batch, tutor, course or exam, so you filter on a real value instead of guessing at the spelling.",
        parameters: { type: "object", properties: {} },
      },
    },
    async run(_args, admin) {
      const [branches, batches, tutors, courses, exams, spaces] = await Promise.all([
        prisma.branch.findMany({ select: { name: true, mode: true }, orderBy: { name: "asc" } }),
        prisma.student.findMany({ select: { admission: true }, take: 400 }),
        admin.can("staff") || admin.can("classes")
          ? prisma.lecturer.findMany({
              where: { user: { name: { not: null } } },
              select: { user: { select: { name: true } } },
              orderBy: { user: { name: "asc" } },
              take: 200,
            })
          : Promise.resolve([]),
        prisma.course.findMany({ select: { title: true }, orderBy: { title: "asc" }, take: 200 }),
        admin.can("exams")
          ? prisma.exam.findMany({
              where: { examDate: { gte: new Date() } },
              select: { name: true, examDate: true },
              orderBy: { examDate: "asc" },
              take: 50,
            })
          : Promise.resolve([]),
        admin.can("community")
          ? prisma.space.findMany({ select: { name: true }, orderBy: { name: "asc" }, take: 100 })
          : Promise.resolve([]),
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
          tutors: tutors.map((t) => t.user?.name).filter(Boolean),
          courses: courses.map((c) => c.title),
          upcomingExams: exams.map((e) => `${e.name} (${e.examDate.toISOString().slice(0, 10)})`),
          communityRooms: spaces.map((s) => s.name),
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
          where: { ...receivedPaymentFilter(), createdAt: { gte: monthStart } },
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

  /* ======================================================================== */
  /* EXPANDED READ COVERAGE                                                    */
  /*                                                                          */
  /* One tool per office domain, so "I don't have access to that" only ever   */
  /* means "your admin role does not cover it" — never "nobody built it".     */
  /* Every tool is capability-gated (checked here AND in runTool), computes    */
  /* every figure server-side, and hands the model counts + breakdowns rather */
  /* than rows it would try to re-count. Student-shaped results still return a */
  /* `cohort` for the browser table; entity lists (classes, tutors) go to the */
  /* model as a bounded array WITH a precomputed total it is told not to sum.  */
  /* ======================================================================== */

  /* ---- Classes & timetable -------------------------------------------- */

  {
    name: "class_summary",
    capability: "classes",
    spec: {
      type: "function",
      function: {
        name: "class_summary",
        description:
          "How many classes the school runs and how full they are. A class here is one branch + level + sitting of active group students. Returns total classes, total students in classes, average / smallest / largest class size, an optional breakdown, and how many timetabled sessions are coming up. Use this for 'how many classes' and 'how many students per class'.",
        parameters: {
          type: "object",
          properties: {
            branch: FILTER_PROPERTIES.branch,
            level: FILTER_PROPERTIES.level,
            groupBy: {
              type: "string",
              enum: ["branch", "level", "sitting", "tutor"],
              description: "Optional. Also return student counts broken down this way.",
            },
          },
        },
      },
    },
    async run(args, admin) {
      const branch = argStr(args, "branch");
      const level = argStr(args, "level")?.toUpperCase();
      const students = await prisma.student.findMany({
        where: {
          status: "active",
          classType: "group",
          ...(level ? { level } : {}),
          ...(branch ? { branch: { name: { equals: branch, mode: "insensitive" } } } : {}),
        },
        select: {
          level: true,
          sessionSlot: true,
          branch: { select: { name: true } },
          tutor: { select: { user: { select: { name: true } } } },
        },
      });

      const classKey = (s: (typeof students)[number]) =>
        `${s.branch?.name ?? "No branch"} · ${s.level} · ${s.sessionSlot}`;
      const perClass = countByKey(students, classKey);
      const sizes = Object.values(perClass);

      const groupBy = argStr(args, "groupBy");
      const breakdown =
        groupBy === "branch"
          ? countByKey(students, (s) => s.branch?.name ?? "No branch")
          : groupBy === "level"
            ? countByKey(students, (s) => s.level)
            : groupBy === "sitting"
              ? countByKey(students, (s) => s.sessionSlot)
              : groupBy === "tutor"
                ? countByKey(students, (s) => s.tutor?.user?.name ?? "Unassigned")
                : undefined;

      const upcomingSessions = await prisma.classSession.count({
        where: { date: { gte: new Date(), lte: offsetDays(7) }, status: { not: "cancelled" } },
      });

      return {
        forModel: {
          how_to_answer:
            "state_totalClasses_and_studentsInClasses__then_use_the_breakdown__do_not_add_the_breakdown_up_yourself",
          totalClasses: sizes.length,
          studentsInClasses: students.length,
          averageClassSize: roundAvg(students.length, sizes.length),
          smallestClass: sizes.length ? Math.min(...sizes) : 0,
          largestClass: sizes.length ? Math.max(...sizes) : 0,
          breakdown,
          timetabledSessionsNext7Days: upcomingSessions,
          scope: { branch: branch ?? "all branches", level: level ?? "all levels" },
        },
      };
    },
  },

  {
    name: "find_classes",
    capability: "classes",
    spec: {
      type: "function",
      function: {
        name: "find_classes",
        description:
          "List every class (branch + level + sitting of active group students) with its student count and main tutor. Use when the admin wants to see the classes themselves rather than a headline number.",
        parameters: {
          type: "object",
          properties: { branch: FILTER_PROPERTIES.branch, level: FILTER_PROPERTIES.level },
        },
      },
    },
    async run(args, admin) {
      const branch = argStr(args, "branch");
      const level = argStr(args, "level")?.toUpperCase();
      const students = await prisma.student.findMany({
        where: {
          status: "active",
          classType: "group",
          ...(level ? { level } : {}),
          ...(branch ? { branch: { name: { equals: branch, mode: "insensitive" } } } : {}),
        },
        select: {
          level: true,
          sessionSlot: true,
          branch: { select: { name: true } },
          tutor: { select: { user: { select: { name: true } } } },
        },
      });

      const classes = new Map<
        string,
        { branch: string; level: string; sitting: string; students: number; tutors: Record<string, number> }
      >();
      for (const s of students) {
        const branchName = s.branch?.name ?? "No branch";
        const key = `${branchName} · ${s.level} · ${s.sessionSlot}`;
        let cls = classes.get(key);
        if (!cls) {
          cls = { branch: branchName, level: s.level, sitting: s.sessionSlot, students: 0, tutors: {} };
          classes.set(key, cls);
        }
        cls.students += 1;
        const tutor = s.tutor?.user?.name;
        if (tutor) cls.tutors[tutor] = (cls.tutors[tutor] ?? 0) + 1;
      }

      const rows = [...classes.values()]
        .sort((a, b) => b.students - a.students)
        .slice(0, 60)
        .map((c) => ({
          class: `${c.branch} · ${c.level} · ${c.sitting}`,
          students: c.students,
          tutor: topEntry(c.tutors)?.key ?? "Unassigned",
        }));

      return {
        forModel: {
          how_to_answer:
            "state_totalClasses_and_studentsInClasses__then_list_each_class_with_its_given_count__never_recompute_a_total",
          totalClasses: classes.size,
          studentsInClasses: students.length,
          classes: rows,
        },
      };
    },
  },

  {
    name: "schedule_lookup",
    capability: "classes",
    spec: {
      type: "function",
      function: {
        name: "schedule_lookup",
        description:
          "The timetable over a window: how many group class sessions and private (1:1) sessions are scheduled, broken down by status, branch and level, plus any school holidays in the window and any private sessions with an unresolved change request.",
        parameters: {
          type: "object",
          properties: {
            days: { type: "number", description: "Window size in days. Default 14." },
            branch: FILTER_PROPERTIES.branch,
            direction: {
              type: "string",
              enum: ["upcoming", "past"],
              description: "Look forward from today (default) or back over the last N days.",
            },
          },
        },
      },
    },
    async run(args) {
      const days = windowDays(args, 14, 120);
      const past = argStr(args, "direction") === "past";
      const now = new Date();
      const from = past ? offsetDays(-days) : now;
      const to = past ? now : offsetDays(days);
      const branch = argStr(args, "branch");

      const [sessions, privates, holidays] = await Promise.all([
        prisma.classSession.findMany({
          where: {
            date: { gte: from, lte: to },
            ...(branch ? { branch: { name: { equals: branch, mode: "insensitive" } } } : {}),
          },
          select: { status: true, level: true, timeSlot: true, branch: { select: { name: true } } },
        }),
        prisma.privateClass.findMany({
          where: { scheduledAt: { gte: from, lte: to } },
          select: { status: true },
        }),
        prisma.schoolHoliday.findMany({
          where: { date: { gte: from, lte: to } },
          select: { label: true, date: true, branch: { select: { name: true } } },
        }),
      ]);

      const pendingRequests = privates.filter((p) =>
        ["requested", "reschedule_requested", "cancel_requested"].includes(p.status),
      ).length;

      return {
        forModel: {
          windowDays: days,
          direction: past ? "past" : "upcoming",
          groupSessions: {
            total: sessions.length,
            byStatus: countByKey(sessions, (s) => s.status),
            byBranch: countByKey(sessions, (s) => s.branch?.name ?? "No branch"),
            byLevel: countByKey(sessions, (s) => s.level),
          },
          privateSessions: {
            total: privates.length,
            byStatus: countByKey(privates, (p) => p.status),
            unresolvedChangeRequests: pendingRequests,
          },
          holidays: holidays.slice(0, 20).map((h) => ({
            label: h.label,
            date: h.date.toISOString().slice(0, 10),
            branch: h.branch?.name ?? "All branches",
          })),
        },
      };
    },
  },

  /* ---- Staff ---------------------------------------------------------- */

  {
    name: "staff_summary",
    capability: "staff",
    spec: {
      type: "function",
      function: {
        name: "staff_summary",
        description:
          "The teaching staff at a glance: how many tutors, broken down by employment status (active / probation / on leave / inactive), employment type and primary branch, plus how many have no class assignment and how many started this month.",
        parameters: { type: "object", properties: {} },
      },
    },
    async run(_args, admin) {
      const tutors = await prisma.lecturer.findMany({
        select: {
          status: true,
          employmentType: true,
          startedAt: true,
          branch: { select: { name: true } },
          levels: true,
          branchIds: true,
          payRate: { select: { id: true } },
        },
      });
      const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
      const unassigned = tutors.filter((t) => {
        const levels = Array.isArray(t.levels) ? t.levels : [];
        const branchIds = Array.isArray(t.branchIds) ? t.branchIds : [];
        return levels.length === 0 && branchIds.length === 0 && !t.branch;
      }).length;

      return {
        forModel: {
          total: tutors.length,
          byStatus: countByKey(tutors, (t) => lecturerStatusLabel(t.status)),
          byEmploymentType: countByKey(tutors, (t) =>
            t.employmentType
              ? (EMPLOYMENT_TYPE_LABELS as Record<string, string>)[t.employmentType] ?? t.employmentType
              : "Unrecorded",
          ),
          byBranch: countByKey(tutors, (t) => t.branch?.name ?? "No primary branch"),
          unassigned,
          startedThisMonth: tutors.filter((t) => t.startedAt && t.startedAt >= monthStart).length,
          ...(admin.can("payroll")
            ? { withNoPayRateOnFile: tutors.filter((t) => !t.payRate).length }
            : {}),
        },
      };
    },
  },

  {
    name: "find_tutors",
    capability: "staff",
    spec: {
      type: "function",
      function: {
        name: "find_tutors",
        description:
          "List tutors with their status, branch, levels and how many students each carries. Filter by status, branch or level.",
        parameters: {
          type: "object",
          properties: {
            status: { type: "string", enum: ["active", "probation", "on_leave", "inactive"] },
            branch: FILTER_PROPERTIES.branch,
            level: FILTER_PROPERTIES.level,
          },
        },
      },
    },
    async run(args) {
      const status = argStr(args, "status")?.toLowerCase();
      const branch = argStr(args, "branch")?.toLowerCase();
      const level = argStr(args, "level")?.toUpperCase();

      const tutors = await prisma.lecturer.findMany({
        select: {
          status: true,
          employmentType: true,
          level: true,
          levels: true,
          branch: { select: { name: true } },
          user: { select: { name: true, email: true } },
          _count: { select: { students: true } },
        },
        orderBy: { user: { name: "asc" } },
      });

      let rows = tutors;
      if (status) rows = rows.filter((t) => (t.status || "active") === status);
      if (branch) rows = rows.filter((t) => t.branch?.name?.toLowerCase() === branch);
      if (level)
        rows = rows.filter((t) => {
          const levels = Array.isArray(t.levels) ? t.levels.map(String) : [];
          return levels.includes(level) || t.level === level;
        });

      return {
        forModel: {
          how_to_answer: "state_totalTutors__then_describe_by_status_and_load__never_invent_a_number",
          totalTutors: rows.length,
          byStatus: countByKey(rows, (t) => lecturerStatusLabel(t.status)),
          tutors: rows.slice(0, 60).map((t) => ({
            name: t.user?.name ?? t.user?.email ?? "Unnamed",
            status: lecturerStatusLabel(t.status),
            branch: t.branch?.name ?? null,
            levels: Array.isArray(t.levels) && t.levels.length ? t.levels : [t.level].filter(Boolean),
            students: t._count.students,
            employmentType: t.employmentType ?? null,
          })),
        },
      };
    },
  },

  {
    name: "tutor_workload",
    capability: "staff",
    spec: {
      type: "function",
      function: {
        name: "tutor_workload",
        description:
          "What each tutor is actually carrying: assigned students, assignments set, class sessions held in the last 30 days, and student papers still waiting for their marking. Name one tutor with `search`, or omit it for the busiest.",
        parameters: {
          type: "object",
          properties: { search: { type: "string", description: "Tutor name to narrow to." } },
        },
      },
    },
    async run(args) {
      const search = argStr(args, "search");
      const tutors = await prisma.lecturer.findMany({
        where: search ? { user: { name: { contains: search, mode: "insensitive" } } } : {},
        select: {
          id: true,
          status: true,
          user: { select: { name: true } },
          _count: { select: { students: true, assignments: true } },
        },
      });

      const ids = tutors.map((t) => t.id);
      const heldSince = offsetDays(-30);
      const [heldSessions, needsReview] = await Promise.all([
        prisma.classSession.groupBy({
          by: ["lecturerId"],
          where: { lecturerId: { in: ids }, status: "held", date: { gte: heldSince } },
          _count: { _all: true },
        }),
        prisma.assignmentSubmission.findMany({
          where: { needsReview: true, assignment: { lecturerId: { in: ids } } },
          select: { assignment: { select: { lecturerId: true } } },
        }),
      ]);
      const heldByTutor = new Map(heldSessions.map((r) => [r.lecturerId, r._count._all]));
      const reviewByTutor = countByKey(needsReview, (r) => r.assignment?.lecturerId ?? "");

      const rows = tutors
        .map((t) => ({
          name: t.user?.name ?? "Unnamed",
          status: lecturerStatusLabel(t.status),
          students: t._count.students,
          assignmentsSet: t._count.assignments,
          sessionsHeldLast30Days: heldByTutor.get(t.id) ?? 0,
          papersAwaitingTheirMarking: reviewByTutor[t.id] ?? 0,
        }))
        .sort((a, b) => b.students - a.students);

      return {
        forModel: {
          how_to_answer: "report_the_named_tutor_or_the_top_few__figures_are_given_do_not_estimate",
          matched: rows.length,
          tutors: search ? rows.slice(0, 20) : rows.slice(0, 10),
        },
      };
    },
  },

  /* ---- Money (extends money_summary) --------------------------------- */

  {
    name: "payment_activity",
    capability: "payments",
    spec: {
      type: "function",
      function: {
        name: "payment_activity",
        description:
          "Tuition actually received over a recent window: how many payments, total naira, by method, by branch, biggest single payment, and how that compares with the previous window of the same length. For 'what did we collect this week / today'.",
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
      const days = windowDays(args, 7, 180);
      const now = new Date();
      const windowStart = offsetDays(-days);
      const priorStart = offsetDays(-days * 2);
      const branch = argStr(args, "branch");

      const payments = await prisma.payment.findMany({
        where: {
          ...receivedPaymentFilter(),
          createdAt: { gte: priorStart, lte: now },
          ...(branch
            ? { student: { branch: { name: { equals: branch, mode: "insensitive" } } } }
            : {}),
        },
        select: {
          amount: true,
          method: true,
          createdAt: true,
          paymentIntentId: true,
          stripeSessionId: true,
          student: { select: { branch: { select: { name: true } } } },
        },
      });

      const inWindow = payments.filter((p) => p.createdAt >= windowStart);
      const prior = payments.filter((p) => p.createdAt < windowStart);
      const sum = (rows: typeof payments) => rows.reduce((t, p) => t + (p.amount ?? 0), 0);

      return {
        forModel: {
          currency: "NGN",
          windowDays: days,
          payments: inWindow.length,
          totalReceived: sum(inWindow),
          byMethod: countByKey(inWindow, (p) => p.method || "unknown"),
          byBranch: countByKey(inWindow, (p) => p.student?.branch?.name ?? "No branch"),
          throughGateway: inWindow.filter((p) => p.paymentIntentId || p.stripeSessionId).length,
          biggestSingle: inWindow.reduce((m, p) => Math.max(m, p.amount ?? 0), 0),
          previousWindow: { payments: prior.length, totalReceived: sum(prior) },
        },
      };
    },
  },

  {
    name: "payment_plans_summary",
    capability: "payments",
    spec: {
      type: "function",
      function: {
        name: "payment_plans_summary",
        description:
          "Negotiated instalment plans: how many are active, completed, defaulted or cancelled, how many students are on one, and how many active plans have an instalment that is overdue right now.",
        parameters: { type: "object", properties: {} },
      },
    },
    async run() {
      const plans = await prisma.paymentPlan.findMany({
        select: { status: true, studentId: true, installments: true, graceDays: true },
      });
      const now = Date.now();
      let overdue = 0;
      for (const plan of plans) {
        if (plan.status !== "active") continue;
        const installments = Array.isArray(plan.installments)
          ? (plan.installments as Array<{ dueOn?: string; paidAt?: string }>)
          : [];
        const grace = (plan.graceDays ?? 3) * DAY;
        const hasOverdue = installments.some(
          (i) => !i.paidAt && i.dueOn && new Date(i.dueOn).getTime() + grace < now,
        );
        if (hasOverdue) overdue += 1;
      }

      return {
        forModel: {
          totalPlans: plans.length,
          byStatus: countByKey(plans, (p) => p.status),
          studentsOnAPlan: new Set(plans.filter((p) => p.status === "active").map((p) => p.studentId)).size,
          activePlansWithAnOverdueInstalment: overdue,
        },
      };
    },
  },

  {
    name: "refunds_summary",
    capability: "payments",
    spec: {
      type: "function",
      function: {
        name: "refunds_summary",
        description:
          "Refund requests: how many at each stage (submitted / under review / approved / rejected / paid), the total amount requested versus approved, how old the oldest still-open request is, and how many were decided this month.",
        parameters: { type: "object", properties: {} },
      },
    },
    async run() {
      const requests = await prisma.refundRequest.findMany({
        select: {
          status: true,
          requestedAmount: true,
          decisionAmount: true,
          createdAt: true,
          decidedAt: true,
        },
      });
      const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
      const open = requests.filter((r) => ["submitted", "under_review"].includes(r.status));
      const oldestOpen = open.reduce<Date | null>(
        (m, r) => (!m || r.createdAt < m ? r.createdAt : m),
        null,
      );

      return {
        forModel: {
          currency: "NGN",
          total: requests.length,
          byStatus: countByKey(requests, (r) => r.status),
          totalRequested: requests.reduce((t, r) => t + (r.requestedAmount ?? 0), 0),
          totalApproved: requests.reduce((t, r) => t + (r.decisionAmount ?? 0), 0),
          oldestOpenAgeDays: oldestOpen
            ? Math.floor((Date.now() - oldestOpen.getTime()) / DAY)
            : null,
          decidedThisMonth: requests.filter((r) => r.decidedAt && r.decidedAt >= monthStart).length,
        },
      };
    },
  },

  /* ---- Exams (extends the briefing) --------------------------------- */

  {
    name: "exam_summary",
    capability: "exams",
    spec: {
      type: "function",
      function: {
        name: "exam_summary",
        description:
          "Exams and sittings: what is coming up (name, date, level, body, branch, how many registered, how many unpaid), which mock exams have marks entered but results not yet released, and the average score across sittings held in the last 30 days.",
        parameters: { type: "object", properties: {} },
      },
    },
    async run() {
      const now = new Date();
      const [upcoming, mocks, recentGrades] = await Promise.all([
        prisma.exam.findMany({
          where: { examDate: { gte: now } },
          orderBy: { examDate: "asc" },
          take: 30,
          select: {
            name: true,
            examDate: true,
            level: true,
            examBody: true,
            branch: { select: { name: true } },
            _count: { select: { registrations: true } },
            registrations: { where: { paymentStatus: "unpaid" }, select: { id: true } },
          },
        }),
        prisma.exam.findMany({
          where: { kind: "mock", resultsReleased: false },
          select: { name: true, examDate: true, level: true, _count: { select: { grades: true } } },
        }),
        prisma.grade.findMany({
          where: { type: "exam", exam: { examDate: { gte: offsetDays(-30), lte: now } } },
          select: { score: true },
        }),
      ]);

      return {
        forModel: {
          upcoming: upcoming.map((e) => ({
            name: e.name,
            date: e.examDate.toISOString().slice(0, 10),
            level: e.level ?? "any",
            body: e.examBody,
            branch: e.branch?.name ?? "All branches",
            registered: e._count.registrations,
            unpaid: e.registrations.length,
          })),
          mocksAwaitingResultRelease: mocks
            .filter((m) => m._count.grades > 0)
            .map((m) => ({
              name: m.name,
              level: m.level ?? "any",
              date: m.examDate.toISOString().slice(0, 10),
              marksEntered: m._count.grades,
            })),
          sittingsLast30Days: recentGrades.length,
          averageScoreLast30Days: recentGrades.length
            ? Math.round(recentGrades.reduce((t, g) => t + (g.score ?? 0), 0) / recentGrades.length)
            : null,
        },
      };
    },
  },

  {
    name: "find_exam_registrations",
    capability: "exams",
    spec: {
      type: "function",
      function: {
        name: "find_exam_registrations",
        description:
          "Registrations for one exam — named with `search`, or the next sitting if omitted. Returns counts by payment status, level and branch.",
        parameters: {
          type: "object",
          properties: { search: { type: "string", description: "Exam name to match." } },
        },
      },
    },
    async run(args) {
      const search = argStr(args, "search");
      const exam = search
        ? await prisma.exam.findFirst({
            where: { name: { contains: search, mode: "insensitive" } },
            orderBy: { examDate: "desc" },
            select: { id: true, name: true, examDate: true },
          })
        : await prisma.exam.findFirst({
            where: { examDate: { gte: new Date() } },
            orderBy: { examDate: "asc" },
            select: { id: true, name: true, examDate: true },
          });

      if (!exam) return { forModel: { error: "No matching exam found. Try list_options for the names." } };

      const registrations = await prisma.examRegistration.findMany({
        where: { examId: exam.id },
        select: {
          status: true,
          paymentStatus: true,
          student: { select: { level: true, branch: { select: { name: true } } } },
        },
      });

      return {
        forModel: {
          how_to_answer: "name_the_exam_and_the_total__then_the_payment_split__figures_are_given",
          exam: exam.name,
          date: exam.examDate.toISOString().slice(0, 10),
          totalRegistrations: registrations.length,
          byPaymentStatus: countByKey(registrations, (r) => r.paymentStatus),
          byStatus: countByKey(registrations, (r) => r.status),
          byLevel: countByKey(registrations, (r) => r.student?.level ?? "external candidate"),
          byBranch: countByKey(registrations, (r) => r.student?.branch?.name ?? "external candidate"),
        },
      };
    },
  },

  /* ---- Help desk --------------------------------------------------- */

  {
    name: "support_summary",
    capability: "students",
    spec: {
      type: "function",
      function: {
        name: "support_summary",
        description:
          "The help desk queue: how many tickets are open, pending or resolved, broken down by topic, how many are unassigned, how old the oldest unanswered ticket is, and how many were resolved this week.",
        parameters: { type: "object", properties: {} },
      },
    },
    async run() {
      const tickets = await prisma.supportTicket.findMany({
        select: {
          status: true,
          topic: true,
          assignedToId: true,
          unreadForAdmin: true,
          createdAt: true,
          resolvedAt: true,
        },
      });
      const weekAgo = offsetDays(-7);
      const unanswered = tickets.filter((t) => t.status !== "resolved" && t.unreadForAdmin);
      const oldestUnanswered = unanswered.reduce<Date | null>(
        (m, t) => (!m || t.createdAt < m ? t.createdAt : m),
        null,
      );

      return {
        forModel: {
          total: tickets.length,
          byStatus: countByKey(tickets, (t) => t.status),
          byTopic: countByKey(tickets, (t) => t.topic),
          openUnassigned: tickets.filter((t) => t.status !== "resolved" && !t.assignedToId).length,
          awaitingAReply: unanswered.length,
          oldestUnansweredAgeDays: oldestUnanswered
            ? Math.floor((Date.now() - oldestUnanswered.getTime()) / DAY)
            : null,
          resolvedThisWeek: tickets.filter((t) => t.resolvedAt && t.resolvedAt >= weekAgo).length,
        },
      };
    },
  },

  /* ---- Leads (detailed sibling of enquiry_summary) --------------- */

  {
    name: "leads_pipeline",
    capability: "students",
    spec: {
      type: "function",
      function: {
        name: "leads_pipeline",
        description:
          "The enrolment funnel in detail: leads by status, by source, by branch and by level of interest; the conversion rate over the window; and how old the oldest untouched enquiry is.",
        parameters: {
          type: "object",
          properties: { days: { type: "number", description: "Window in days. Default 30." } },
        },
      },
    },
    async run(args) {
      const days = windowDays(args, 30, 365);
      const since = offsetDays(-days);
      const leads = await prisma.lead.findMany({
        select: {
          status: true,
          source: true,
          interestedLevel: true,
          createdAt: true,
          convertedAt: true,
          branch: { select: { name: true } },
        },
      });
      const inWindow = leads.filter((l) => l.createdAt >= since);
      const convertedInWindow = leads.filter((l) => l.convertedAt && l.convertedAt >= since).length;
      const untouched = leads.filter((l) => l.status === "new");
      const oldestUntouched = untouched.reduce<Date | null>(
        (m, l) => (!m || l.createdAt < m ? l.createdAt : m),
        null,
      );

      return {
        forModel: {
          windowDays: days,
          totalLeads: leads.length,
          newInWindow: inWindow.length,
          convertedInWindow,
          conversionRatePercent: inWindow.length
            ? Math.round((convertedInWindow / inWindow.length) * 100)
            : null,
          byStatus: countByKey(leads, (l) => l.status),
          bySource: countByKey(leads, (l) => l.source || "unknown"),
          byBranch: countByKey(leads, (l) => l.branch?.name ?? "No branch"),
          byLevelOfInterest: countByKey(leads, (l) => l.interestedLevel ?? "unspecified"),
          untouchedEnquiries: untouched.length,
          oldestUntouchedAgeDays: oldestUntouched
            ? Math.floor((Date.now() - oldestUntouched.getTime()) / DAY)
            : null,
        },
      };
    },
  },

  /* ---- Roster hygiene ------------------------------------------- */

  {
    name: "roster_health",
    capability: "students",
    spec: {
      type: "function",
      function: {
        name: "roster_health",
        description:
          "Gaps in the student records the office should tidy: missing passport photo, missing home location, not yet started classes, no tutor assigned, or deliberately held back. Returns a count for each gap and the list of students behind the one you name.",
        parameters: {
          type: "object",
          properties: {
            gap: {
              type: "string",
              enum: ["no_photo", "no_location", "not_started", "no_tutor", "held_back"],
              description: "Which gap to return the student list for. Defaults to the largest.",
            },
          },
        },
      },
    },
    async run(args) {
      const students = await prisma.student.findMany({
        where: { status: "active" },
        select: {
          id: true,
          studentCode: true,
          level: true,
          status: true,
          classType: true,
          deliveryMode: true,
          germanyGoal: true,
          classesStartedAt: true,
          tutorId: true,
          heldBackAt: true,
          createdAt: true,
          branch: { select: { name: true } },
          user: { select: { name: true, email: true } },
          profile: { select: { photoUrl: true, city: true, country: true } },
        },
      });

      const gaps: Record<string, (typeof students)[number][]> = {
        no_photo: students.filter((s) => !s.profile?.photoUrl),
        no_location: students.filter((s) => !s.profile?.city && !s.profile?.country),
        not_started: students.filter((s) => !s.classesStartedAt),
        no_tutor: students.filter((s) => !s.tutorId),
        held_back: students.filter((s) => s.heldBackAt),
      };

      const counts = Object.fromEntries(Object.entries(gaps).map(([k, v]) => [k, v.length]));
      const chosen =
        argStr(args, "gap") && gaps[argStr(args, "gap")!]
          ? argStr(args, "gap")!
          : (topEntry(counts as Record<string, number>)?.key ?? "no_photo");

      const rows: StudentRow[] = gaps[chosen].slice(0, MAX_TABLE_ROWS).map(basicStudentRow);

      return {
        forModel: {
          how_to_answer: "give_each_gap_count__then_focus_on_the_one_being_shown__never_list_names",
          gapCounts: counts,
          showing: chosen,
        },
        cohort: { label: `Roster gap: ${chosen.replace(/_/g, " ")}`, rows, truncated: rows.length >= MAX_TABLE_ROWS },
      };
    },
  },

  /* ---- Tuition ledger (per-level arrears) ---------------------- */

  {
    name: "tuition_ledger_summary",
    capability: "payments",
    spec: {
      type: "function",
      function: {
        name: "tuition_ledger_summary",
        description:
          "The per-level tuition ledger: for each CEFR level, how much has been charged (net of scholarships), how much collected, and how much is still outstanding — plus how many students carry an unsettled charge from a level they have already passed. Narrow with `level` or `branch`.",
        parameters: {
          type: "object",
          properties: { level: FILTER_PROPERTIES.level, branch: FILTER_PROPERTIES.branch },
        },
      },
    },
    async run(args) {
      const level = argStr(args, "level")?.toUpperCase();
      const branch = argStr(args, "branch");
      const students = await prisma.student.findMany({
        where: {
          ...(level ? { tuitionCharges: { some: { level } } } : { tuitionCharges: { some: {} } }),
          ...(branch ? { branch: { name: { equals: branch, mode: "insensitive" } } } : {}),
        },
        select: {
          tuitionCharges: {
            select: {
              id: true,
              level: true,
              amount: true,
              waivedAmount: true,
              legacyArrears: true,
              createdAt: true,
              settledAt: true,
            },
          },
          payments: { where: receivedPaymentFilter(), select: { amount: true } },
        },
      });

      const byLevel: Record<string, { charged: number; outstanding: number; legacyOutstanding: number }> = {};
      let studentsWithGoForwardArrears = 0;
      let totalOutstanding = 0;
      for (const student of students) {
        const paid = student.payments.reduce((t, p) => t + (p.amount ?? 0), 0);
        const ledger = buildLedger(student.tuitionCharges, paid);
        for (const line of ledger.lines) {
          const bucket = (byLevel[line.level] ??= { charged: 0, outstanding: 0, legacyOutstanding: 0 });
          bucket.charged += line.net;
          bucket.outstanding += line.outstanding;
          if (line.legacyArrears) bucket.legacyOutstanding += line.outstanding;
        }
        totalOutstanding += ledger.lifetimeOutstanding;
        if (ledger.goForwardOutstanding > 0) studentsWithGoForwardArrears += 1;
      }

      return {
        forModel: {
          currency: "NGN",
          studentsWithCharges: students.length,
          byLevel,
          totalOutstanding,
          studentsWithGoForwardArrears,
          scope: { level: level ?? "all levels", branch: branch ?? "all branches" },
        },
      };
    },
  },

  /* ---- Payroll (money going OUT to tutors) -------------------- */

  {
    name: "payroll_summary",
    capability: "payroll",
    spec: {
      type: "function",
      function: {
        name: "payroll_summary",
        description:
          "What the school pays its tutors: how many are on a per-class rate versus a monthly rate, the estimated monthly wage commitment, how much has actually been paid out this month and all time, and how many tutors have no rate on file.",
        parameters: { type: "object", properties: {} },
      },
    },
    async run() {
      const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
      const [rates, payments, tutorCount, heldLast30] = await Promise.all([
        prisma.tutorPayRate.findMany({ select: { rateType: true, amount: true, lecturerId: true } }),
        prisma.payrollPayment.findMany({ select: { amount: true, paidAt: true } }),
        prisma.lecturer.count(),
        prisma.classSession.groupBy({
          by: ["lecturerId"],
          where: { status: "held", date: { gte: offsetDays(-30) } },
          _count: true,
        }),
      ]);

      const heldByTutor = new Map(heldLast30.map((r) => [r.lecturerId, r._count]));
      let monthlyCommitment = 0;
      for (const rate of rates) {
        if (rate.rateType === "monthly") monthlyCommitment += rate.amount;
        else monthlyCommitment += rate.amount * (heldByTutor.get(rate.lecturerId) ?? 0);
      }

      return {
        forModel: {
          currency: "NGN",
          tutorsTotal: tutorCount,
          ratesOnFile: rates.length,
          perClassRates: rates.filter((r) => r.rateType !== "monthly").length,
          monthlyRates: rates.filter((r) => r.rateType === "monthly").length,
          tutorsWithNoRate: Math.max(0, tutorCount - new Set(rates.map((r) => r.lecturerId)).size),
          estimatedMonthlyCommitment: monthlyCommitment,
          paidThisMonth: payments
            .filter((p) => p.paidAt >= monthStart)
            .reduce((t, p) => t + (p.amount ?? 0), 0),
          paidAllTime: payments.reduce((t, p) => t + (p.amount ?? 0), 0),
        },
      };
    },
  },

  /* ---- Academic results ------------------------------------- */

  {
    name: "academic_summary",
    capability: "reports",
    spec: {
      type: "function",
      function: {
        name: "academic_summary",
        description:
          "How students are doing: average score by level, the pass rate at a threshold, how many scored below it, the size of the tutor marking queue, how many students graduated this month, and how many certificates have been issued (achievement vs completion, and how many carry a provisional stamp for an unpaid balance).",
        parameters: {
          type: "object",
          properties: {
            level: FILTER_PROPERTIES.level,
            threshold: { type: "number", description: "Pass mark. Default 60." },
          },
        },
      },
    },
    async run(args) {
      const level = argStr(args, "level")?.toUpperCase();
      const threshold = Number(args.threshold) > 0 ? Math.floor(Number(args.threshold)) : 60;
      const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

      const [grades, markingQueue, graduatedThisMonth, certs] = await Promise.all([
        prisma.grade.findMany({
          where: { ...(level ? { student: { level } } : {}) },
          select: { score: true, student: { select: { level: true } } },
        }),
        prisma.assignmentSubmission.count({ where: { needsReview: true } }),
        prisma.student.count({ where: { graduationDate: { gte: monthStart } } }),
        prisma.certificate.findMany({
          where: { revokedAt: null },
          select: { kind: true, passed: true, issuedAt: true, outstandingAtIssue: true },
        }),
      ]);

      const scores = grades.map((g) => g.score ?? 0);
      const byLevelSum: Record<string, { total: number; n: number }> = {};
      for (const g of grades) {
        const key = g.student?.level ?? "unknown";
        const bucket = (byLevelSum[key] ??= { total: 0, n: 0 });
        bucket.total += g.score ?? 0;
        bucket.n += 1;
      }

      return {
        forModel: {
          gradesRecorded: grades.length,
          averageScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
          averageByLevel: Object.fromEntries(
            Object.entries(byLevelSum).map(([k, v]) => [k, Math.round(v.total / v.n)]),
          ),
          passThreshold: threshold,
          passRatePercent: scores.length
            ? Math.round((scores.filter((s) => s >= threshold).length / scores.length) * 100)
            : null,
          scoredBelowThreshold: scores.filter((s) => s < threshold).length,
          papersInMarkingQueue: markingQueue,
          graduatedThisMonth,
          certificates: {
            total: certs.length,
            byKind: countByKey(certs, (c) => c.kind),
            provisionalForUnpaidBalance: certs.filter((c) => c.outstandingAtIssue > 0).length,
            issuedThisMonth: certs.filter((c) => c.issuedAt >= monthStart).length,
          },
        },
      };
    },
  },

  {
    name: "assignments_summary",
    capability: "reports",
    spec: {
      type: "function",
      function: {
        name: "assignments_summary",
        description:
          "Homework and quizzes: how many assignments were set in the window, how many submissions came in, how many are late, and how many are still waiting to be marked. Narrow with `level` or a tutor `search`.",
        parameters: {
          type: "object",
          properties: {
            level: FILTER_PROPERTIES.level,
            search: { type: "string", description: "Tutor name." },
            days: { type: "number", description: "Window in days. Default 30." },
          },
        },
      },
    },
    async run(args) {
      const level = argStr(args, "level")?.toUpperCase();
      const search = argStr(args, "search");
      const days = windowDays(args, 30, 365);
      const since = offsetDays(-days);
      const assignmentWhere = {
        ...(level ? { level } : {}),
        ...(search ? { lecturer: { user: { name: { contains: search, mode: "insensitive" as const } } } } : {}),
      };

      const [assignmentsInWindow, submissions] = await Promise.all([
        prisma.assignment.count({ where: { ...assignmentWhere, createdAt: { gte: since } } }),
        prisma.assignmentSubmission.findMany({
          where: { assignment: assignmentWhere },
          select: {
            score: true,
            needsReview: true,
            submittedAt: true,
            assignment: { select: { dueAt: true } },
          },
        }),
      ]);

      const submitted = submissions.filter((s) => s.submittedAt);
      const late = submitted.filter(
        (s) => s.assignment?.dueAt && s.submittedAt && s.submittedAt > s.assignment.dueAt,
      ).length;

      return {
        forModel: {
          windowDays: days,
          assignmentsSetInWindow: assignmentsInWindow,
          submissionsReceived: submitted.length,
          submissionsLate: late,
          awaitingMarking: submissions.filter((s) => s.needsReview).length,
          scope: { level: level ?? "all", tutor: search ?? "all" },
        },
      };
    },
  },

  {
    name: "learner_intelligence_summary",
    capability: "reports",
    spec: {
      type: "function",
      function: {
        name: "learner_intelligence_summary",
        description:
          "What the behaviour engine sees across the school: how many students it has any data on, the mix of engagement archetypes, how many look at risk of dropping out, and its top plain-English findings.",
        parameters: { type: "object", properties: {} },
      },
    },
    async run() {
      const { readSchool } = await import("@/lib/learner-intelligence");
      const [school, plans] = await Promise.all([readSchool(), prisma.personalizedPlan.count()]);
      return {
        forModel: {
          windowDays: school.windowDays,
          studentsOnRoster: school.coverage.students,
          studentsObserved: school.coverage.observed,
          optedOut: school.coverage.optedOut,
          archetypes: Object.fromEntries(school.archetypes.map((a) => [a.label, a.count])),
          atRiskCount: school.atRisk.length,
          standoutCount: school.standouts.length,
          personalisedPlansActive: plans,
          topFindings: school.findings.slice(0, 4).map((f) => f.headline),
        },
      };
    },
  },

  /* ---- Attendance risk (returns a cohort to chase) ---------- */

  {
    name: "attendance_risk",
    capability: "attendance",
    spec: {
      type: "function",
      function: {
        name: "attendance_risk",
        description:
          "Where attendance is weakest over a window: turnout by branch and level, and the students who have never been marked present or have missed at least `minAbsences` sessions — returned as a list to chase.",
        parameters: {
          type: "object",
          properties: {
            days: { type: "number", description: "Window in days. Default 30." },
            minAbsences: { type: "number", description: "Absence count that flags a student. Default 3." },
            branch: FILTER_PROPERTIES.branch,
            level: FILTER_PROPERTIES.level,
          },
        },
      },
    },
    async run(args) {
      const days = windowDays(args, 30, 120);
      const minAbsences = Number(args.minAbsences) > 0 ? Math.floor(Number(args.minAbsences)) : 3;
      const branch = argStr(args, "branch");
      const level = argStr(args, "level")?.toUpperCase();
      const since = offsetDays(-days);

      const records = await prisma.attendance.findMany({
        where: {
          date: { gte: since },
          student: {
            status: "active",
            ...(level ? { level } : {}),
            ...(branch ? { branch: { name: { equals: branch, mode: "insensitive" } } } : {}),
          },
        },
        select: {
          status: true,
          studentId: true,
          student: { select: { level: true, branch: { select: { name: true } } } },
        },
      });

      const present = records.filter((r) => r.status === "present" || r.status === "late").length;
      const cell = countByKey(records, (r) => `${r.student?.branch?.name ?? "?"} · ${r.student?.level ?? "?"}`);
      const presentCell = countByKey(
        records.filter((r) => r.status === "present" || r.status === "late"),
        (r) => `${r.student?.branch?.name ?? "?"} · ${r.student?.level ?? "?"}`,
      );
      const turnoutByCohort = Object.fromEntries(
        Object.entries(cell).map(([k, total]) => [k, Math.round(((presentCell[k] ?? 0) / total) * 100)]),
      );

      const absencesByStudent = countByKey(
        records.filter((r) => r.status === "absent"),
        (r) => r.studentId,
      );
      const flagged = Object.entries(absencesByStudent)
        .filter(([, n]) => n >= minAbsences)
        .map(([id]) => id);
      // Anyone active in the scope with no record at all in the window is worse than absent.
      const seen = new Set(records.map((r) => r.studentId));

      const scopeStudents = await prisma.student.findMany({
        where: {
          status: "active",
          ...(level ? { level } : {}),
          ...(branch ? { branch: { name: { equals: branch, mode: "insensitive" } } } : {}),
        },
        select: BASIC_STUDENT_SELECT,
      });
      const chaseIds = new Set([...flagged, ...scopeStudents.filter((s) => !seen.has(s.id)).map((s) => s.id)]);
      const rows = scopeStudents.filter((s) => chaseIds.has(s.id)).slice(0, MAX_TABLE_ROWS).map(basicStudentRow);

      return {
        forModel: {
          windowDays: days,
          marksRecorded: records.length,
          overallPresentPercent: records.length ? Math.round((present / records.length) * 100) : null,
          turnoutByCohort,
          studentsToChase: rows.length,
          how_to_answer: "give_the_weak_cohorts_and_the_chase_count__never_list_names",
        },
        cohort: {
          label: `Attendance risk${branch ? ` · ${branch}` : ""}${level ? ` · ${level}` : ""}`,
          rows,
          truncated: rows.length >= MAX_TABLE_ROWS,
        },
      };
    },
  },

  /* ---- Enrolment plumbing ---------------------------------- */

  {
    name: "signup_tokens_summary",
    capability: "students",
    spec: {
      type: "function",
      function: {
        name: "signup_tokens_summary",
        description:
          "Enrolment access tokens: how many are still outstanding (unused, not expired), how many have been used, how many expired unused, and how many expire within a week — with a breakdown by student type and source.",
        parameters: { type: "object", properties: {} },
      },
    },
    async run() {
      const tokens = await prisma.signupToken.findMany({
        select: { used: true, expiresAt: true, studentType: true, source: true, level: true },
      });
      const now = Date.now();
      const outstanding = tokens.filter((t) => !t.used && (!t.expiresAt || t.expiresAt.getTime() > now));

      return {
        forModel: {
          total: tokens.length,
          outstanding: outstanding.length,
          used: tokens.filter((t) => t.used).length,
          expiredUnused: tokens.filter((t) => !t.used && t.expiresAt && t.expiresAt.getTime() <= now).length,
          expiringWithin7Days: outstanding.filter(
            (t) => t.expiresAt && t.expiresAt.getTime() < now + 7 * DAY,
          ).length,
          byStudentType: countByKey(tokens, (t) => t.studentType),
          bySource: countByKey(tokens, (t) => t.source),
        },
      };
    },
  },

  {
    name: "parents_summary",
    capability: "students",
    spec: {
      type: "function",
      function: {
        name: "parents_summary",
        description:
          "Parent and guardian accounts: how many exist, how many students have at least one linked, how many active students have none, and how many parents watch more than one child.",
        parameters: { type: "object", properties: {} },
      },
    },
    async run() {
      const [parents, links, activeStudents] = await Promise.all([
        prisma.parent.count(),
        prisma.parentStudent.findMany({ select: { studentId: true, parentId: true } }),
        prisma.student.count({ where: { status: "active" } }),
      ]);
      const childrenLinked = new Set(links.map((l) => l.studentId)).size;
      const perParent = countByKey(links, (l) => l.parentId);

      return {
        forModel: {
          parentAccounts: parents,
          studentsWithAGuardianLinked: childrenLinked,
          activeStudentsWithNoGuardian: Math.max(0, activeStudents - childrenLinked),
          parentsWatchingMoreThanOneChild: Object.values(perParent).filter((n) => n > 1).length,
        },
      };
    },
  },

  {
    name: "pathway_breakdown",
    capability: "students",
    spec: {
      type: "function",
      function: {
        name: "pathway_breakdown",
        description:
          "Active students split by pathway (e.g. language training, travel package), by class type (group / private) and by delivery mode (physical / hybrid / online).",
        parameters: { type: "object", properties: { branch: FILTER_PROPERTIES.branch } },
      },
    },
    async run(args) {
      const branch = argStr(args, "branch");
      const students = await prisma.student.findMany({
        where: {
          status: "active",
          ...(branch ? { branch: { name: { equals: branch, mode: "insensitive" } } } : {}),
        },
        select: { pathway: true, classType: true, deliveryMode: true },
      });
      return {
        forModel: {
          activeStudents: students.length,
          byPathway: countByKey(students, (s) => s.pathway || "unspecified"),
          byClassType: countByKey(students, (s) => s.classType),
          byDeliveryMode: countByKey(students, (s) => s.deliveryMode),
        },
      };
    },
  },

  /* ---- Community ------------------------------------------ */

  {
    name: "community_summary",
    capability: "community",
    spec: {
      type: "function",
      function: {
        name: "community_summary",
        description:
          "The student community: how many spaces and channels exist, how many messages were posted in the window, which cohort room is busiest, how many messages were hidden by moderation, and how many students are currently muted.",
        parameters: {
          type: "object",
          properties: { days: { type: "number", description: "Window in days. Default 7." } },
        },
      },
    },
    async run(args) {
      const days = windowDays(args, 7, 90);
      const since = offsetDays(-days);
      const [spaces, channels, messages, mutes] = await Promise.all([
        prisma.space.count(),
        prisma.channel.count(),
        prisma.message.findMany({
          where: { createdAt: { gte: since } },
          select: {
            hiddenAt: true,
            channel: {
              select: { space: { select: { level: true, branch: { select: { name: true } } } } },
            },
          },
        }),
        prisma.communityMute.count({ where: { mutedUntil: { gt: new Date() } } }),
      ]);

      const byCohort = countByKey(
        messages,
        (m) => `${m.channel?.space?.branch?.name ?? "?"} · ${m.channel?.space?.level ?? "?"}`,
      );

      return {
        forModel: {
          windowDays: days,
          spaces,
          channels,
          messagesInWindow: messages.length,
          messagesHidden: messages.filter((m) => m.hiddenAt).length,
          currentlyMuted: mutes,
          busiestRoom: topEntry(byCohort)?.key ?? null,
        },
      };
    },
  },

  /* ---- Comms (email + SMS + notifications) --------------- */

  {
    name: "comms_summary",
    capability: "emails",
    spec: {
      type: "function",
      function: {
        name: "comms_summary",
        description:
          "Outbound messaging over a window: emails by status (sent / failed / bounced), how many bulk campaigns, the suppression-list size, SMS sent and their delivery rate, and how many notification sends went out.",
        parameters: {
          type: "object",
          properties: { days: { type: "number", description: "Window in days. Default 7." } },
        },
      },
    },
    async run(args) {
      const days = windowDays(args, 7, 90);
      const since = offsetDays(-days);
      const [emailMessages, emailLogs, suppression, sms, notifSends] = await Promise.all([
        prisma.emailMessage.findMany({
          where: { createdAt: { gte: since } },
          select: { status: true, campaignId: true },
        }),
        prisma.emailLog.findMany({ where: { sentAt: { gte: since } }, select: { status: true } }),
        prisma.emailSuppression.count(),
        prisma.smsMessage.findMany({ where: { createdAt: { gte: since } }, select: { status: true } }),
        prisma.notification.groupBy({
          by: ["batchId"],
          where: { createdAt: { gte: since }, batchId: { not: null } },
          _count: true,
        }),
      ]);

      const emailStatus = countByKey([...emailMessages, ...emailLogs], (e) => e.status);
      const smsSent = sms.filter((s) => s.status === "sent").length;

      return {
        forModel: {
          windowDays: days,
          emailsByStatus: emailStatus,
          bulkCampaigns: new Set(emailMessages.map((e) => e.campaignId).filter(Boolean)).size,
          suppressionListSize: suppression,
          smsSent,
          smsDeliveryRatePercent: sms.length ? Math.round((smsSent / sms.length) * 100) : null,
          notificationSends: notifSends.length,
        },
      };
    },
  },

  /* ---- Staff calendar & webinars ------------------------ */

  {
    name: "events_summary",
    capability: "events",
    spec: {
      type: "function",
      function: {
        name: "events_summary",
        description:
          "The staff calendar ahead: how many events and webinars are scheduled in the window, how many people are expected, how many planning tasks are still open, and how many webinar questions are unanswered.",
        parameters: {
          type: "object",
          properties: { days: { type: "number", description: "Window in days. Default 30." } },
        },
      },
    },
    async run(args) {
      const days = windowDays(args, 30, 180);
      const now = new Date();
      const to = offsetDays(days);
      const [events, openTasks, pendingQuestions] = await Promise.all([
        prisma.workEvent.findMany({
          where: { startAt: { gte: now, lte: to }, status: { notIn: ["cancelled", "draft"] } },
          select: { kind: true, _count: { select: { attendees: true } } },
        }),
        prisma.eventTask.count({ where: { done: false, event: { startAt: { gte: now, lte: to } } } }),
        prisma.webinarQuestion.count({ where: { status: "pending" } }),
      ]);

      return {
        forModel: {
          windowDays: days,
          upcomingEvents: events.length,
          byKind: countByKey(events, (e) => e.kind),
          webinars: events.filter((e) => e.kind === "webinar").length,
          expectedAttendees: events.reduce((t, e) => t + e._count.attendees, 0),
          openPlanningTasks: openTasks,
          unansweredWebinarQuestions: pendingQuestions,
        },
      };
    },
  },

  /* ---- Work Drive (staff file store) -------------------- */

  {
    name: "work_drive_summary",
    capability: "work_drive",
    spec: {
      type: "function",
      function: {
        name: "work_drive_summary",
        description:
          "The staff Work Drive: how many workspaces, folders and files, total storage used, how many files were added in the window, how many active shares exist, and the recent activity by type.",
        parameters: {
          type: "object",
          properties: { days: { type: "number", description: "Window in days. Default 30." } },
        },
      },
    },
    async run(args) {
      const days = windowDays(args, 30, 180);
      const since = offsetDays(-days);
      const [workspaces, folders, files, uploads, shares, activity] = await Promise.all([
        prisma.workspace.count({ where: { archivedAt: null } }),
        prisma.driveFolder.count(),
        prisma.driveFile.aggregate({ _count: { _all: true }, _sum: { sizeBytes: true } }),
        prisma.driveFile.count({ where: { createdAt: { gte: since } } }),
        prisma.fileShare.count({ where: { revokedAt: null } }),
        prisma.fileActivity.groupBy({
          by: ["action"],
          where: { createdAt: { gte: since } },
          _count: true,
        }),
      ]);

      return {
        forModel: {
          windowDays: days,
          workspaces,
          folders,
          files: files._count._all,
          storageUsedMB: Math.round(Number(files._sum.sizeBytes ?? 0) / 1_000_000),
          filesAddedInWindow: uploads,
          activeShares: shares,
          recentActivity: Object.fromEntries(activity.map((a) => [a.action, a._count])),
        },
      };
    },
  },

  /* ---- Materials catalogue ----------------------------- */

  {
    name: "materials_summary",
    capability: "materials",
    spec: {
      type: "function",
      function: {
        name: "materials_summary",
        description:
          "The teaching-materials catalogue: how many items by kind (document / video / recording) and by level, how many were uploaded in the window, how many have their AI summary and quests ready, and how many student quest attempts there were.",
        parameters: {
          type: "object",
          properties: {
            level: FILTER_PROPERTIES.level,
            days: { type: "number", description: "Window in days. Default 30." },
          },
        },
      },
    },
    async run(args) {
      const level = argStr(args, "level")?.toUpperCase();
      const days = windowDays(args, 30, 365);
      const since = offsetDays(-days);
      const [materials, questAttempts] = await Promise.all([
        prisma.material.findMany({
          where: { ...(level ? { level } : {}) },
          select: { kind: true, level: true, createdAt: true, aiState: true },
        }),
        prisma.materialQuestAttempt.count({ where: { createdAt: { gte: since } } }),
      ]);

      return {
        forModel: {
          total: materials.length,
          byKind: countByKey(materials, (m) => m.kind),
          byLevel: countByKey(materials, (m) => m.level ?? "unassigned"),
          uploadedInWindow: materials.filter((m) => m.createdAt >= since).length,
          aiReady: materials.filter((m) => m.aiState === "ready").length,
          questAttemptsInWindow: questAttempts,
        },
      };
    },
  },

  /* ---- Branch rollup ---------------------------------- */

  {
    name: "branch_overview",
    capability: "branches",
    spec: {
      type: "function",
      function: {
        name: "branch_overview",
        description:
          "Every branch side by side: mode (physical / online), active students, active tutors, and class sessions in the next 7 days. Includes tuition collected this month per branch when your role covers payments.",
        parameters: { type: "object", properties: {} },
      },
    },
    async run(_args, admin) {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const [branches, activeByBranch, tutorsByBranch, sessionsByBranch, payments] = await Promise.all([
        prisma.branch.findMany({ select: { id: true, name: true, mode: true, status: true } }),
        prisma.student.groupBy({ by: ["branchId"], where: { status: "active" }, _count: true }),
        prisma.lecturer.groupBy({ by: ["branchId"], where: { status: "active" }, _count: true }),
        prisma.classSession.groupBy({
          by: ["branchId"],
          where: { date: { gte: now, lte: offsetDays(7) }, status: { not: "cancelled" } },
          _count: true,
        }),
        admin.can("payments")
          ? prisma.payment.findMany({
              where: { ...receivedPaymentFilter(), createdAt: { gte: monthStart } },
              select: { amount: true, student: { select: { branchId: true } } },
            })
          : Promise.resolve([] as Array<{ amount: number; student: { branchId: string | null } | null }>),
      ]);

      const num = (rows: Array<{ branchId: string | null; _count: number }>, id: string) =>
        rows.find((r) => r.branchId === id)?._count ?? 0;
      const collected = new Map<string, number>();
      for (const p of payments) {
        const id = p.student?.branchId ?? "";
        collected.set(id, (collected.get(id) ?? 0) + (p.amount ?? 0));
      }

      return {
        forModel: {
          currency: "NGN",
          branches: branches.map((b) => ({
            name: b.name,
            mode: b.mode,
            status: b.status,
            activeStudents: num(activeByBranch, b.id),
            activeTutors: num(tutorsByBranch, b.id),
            sessionsNext7Days: num(sessionsByBranch, b.id),
            ...(admin.can("payments") ? { collectedThisMonth: collected.get(b.id) ?? 0 } : {}),
          })),
        },
      };
    },
  },

  /* ---- Security & audit ------------------------------ */

  {
    name: "security_summary",
    capability: "security",
    spec: {
      type: "function",
      function: {
        name: "security_summary",
        description:
          "The security picture: audit-trail entries in the window by action, failed sign-ins, assistant action plans by status, and the age and result of the most recent backup of each kind.",
        parameters: {
          type: "object",
          properties: { days: { type: "number", description: "Window in days. Default 7." } },
        },
      },
    },
    async run(args) {
      const days = windowDays(args, 7, 90);
      const since = offsetDays(-days);
      const [auditByAction, actionsByStatus, backups] = await Promise.all([
        prisma.auditLog.groupBy({ by: ["action"], where: { at: { gte: since } }, _count: true }),
        prisma.adminAction.groupBy({
          by: ["status"],
          where: { createdAt: { gte: since } },
          _count: true,
        }),
        prisma.backupRun.findMany({
          orderBy: { startedAt: "desc" },
          take: 20,
          select: { kind: true, status: true, startedAt: true },
        }),
      ]);

      const lastByKind: Record<string, { status: string; ageHours: number }> = {};
      for (const b of backups) {
        if (lastByKind[b.kind]) continue;
        lastByKind[b.kind] = {
          status: b.status,
          ageHours: Math.round((Date.now() - b.startedAt.getTime()) / 3_600_000),
        };
      }

      return {
        forModel: {
          windowDays: days,
          auditEntriesByAction: Object.fromEntries(auditByAction.map((a) => [a.action, a._count])),
          failedSignIns: auditByAction.find((a) => a.action === "loginFailed")?._count ?? 0,
          assistantActionPlans: Object.fromEntries(actionsByStatus.map((a) => [a.status, a._count])),
          lastBackupByKind: lastByKind,
        },
      };
    },
  },

  {
    name: "audit_lookup",
    capability: "security",
    spec: {
      type: "function",
      function: {
        name: "audit_lookup",
        description:
          "Recent audit-trail entries, filtered by actor email, action, or the Prisma model touched. Returns the matching count and the most recent entries.",
        parameters: {
          type: "object",
          properties: {
            actor: { type: "string", description: "Substring of the actor's email." },
            action: {
              type: "string",
              description: "Exact action, e.g. update, delete, login, permissionChange.",
            },
            model: { type: "string", description: "Prisma model name, e.g. Student, Payment." },
            days: { type: "number", description: "Window in days. Default 7." },
          },
        },
      },
    },
    async run(args) {
      const days = windowDays(args, 7, 90);
      const where = {
        at: { gte: offsetDays(-days) },
        ...(argStr(args, "actor")
          ? { actorEmail: { contains: argStr(args, "actor"), mode: "insensitive" as const } }
          : {}),
        ...(argStr(args, "action") ? { action: argStr(args, "action") } : {}),
        ...(argStr(args, "model") ? { model: argStr(args, "model") } : {}),
      };
      const [count, rows] = await Promise.all([
        prisma.auditLog.count({ where }),
        prisma.auditLog.findMany({
          where,
          orderBy: { at: "desc" },
          take: 60,
          select: {
            at: true,
            action: true,
            model: true,
            actorEmail: true,
            actorRole: true,
            summary: true,
            severity: true,
          },
        }),
      ]);

      return {
        forModel: {
          windowDays: days,
          matched: count,
          entries: rows.map((r) => ({
            at: r.at.toISOString(),
            action: r.action,
            model: r.model,
            actor: r.actorEmail ?? "system",
            role: r.actorRole,
            summary: r.summary,
            severity: r.severity,
          })),
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
  const emailProblems = rows.filter((row) => row.emailQuality !== "ok").length;
  const noPhone = rows.filter((row) => row.phone === null).length;

  return {
    byLevel: tally((row) => row.level),
    byBranch: tally((row) => row.branch ?? "No branch"),
    byGoal: tally((row) => row.goal ?? "Not asked yet"),
    // Only surfaced when there is something to say — a clean cohort should not
    // grow an "all fine" line the model then reads out.
    ...(emailProblems ? { byEmailQuality: tally((row) => row.emailQuality) } : {}),
    ...(noPhone ? { withNoPhoneOnFile: noPhone } : {}),
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
  if (filters.emailQuality === "problem") parts.push("wrong / template email");
  else if (filters.emailQuality) parts.push(`${filters.emailQuality} email`);
  if (filters.missingPhone) parts.push("no phone on file");
  if (filters.search) parts.push(`"${filters.search}"`);
  return parts.length ? parts.join(" · ") : "All students";
}

/* -------------------------------------------------------------------------- */
/* Helpers shared by the expanded read tools                                  */
/*                                                                            */
/* Function declarations, so a tool defined earlier in ASSISTANT_TOOLS can    */
/* call them — hoisting makes the ordering here not matter.                   */
/* -------------------------------------------------------------------------- */

/** A Date `n` days from now. Negative `n` is in the past. */
function offsetDays(n: number): Date {
  return new Date(Date.now() + n * DAY);
}

/** Read a positive integer `days` arg, with a default and a ceiling. */
function windowDays(args: Record<string, unknown>, fallback: number, max = 365): number {
  const n = Number(args.days);
  return Number.isFinite(n) && n > 0 ? Math.min(max, Math.floor(n)) : fallback;
}

/** Read a trimmed non-empty string arg, or undefined. */
function argStr(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Count rows by a derived key, dropping empty keys. */
function countByKey<T>(rows: T[], pick: (row: T) => string | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    const key = pick(row);
    if (key) out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

/** The most common entry in a count map, or null when it is empty. */
function topEntry(counts: Record<string, number>): { key: string; count: number } | null {
  let best: { key: string; count: number } | null = null;
  for (const [key, count] of Object.entries(counts)) {
    if (!best || count > best.count) best = { key, count };
  }
  return best;
}

/** Integer mean of `total` over `n` buckets; 0 when there are none. */
function roundAvg(total: number, n: number): number {
  return n > 0 ? Math.round(total / n) : 0;
}

/**
 * Classify an email address by how reachable it is. See EmailQuality.
 *
 * The `placeholder` rules track what the writers actually mint: the importer's
 * `noemail.<hex>@students.placeholder.easywayschoollms.com.ng`
 * (api/admin/students/import/route.ts), plus the `@example.com` / `.invalid` /
 * `.test` stubs that QA and hand-entry leave behind. `invalid` is a syntax
 * check — anything that is not `local@domain.tld`, or has a doubled dot.
 */
export function classifyEmail(raw: string | null | undefined): EmailQuality {
  const email = (raw ?? "").trim().toLowerCase();
  if (!email) return "missing";

  if (
    email.includes(".placeholder.") ||
    email.includes("noemail") ||
    email.endsWith(".invalid") ||
    email.endsWith(".test") ||
    email.endsWith(".local") ||
    email.endsWith(".example") ||
    /@(example|test|sample|invalid|localhost)\.[a-z.]+$/.test(email) ||
    /^(no-?reply|donotreply|test|placeholder)@/.test(email)
  ) {
    return "placeholder";
  }

  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email) || email.includes("..")) {
    return "invalid";
  }

  return "ok";
}

/**
 * Salvage a phone number from the free-form admission blob — an older intake
 * path wrote the number there and nowhere else. Returns a trimmed string or "".
 */
function phoneFromAdmission(admission: unknown): string {
  if (!admission || typeof admission !== "object") return "";
  const blob = admission as Record<string, unknown>;
  for (const key of [
    "phone",
    "phoneNumber",
    "phone_number",
    "mobile",
    "tel",
    "telephone",
    "contact",
    "contactPhone",
    "whatsapp",
  ]) {
    const value = blob[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

/**
 * The Prisma `select` that `basicStudentRow` expects — the minimum needed to
 * render a student in the browser cohort table, without the money/attendance
 * columns `loadStudents` adds. Used by the tools that build their own cohort
 * from a query `loadStudents`'s filters cannot express.
 */
const BASIC_STUDENT_SELECT = {
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
} as const;

type BasicStudent = {
  id: string;
  studentCode: string | null;
  level: string;
  status: string;
  classType: string;
  deliveryMode: string;
  germanyGoal: string | null;
  classesStartedAt: Date | null;
  createdAt: Date;
  branch: { name: string } | null;
  user: { name: string | null; email: string } | null;
};

function basicStudentRow(student: BasicStudent): StudentRow {
  const email = student.user?.email ?? "";
  return {
    id: student.id,
    name: student.user?.name ?? "(no name)",
    email,
    emailQuality: classifyEmail(email),
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
}
