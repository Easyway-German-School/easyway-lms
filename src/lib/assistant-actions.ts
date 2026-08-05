import { prisma } from "@/lib/prisma";
import type { AdminContext, Capability } from "@/lib/admin-roles";
import type { ToolSpec } from "@/lib/ollama";
import { notify, KIND } from "@/lib/notify";
import { promoteStudents } from "@/lib/promotion";
import { inviteLeads } from "@/lib/leads";
import { nextLevelAfter } from "@/lib/levels";
import { normalizeSlot } from "@/lib/class-times";
import {
  FILTER_PROPERTIES,
  applyDerivedFilters,
  describeFilters,
  loadStudents,
  readFilters,
  type StudentRow,
} from "@/lib/assistant-tools";

/**
 * What the assistant is allowed to DO, and the rule that makes it safe.
 *
 * ---------------------------------------------------------------------------
 * THE MODEL DOES NOT EXECUTE ANYTHING. IT PROPOSES.
 *
 * Every tool in this file is split in half. `plan()` reads the model's
 * arguments, resolves them against the database, and returns a PREVIEW — who is
 * affected, how many, what will change, and what looks wrong about it. Nothing
 * is written. `execute()` runs later, from a separate HTTP request, triggered by
 * a person clicking Confirm, and it never sees the model's arguments again — it
 * sees the frozen payload that `plan()` produced and the human approved.
 *
 * That split is the entire safety argument, and it survives the failure mode
 * that matters. A model that reads "students who have not paid" as "students
 * not FULLY paid" does not quietly message two hundred people; it produces a
 * card that says "this will message 214 students", and 214 is visibly wrong to
 * anybody who expected thirty. Prose can hide a mistake of that size. A count
 * with a Confirm button under it cannot.
 *
 * ---------------------------------------------------------------------------
 * THE COHORT IS FROZEN AT PLAN TIME, NOT RE-QUERIED AT EXECUTE TIME
 *
 * `plan()` stores actual student ids in the payload. The obvious alternative —
 * store the filters, re-run the query on confirm — is worse in a specific and
 * unfixable way: between preview and click, somebody pays. Re-querying then
 * acts on a group the admin never saw, and the one thing a confirmation screen
 * has to guarantee is that what runs is what was on screen.
 *
 * The cost is staleness, which is why plans expire (see the route). A plan that
 * has sat for an hour is refused and must be asked for again.
 *
 * ---------------------------------------------------------------------------
 * ONE FILTER IMPLEMENTATION, SHARED WITH THE READ TOOLS
 *
 * The cohort resolvers here call straight into assistant-tools.ts. If "Lagos B1
 * unpaid" meant one set of people when listed and a subtly different set when
 * messaged, the confirm card would be describing a group nobody reviewed —
 * which is the same class of bug as not having a confirm card at all.
 *
 * ---------------------------------------------------------------------------
 * CAPABILITIES ARE CHECKED THREE TIMES
 *
 * When the tool list is built, when the plan is made, and again when it is
 * executed — because the execute request arrives minutes later, possibly from a
 * different person on a shared front-desk machine, and a plan is not a bearer
 * token for the capability that created it.
 */

/** Nobody proposes an action against more people than this in one go. */
const MAX_AFFECTED = 400;

const DAY = 86_400_000;

/* -------------------------------------------------------------------------- */
/* Shapes                                                                     */
/* -------------------------------------------------------------------------- */

export type ActionPreview = {
  /** One line, as the card's headline. */
  summary: string;
  affected: number;
  /** What will happen, as bullets. Written for somebody about to be liable. */
  lines: string[];
  /** Anything that should give the reader pause. Rendered in amber. */
  warnings: string[];
  /** A few of the actual people, so the card is checkable rather than trusted. */
  sample: Array<{ name: string; detail: string }>;
  reversible: boolean;
};

export type PlannedAction = {
  payload: Record<string, unknown>;
  preview: ActionPreview;
};

export type ExecutionResult = {
  /** Written back to the admin verbatim. Past tense, specific. */
  summary: string;
  details: Record<string, unknown>;
};

export type AssistantAction = {
  name: string;
  capability: Capability;
  /**
   * Whether the school can undo this from the portal afterwards. Shown on the
   * card, because "this cannot be undone here" changes how carefully a person
   * reads the number above it.
   */
  reversible: boolean;
  spec: ToolSpec;
  plan: (args: Record<string, unknown>, admin: AdminContext) => Promise<PlannedAction>;
  execute: (payload: Record<string, unknown>, admin: AdminContext) => Promise<ExecutionResult>;
};

/**
 * Thrown by `plan()` when the model's arguments cannot describe a real action.
 *
 * Distinct from a crash on purpose: the message goes back to the MODEL as a
 * tool result, so it can correct itself and re-propose — "you must give a
 * message to send" is a fixable mistake, and making the admin retype the whole
 * question because of it would be silly.
 */
export class PlanError extends Error {}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const naira = (value: number) => `NGN ${Math.round(value).toLocaleString()}`;

function str(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  return typeof value === "string" ? value.trim() : "";
}

function requireStr(args: Record<string, unknown>, key: string, label: string): string {
  const value = str(args, key);
  if (!value) throw new PlanError(`${label} is required. Ask the admin for it, then propose again.`);
  return value;
}

function requireIdList(payload: Record<string, unknown>, key: string): string[] {
  const value = payload[key];
  if (!Array.isArray(value)) throw new Error(`This plan is missing its ${key}.`);
  return value.filter((id): id is string => typeof id === "string");
}

/**
 * Read a date the model wrote, and refuse anything ambiguous.
 *
 * ISO only. A model asked for "next Tuesday" will happily produce a date, and
 * a postponement that lands on the wrong day is worse than one that was
 * refused — so anything that is not YYYY-MM-DD comes back as a PlanError and
 * the model has to ask.
 */
function isoDate(args: Record<string, unknown>, key: string, label: string): Date {
  const raw = str(args, key);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new PlanError(`${label} must be an exact date as YYYY-MM-DD. Ask the admin which day they mean.`);
  }
  const date = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new PlanError(`${raw} is not a real date.`);
  return date;
}

const prettyDate = (date: Date) =>
  date.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** Resolve the filters into real people, through the read tools' own code. */
async function cohortFor(
  args: Record<string, unknown>,
  admin: AdminContext,
): Promise<{ rows: StudentRow[]; label: string }> {
  const filters = readFilters(args);
  const rows = applyDerivedFilters(await loadStudents(filters, admin), filters, admin);
  return { rows, label: describeFilters(filters) };
}

/**
 * The checks every cohort action shares.
 *
 * "Nobody matched" is a PlanError rather than an empty plan because a confirm
 * card offering to message zero people is a worse answer than being told the
 * filter found nobody.
 */
function guardCohort(rows: StudentRow[], label: string): void {
  if (rows.length === 0) {
    throw new PlanError(`No students match ${label}. Say so, and suggest loosening one filter.`);
  }
  if (rows.length > MAX_AFFECTED) {
    throw new PlanError(
      `That matches ${rows.length} students, over the ${MAX_AFFECTED} limit for one action. Ask the admin to narrow it — by branch, level or batch.`,
    );
  }
}

/**
 * Warn when a cohort looks like it was meant to be narrower.
 *
 * A whole-school action is occasionally correct and usually a filter that did
 * not apply, so it earns a line on the card rather than a refusal.
 */
function breadthWarnings(rows: StudentRow[], args: Record<string, unknown>): string[] {
  const warnings: string[] = [];
  const named = Object.keys(readFilters(args)).filter(
    (key) => readFilters(args)[key as keyof ReturnType<typeof readFilters>] !== undefined,
  );
  if (named.length === 0) {
    warnings.push("No filters were applied — this covers every student in the school.");
  }
  const branches = new Set(rows.map((row) => row.branch ?? "No branch"));
  if (branches.size > 1) warnings.push(`Spans ${branches.size} campuses: ${[...branches].join(", ")}.`);
  return warnings;
}

function sampleOf(rows: StudentRow[], detail: (row: StudentRow) => string) {
  return rows.slice(0, 4).map((row) => ({ name: row.name, detail: detail(row) }));
}

/* -------------------------------------------------------------------------- */
/* The actions                                                                */
/* -------------------------------------------------------------------------- */

const COHORT_FILTERS = {
  branch: FILTER_PROPERTIES.branch,
  level: FILTER_PROPERTIES.level,
  status: FILTER_PROPERTIES.status,
  classType: FILTER_PROPERTIES.classType,
  deliveryMode: FILTER_PROPERTIES.deliveryMode,
  goal: FILTER_PROPERTIES.goal,
  batch: FILTER_PROPERTIES.batch,
  paymentState: FILTER_PROPERTIES.paymentState,
  notSeenForDays: FILTER_PROPERTIES.notSeenForDays,
  startedClasses: FILTER_PROPERTIES.startedClasses,
  registeredWithinDays: FILTER_PROPERTIES.registeredWithinDays,
} as const;

export const ASSISTANT_ACTIONS: AssistantAction[] = [
  /* ---------------------------------------------------------------- message */
  {
    name: "message_students",
    capability: "emails",
    reversible: false,
    spec: {
      type: "function",
      function: {
        name: "message_students",
        description:
          "Propose sending a notification to every student matching the filters. Writes the message yourself — do not ask the admin to write it unless they gave you specific wording. Nothing is sent until the admin confirms.",
        parameters: {
          type: "object",
          properties: {
            ...COHORT_FILTERS,
            title: { type: "string", description: "Subject line, under 120 characters." },
            message: {
              type: "string",
              description:
                "The message itself, as the school would say it. Warm, plain, no placeholders like [NAME] — this text is sent exactly as written.",
            },
          },
          required: ["title", "message"],
        },
      },
    },
    async plan(args, admin) {
      const title = requireStr(args, "title", "A subject line");
      const message = requireStr(args, "message", "A message");
      if (title.length > 120) throw new PlanError("That subject line is over 120 characters. Shorten it.");
      if (message.length > 2000) throw new PlanError("That message is over 2000 characters. Shorten it.");

      const { rows, label } = await cohortFor(args, admin);
      guardCohort(rows, label);

      const warnings = breadthWarnings(rows, args);
      /**
       * Placeholder detection. A model told not to use `[NAME]` mostly does not,
       * and "mostly" is not good enough when the failure ships to two hundred
       * phones reading "Dear [NAME]".
       */
      if (/\[[A-Za-z_ ]+\]|\{\{.+?\}\}/.test(message)) {
        warnings.push("The message still contains a placeholder — it will be sent literally.");
      }

      return {
        payload: { studentIds: rows.map((row) => row.id), title, message, label },
        preview: {
          summary: `Message ${rows.length} student${rows.length === 1 ? "" : "s"} — ${label}`,
          affected: rows.length,
          lines: [
            `Subject: ${title}`,
            message,
            "Goes to the bell in their portal and buzzes their phone if they allowed notifications.",
          ],
          warnings,
          sample: sampleOf(rows, (row) => `${row.level}${row.branch ? ` · ${row.branch}` : ""}`),
          reversible: false,
        },
      };
    },
    async execute(payload) {
      const studentIds = requireIdList(payload, "studentIds");
      // Re-checked against the database: a student withdrawn since the plan was
      // made must not be messaged just because they were in the frozen list.
      const real = await prisma.student.findMany({
        where: { id: { in: studentIds } },
        select: { id: true },
      });

      const result = await notify({
        to: { studentIds: real.map((student) => student.id) },
        title: String(payload.title),
        message: String(payload.message),
        kind: KIND.announcement,
        severity: "info",
        link: "/dashboard",
      });

      return {
        summary: `Sent to ${result.created} student${result.created === 1 ? "" : "s"}.`,
        details: { delivered: result.created, pushed: result.pushed, dropped: studentIds.length - real.length },
      };
    },
  },

  /* ------------------------------------------------------------ fee chasing */
  {
    name: "send_fee_reminders",
    capability: "payments",
    reversible: false,
    spec: {
      type: "function",
      function: {
        name: "send_fee_reminders",
        description:
          "Propose sending each student who owes tuition a reminder stating THEIR OWN balance. The amount is filled in per student by the school's own figures — never write an amount yourself. Nothing is sent until the admin confirms.",
        parameters: {
          type: "object",
          properties: {
            branch: FILTER_PROPERTIES.branch,
            level: FILTER_PROPERTIES.level,
            batch: FILTER_PROPERTIES.batch,
            minimumOwed: {
              type: "number",
              description: "Only students owing at least this many naira. Use to skip trivial balances.",
            },
            note: {
              type: "string",
              description:
                "One or two warm sentences to sit above the balance — how to pay, who to speak to. No amounts.",
            },
          },
        },
      },
    },
    async plan(args, admin) {
      const note = str(args, "note") || "A gentle reminder about your tuition balance. Please speak to the office if you would like to arrange a plan.";
      if (note.length > 600) throw new PlanError("That note is too long. Two sentences is plenty.");
      /**
       * The note must not contain a figure. If the model writes "you owe
       * NGN 90,000" into copy that is sent to everybody, one true sentence
       * becomes two hundred false ones — and it is the kind of error that gets
       * repeated back to the school as fact by the students who received it.
       */
      if (/\d[\d,.]{2,}/.test(note)) {
        throw new PlanError(
          "The note must not contain any amount — each student's balance is filled in per person. Rewrite it without numbers.",
        );
      }

      const minimumOwed = Number(args.minimumOwed);
      const floor = Number.isFinite(minimumOwed) && minimumOwed > 0 ? minimumOwed : 1;

      const { rows, label } = await cohortFor({ ...args, status: "active" }, admin);
      const owing = rows.filter((row) => (row.owed ?? 0) >= floor);
      guardCohort(owing, `${label} owing at least ${naira(floor)}`);

      const total = owing.reduce((sum, row) => sum + (row.owed ?? 0), 0);

      return {
        payload: {
          recipients: owing.map((row) => ({ studentId: row.id, owed: row.owed ?? 0 })),
          note,
          label,
        },
        preview: {
          summary: `Remind ${owing.length} student${owing.length === 1 ? "" : "s"} about ${naira(total)} in unpaid tuition`,
          affected: owing.length,
          lines: [
            note,
            "Each student sees only their own balance, filled in from the fee book.",
            `Largest single balance: ${naira(Math.max(...owing.map((row) => row.owed ?? 0)))}.`,
          ],
          warnings: breadthWarnings(owing, args),
          sample: sampleOf(owing, (row) => `${naira(row.owed ?? 0)} outstanding`),
          reversible: false,
        },
      };
    },
    async execute(payload) {
      const recipients = Array.isArray(payload.recipients)
        ? (payload.recipients as Array<{ studentId?: unknown; owed?: unknown }>)
        : [];
      const note = String(payload.note);

      let delivered = 0;
      for (const recipient of recipients) {
        const studentId = typeof recipient.studentId === "string" ? recipient.studentId : null;
        const owed = Number(recipient.owed);
        if (!studentId || !Number.isFinite(owed) || owed <= 0) continue;

        const result = await notify({
          to: { studentIds: [studentId] },
          title: "Your tuition balance",
          message: `${note}\n\nOutstanding balance: ${naira(owed)}.`,
          kind: KIND.tuitionReminder,
          // Warning, so it buzzes the phone. A fee reminder nobody sees is a
          // fee reminder that gets sent again next week.
          severity: "warning",
          link: "/payments",
        });
        delivered += result.created;
      }

      return {
        summary: `Reminded ${delivered} student${delivered === 1 ? "" : "s"}, each with their own balance.`,
        details: { delivered },
      };
    },
  },

  /* ------------------------------------------------------------- attendance */
  {
    name: "mark_attendance",
    capability: "attendance",
    reversible: true,
    spec: {
      type: "function",
      function: {
        name: "mark_attendance",
        description:
          "Propose marking a whole class register for one day — for example everyone in the Lagos A1 morning class present today. Use only when the admin names a branch, a level and a day.",
        parameters: {
          type: "object",
          properties: {
            branch: FILTER_PROPERTIES.branch,
            level: FILTER_PROPERTIES.level,
            sessionSlot: { type: "string", enum: ["morning", "afternoon", "evening"] },
            date: { type: "string", description: "The class day as YYYY-MM-DD." },
            status: { type: "string", enum: ["present", "absent", "late", "excused"] },
          },
          required: ["branch", "level", "date"],
        },
      },
    },
    async plan(args, admin) {
      const date = isoDate(args, "date", "The class day");
      if (date.getTime() > Date.now() + DAY) {
        throw new PlanError("That day is in the future. A register can only be marked for a day that has happened.");
      }

      const status = str(args, "status") || "present";
      const slot = str(args, "sessionSlot") ? normalizeSlot(str(args, "sessionSlot")) : null;

      const { rows, label } = await cohortFor(
        { branch: str(args, "branch"), level: str(args, "level"), status: "active" },
        admin,
      );

      const students = await prisma.student.findMany({
        where: { id: { in: rows.map((row) => row.id) }, ...(slot ? { sessionSlot: slot } : {}) },
        select: { id: true },
      });
      const ids = new Set(students.map((student) => student.id));
      const inClass = rows.filter((row) => ids.has(row.id));

      guardCohort(inClass, `${label}${slot ? ` (${slot})` : ""}`);

      // Anything already marked for that day is an overwrite, and an overwrite
      // of a tutor's own register is exactly the thing to say out loud.
      const existing = await prisma.attendance.count({
        where: { studentId: { in: inClass.map((row) => row.id) }, date },
      });

      const warnings: string[] = [];
      if (existing > 0) {
        warnings.push(`${existing} of these already have a mark for that day — it will be replaced.`);
      }
      if (!slot) {
        warnings.push("No sitting was given, so this covers the morning, afternoon and evening classes together.");
      }

      return {
        payload: {
          studentIds: inClass.map((row) => row.id),
          date: date.toISOString(),
          status,
          label: `${label}${slot ? ` · ${slot}` : ""}`,
        },
        preview: {
          summary: `Mark ${inClass.length} student${inClass.length === 1 ? "" : "s"} ${status} on ${prettyDate(date)}`,
          affected: inClass.length,
          lines: [
            `Class: ${label}${slot ? ` · ${slot} sitting` : ""}`,
            `Every one of them is marked "${status}" for ${prettyDate(date)}.`,
            "A tutor can change any individual mark on the register afterwards.",
          ],
          warnings,
          sample: sampleOf(inClass, (row) => row.studentCode ?? row.level),
          reversible: true,
        },
      };
    },
    async execute(payload) {
      const studentIds = requireIdList(payload, "studentIds");
      const date = new Date(String(payload.date));
      const status = String(payload.status);
      const present = status === "present" || status === "late";

      let marked = 0;
      for (const studentId of studentIds) {
        // Upsert on the [studentId, date] unique key: re-running a confirmed
        // plan corrects the same rows rather than failing halfway through.
        await prisma.attendance.upsert({
          where: { studentId_date: { studentId, date } },
          create: { studentId, date, status, present, notes: "Marked by the assistant" },
          update: { status, present },
        });
        marked += 1;
      }

      return {
        summary: `Marked ${marked} student${marked === 1 ? "" : "s"} ${status} for ${prettyDate(date)}.`,
        details: { marked, status, date: date.toISOString().slice(0, 10) },
      };
    },
  },

  /* -------------------------------------------------------------- promotion */
  {
    name: "promote_students",
    capability: "students",
    reversible: false,
    spec: {
      type: "function",
      function: {
        name: "promote_students",
        description:
          "Propose moving a group of students up to the next CEFR level and starting their new batch this month. Use when a level has finished. Nothing moves until the admin confirms.",
        parameters: {
          type: "object",
          properties: {
            branch: FILTER_PROPERTIES.branch,
            level: FILTER_PROPERTIES.level,
            batch: FILTER_PROPERTIES.batch,
            classType: FILTER_PROPERTIES.classType,
          },
          required: ["level"],
        },
      },
    },
    async plan(args, admin) {
      const level = requireStr(args, "level", "The level they are finishing").toUpperCase();
      const next = nextLevelAfter(level);
      if (!next) throw new PlanError(`${level} is the top of the ladder — there is nothing above it.`);

      const { rows, label } = await cohortFor({ ...args, level, status: "active" }, admin);
      guardCohort(rows, label);

      const warnings = breadthWarnings(rows, args);
      /**
       * Money is a warning here, not a block. Whether an unpaid student moves
       * up is a decision the school makes case by case, and a tool that
       * silently refused would be quietly overriding it — but moving somebody
       * who owes ninety thousand naira without being told is the mistake this
       * line exists to prevent.
       */
      const owing = rows.filter((row) => (row.owed ?? 0) > 0);
      if (owing.length > 0) {
        const total = owing.reduce((sum, row) => sum + (row.owed ?? 0), 0);
        warnings.push(`${owing.length} of them still owe tuition, ${naira(total)} in total.`);
      }
      warnings.push("Their batch month is reset to this month, so their timetable regenerates from now.");

      return {
        payload: { studentIds: rows.map((row) => row.id), from: level, to: next, label },
        preview: {
          summary: `Move ${rows.length} student${rows.length === 1 ? "" : "s"} from ${level} up to ${next}`,
          affected: rows.length,
          lines: [
            `Cohort: ${label}`,
            `Level ${level} → ${next}.`,
            "Each of them is told, and their new timetable appears in their portal.",
          ],
          warnings,
          sample: sampleOf(rows, (row) => `${row.level} → ${next}`),
          reversible: false,
        },
      };
    },
    async execute(payload) {
      const studentIds = requireIdList(payload, "studentIds");
      const to = String(payload.to);

      const result = await promoteStudents(studentIds);

      if (result.promoted.length > 0) {
        await notify({
          to: { studentIds: result.promoted },
          title: `Welcome to ${to}`,
          message: `Congratulations — you have moved up to ${to}. Your new timetable is in your calendar.`,
          kind: KIND.levelAdvance,
          severity: "success",
          link: "/calendar",
        });
      }

      return {
        summary: `Moved ${result.promoted.length} student${result.promoted.length === 1 ? "" : "s"} up to ${to}${
          result.skipped.length ? `, skipped ${result.skipped.length}` : ""
        }.`,
        details: { promoted: result.promoted.length, skipped: result.skipped },
      };
    },
  },

  /* ------------------------------------------------------------ class moves */
  {
    name: "postpone_class",
    capability: "classes",
    reversible: true,
    spec: {
      type: "function",
      function: {
        name: "postpone_class",
        description:
          "Propose postponing or cancelling one day's class for a branch and level, and telling that class. Use when the admin says a class will not hold.",
        parameters: {
          type: "object",
          properties: {
            branch: FILTER_PROPERTIES.branch,
            level: FILTER_PROPERTIES.level,
            timeSlot: { type: "string", enum: ["morning", "afternoon", "evening"] },
            date: { type: "string", description: "The day that will not hold, as YYYY-MM-DD." },
            newDate: {
              type: "string",
              description: "The day it moves to, as YYYY-MM-DD. Leave out to cancel outright.",
            },
            reason: { type: "string", description: "What the students are told. One short sentence." },
          },
          required: ["branch", "level", "date", "reason"],
        },
      },
    },
    async plan(args, admin) {
      const branchName = requireStr(args, "branch", "The campus");
      const level = requireStr(args, "level", "The level").toUpperCase();
      const reason = requireStr(args, "reason", "A reason the students can be told");
      const date = isoDate(args, "date", "The day that will not hold");
      const newDate = str(args, "newDate") ? isoDate(args, "newDate", "The new day") : null;
      const slot = normalizeSlot(str(args, "timeSlot") || "morning");

      if (newDate && newDate.getTime() <= date.getTime()) {
        throw new PlanError("The new day has to be after the day being moved.");
      }

      const branch = await prisma.branch.findFirst({
        where: { name: branchName },
        select: { id: true, name: true },
      });
      if (!branch) {
        throw new PlanError(`There is no campus called "${branchName}". Call list_options to see the real names.`);
      }

      const { rows } = await cohortFor({ branch: branch.name, level, status: "active" }, admin);
      const affected = await prisma.student.findMany({
        where: { id: { in: rows.map((row) => row.id) }, sessionSlot: slot },
        select: { id: true },
      });

      const warnings: string[] = [];
      if (affected.length === 0) {
        warnings.push(`No active students are in the ${branch.name} ${level} ${slot} class — nobody will be told.`);
      }
      if (date.getTime() < Date.now() - DAY) {
        warnings.push("That day has already passed.");
      }

      return {
        payload: {
          branchId: branch.id,
          branchName: branch.name,
          level,
          slot,
          date: date.toISOString(),
          newDate: newDate ? newDate.toISOString() : null,
          reason,
          studentIds: affected.map((student) => student.id),
        },
        preview: {
          summary: newDate
            ? `Move the ${branch.name} ${level} ${slot} class from ${prettyDate(date)} to ${prettyDate(newDate)}`
            : `Cancel the ${branch.name} ${level} ${slot} class on ${prettyDate(date)}`,
          affected: affected.length,
          lines: [
            `Reason given to students: ${reason}`,
            newDate ? `Postponed to ${prettyDate(newDate)}.` : "Cancelled outright, with no replacement day.",
            `${affected.length} student${affected.length === 1 ? "" : "s"} in that sitting are told and their calendar updates.`,
          ],
          warnings,
          sample: [],
          reversible: true,
        },
      };
    },
    async execute(payload) {
      const branchId = String(payload.branchId);
      const level = String(payload.level);
      const slot = String(payload.slot);
      const date = new Date(String(payload.date));
      const newDate = payload.newDate ? new Date(String(payload.newDate)) : null;
      const reason = String(payload.reason);
      const studentIds = requireIdList(payload, "studentIds");

      // The unique key is branch+level+date+slot, which is why the slot has to
      // be part of this: a branch runs the same level three times a day, and
      // dropping the slot would postpone whichever sitting was written last.
      await prisma.classSession.upsert({
        where: {
          branchId_level_date_timeSlot: { branchId, level, date, timeSlot: slot },
        },
        create: {
          branchId,
          level,
          date,
          timeSlot: slot,
          status: newDate ? "postponed" : "cancelled",
          postponedTo: newDate,
          notes: reason,
        },
        update: {
          status: newDate ? "postponed" : "cancelled",
          postponedTo: newDate,
          notes: reason,
        },
      });

      let told = 0;
      if (studentIds.length > 0) {
        const result = await notify({
          to: { studentIds },
          title: newDate ? "Your class has moved" : "Your class is cancelled",
          message: newDate
            ? `The ${level} class on ${prettyDate(date)} has moved to ${prettyDate(newDate)}. ${reason}`
            : `The ${level} class on ${prettyDate(date)} will not hold. ${reason}`,
          kind: KIND.classStarting,
          severity: "warning",
          link: "/calendar",
        });
        told = result.created;
      }

      return {
        summary: newDate
          ? `Moved the ${payload.branchName} ${level} ${slot} class to ${prettyDate(newDate)} and told ${told} student${told === 1 ? "" : "s"}.`
          : `Cancelled the ${payload.branchName} ${level} ${slot} class on ${prettyDate(date)} and told ${told} student${told === 1 ? "" : "s"}.`,
        details: { told, status: newDate ? "postponed" : "cancelled" },
      };
    },
  },

  /* ----------------------------------------------------------- lead chasing */
  {
    name: "invite_leads",
    capability: "students",
    reversible: false,
    spec: {
      type: "function",
      function: {
        name: "invite_leads",
        description:
          "Propose emailing the enrolment link to people who enquired but have not signed up. Use when the admin wants to chase enquiries.",
        parameters: {
          type: "object",
          properties: {
            branch: FILTER_PROPERTIES.branch,
            level: { type: "string", description: "Only enquiries about this level, e.g. A1." },
            enquiredWithinDays: {
              type: "number",
              description: "Only enquiries from the last N days. Default 60.",
            },
            includeAlreadyInvited: {
              type: "boolean",
              description: "Also re-invite people who were already sent a link once. Default false.",
            },
          },
        },
      },
    },
    async plan(args) {
      const days = Number(args.enquiredWithinDays);
      const window = Number.isFinite(days) && days > 0 ? Math.min(365, days) : 60;
      const again = args.includeAlreadyInvited === true;
      const branchName = str(args, "branch");
      const level = str(args, "level").toUpperCase();

      const branch = branchName
        ? await prisma.branch.findFirst({ where: { name: branchName }, select: { id: true, name: true } })
        : null;
      if (branchName && !branch) {
        throw new PlanError(`There is no campus called "${branchName}". Call list_options to see the real names.`);
      }

      const leads = await prisma.lead.findMany({
        where: {
          status: again ? { in: ["new", "invited"] } : "new",
          createdAt: { gte: new Date(Date.now() - window * DAY) },
          ...(branch ? { branchId: branch.id } : {}),
          ...(level ? { interestedLevel: level } : {}),
        },
        select: { id: true, name: true, email: true, interestedLevel: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: MAX_AFFECTED,
      });

      if (leads.length === 0) {
        throw new PlanError("No open enquiries match that. Say so rather than proposing an empty send.");
      }

      const warnings: string[] = [];
      if (again) warnings.push("This includes people who have already been sent a link once.");
      if (!process.env.MAILERSEND_API_KEY) {
        // The single most useful warning in the file: without a key the send
        // succeeds, the leads are marked invited, and no email ever arrives.
        warnings.push("No email provider key is configured — these will queue but not actually be delivered.");
      }

      return {
        payload: { leadIds: leads.map((lead) => lead.id) },
        preview: {
          summary: `Email an enrolment link to ${leads.length} enquir${leads.length === 1 ? "y" : "ies"}`,
          affected: leads.length,
          lines: [
            `Enquiries from the last ${window} days${branch ? ` at ${branch.name}` : ""}${level ? ` about ${level}` : ""}.`,
            "Each gets a link that pre-fills their details on the signup page.",
            "They are marked as invited, so they stop showing as un-chased.",
          ],
          warnings,
          sample: leads.slice(0, 4).map((lead) => ({
            name: lead.name,
            detail: `${lead.email}${lead.interestedLevel ? ` · ${lead.interestedLevel}` : ""}`,
          })),
          reversible: false,
        },
      };
    },
    async execute(payload) {
      const leadIds = requireIdList(payload, "leadIds");
      const result = await inviteLeads(leadIds);
      return {
        summary: `Sent enrolment links to ${result.invited.length} enquir${result.invited.length === 1 ? "y" : "ies"}${
          result.skipped.length ? `, skipped ${result.skipped.length}` : ""
        }.`,
        details: { invited: result.invited.length, skipped: result.skipped },
      };
    },
  },
];

/* -------------------------------------------------------------------------- */
/* Registry                                                                   */
/* -------------------------------------------------------------------------- */

export function actionsFor(admin: AdminContext): AssistantAction[] {
  return ASSISTANT_ACTIONS.filter((action) => admin.can(action.capability));
}

export function actionSpecsFor(admin: AdminContext): ToolSpec[] {
  return actionsFor(admin).map((action) => action.spec);
}

export function findAction(name: string): AssistantAction | undefined {
  return ASSISTANT_ACTIONS.find((action) => action.name === name);
}

export function isActionName(name: string): boolean {
  return ASSISTANT_ACTIONS.some((action) => action.name === name);
}
