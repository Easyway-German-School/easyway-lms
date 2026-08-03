import { Prisma, type PrismaClient } from "@prisma/client";
import { getAuditActor } from "@/lib/audit-context";

/**
 * The layer that stands between the application and an irreversible mistake.
 *
 * It does three things, in order of how often they will matter:
 *
 *   1. Turns `delete` into `deletedAt = now()` on the models whose removal
 *      would cascade. The schema has 42 `onDelete: Cascade` relations, so a
 *      single `student.delete()` today takes that student's payments,
 *      attendance, grades, certificates, community posts and recordings with
 *      it — in one statement, with no record that it happened.
 *
 *   2. Writes the before image of every destructive write to AuditLog, so one
 *      row can be put back without restoring the whole database to Tuesday.
 *
 *   3. Refuses writes with no WHERE clause. `deleteMany({})` is valid Prisma
 *      and means "every row in this table".
 *
 * None of this replaces backups. It covers the failure that actually happens
 * — a person, in a hurry, on the right database — while backups cover the one
 * everybody plans for and almost nobody meets.
 */

/**
 * Models where delete becomes an update.
 *
 * Two things get a model onto this list: it is the parent of a cascade, or it
 * is a financial or legal record the school must still be able to produce next
 * year. Anything here also gets `deletedAt IS NULL` folded into its reads, so
 * the rest of the application carries on as though the row is gone.
 */
export const SOFT_DELETE_MODELS = new Set<string>([
  "User",
  "Student",
  "Lecturer",
  "Branch",
  "Class",
  "Course",
  "Pathway",
  "Material",
  "ClassRecording",
  "Invoice",
  "Payment",
  "Certificate",
]);

/**
 * Models where creates and updates are recorded too, not just deletes.
 *
 * Kept to a list rather than "everything" for a reason that shows up in the
 * bill and the page load: capturing a before image costs an extra read on
 * every write, and models like VideoProgress and ChannelRead are written on
 * essentially every page view. Auditing those would double the query count of
 * the whole portal to record that a student watched four more seconds of a
 * video. What is on this list is what somebody might one day have to answer a
 * question about — money, marks, identity, access.
 */
export const FULLY_AUDITED_MODELS = new Set<string>([
  "User",
  "Student",
  "Lecturer",
  "Branch",
  "Invoice",
  "Payment",
  "Certificate",
  "ExamRegistration",
  "Grade",
  "Attendance",
  "Enrollment",
  "AdminAction",
  "Class",
  "Material",
  "ClassRecording",
  "Exam",
  "PrivateClass",
]);

/**
 * Never audited, at any operation.
 *
 * AuditLog and BackupRun are excluded to stop the trail recording itself into
 * an infinite regress. The rest are high-frequency bookkeeping whose history
 * nobody will ever ask for, and whose volume would bury the rows that matter.
 */
const NEVER_AUDITED_MODELS = new Set<string>([
  "AuditLog",
  "BackupRun",
  "Session",
  "VideoProgress",
  "Progress",
  "MissionProgress",
  "ChannelRead",
  "PushSubscription",
  "Notification",
  "EmailLog",
  "EmailMessage",
  "Completion",
]);

/**
 * How many rows one statement may remove before the guard stops it.
 *
 * Set where it is because no legitimate screen in this application deletes
 * more than a couple of hundred rows at once, while every catastrophe does.
 * A job that genuinely needs to exceed it says so, in code, by running inside
 * `runWithAuditActor({ allowUnscopedWrites: true })`.
 */
const MAX_ROWS_PER_DESTRUCTIVE_WRITE = 200;

/** Before images are capped so one bulk write cannot store a whole table. */
const MAX_BEFORE_IMAGE_ROWS = 500;

const READ_OPERATIONS = new Set([
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
]);

/** The only AuditLog columns anything may ever change. Mirrors the DB trigger. */
const AUDIT_MUTABLE_FIELDS = new Set(["restorable", "restoredAt", "restoredById"]);

export class GuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuardError";
  }
}

/**
 * Build the extension.
 *
 * Takes the unextended client because the guard has to issue queries of its
 * own — reading a row before it changes, and rewriting a delete into an
 * update — and those must not pass back through the guard. Going through the
 * extended client instead would recurse: the rewritten update would be
 * audited as an update, and the before-image read would be filtered by the
 * very soft-delete rule it is trying to see past.
 */
export function createGuardExtension(base: PrismaClient) {
  const delegate = (model: string) =>
    (base as unknown as Record<string, Record<string, (args: unknown) => Promise<unknown>>>)[
      lowerFirst(model)
    ];

  return Prisma.defineExtension({
    name: "easyway-guard",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const softDeleted = SOFT_DELETE_MODELS.has(model);
          const typedArgs = (args ?? {}) as Record<string, unknown>;

          // -----------------------------------------------------------------
          // The trail defends itself.
          //
          // Postgres enforces this too (see the AuditLog_immutable trigger),
          // and that is the copy that counts. This one exists to fail early
          // with a sentence a developer can act on, rather than surfacing as
          // a raw database exception three layers up.
          // -----------------------------------------------------------------
          if (model === "AuditLog") {
            if (operation === "delete" || operation === "deleteMany") {
              throw new GuardError(
                "AuditLog is append-only — entries cannot be deleted. Retention pruning is a documented manual procedure, see docs/SECURITY.md.",
              );
            }
            if (operation === "update" || operation === "updateMany") {
              const data = (typedArgs.data ?? {}) as Record<string, unknown>;
              const illegal = Object.keys(data).filter((k) => !AUDIT_MUTABLE_FIELDS.has(k));
              if (illegal.length) {
                throw new GuardError(
                  `AuditLog is append-only — cannot modify ${illegal.join(", ")}. Only restore bookkeeping may change.`,
                );
              }
            }
          }

          // -----------------------------------------------------------------
          // Reads: hide the soft-deleted.
          // -----------------------------------------------------------------
          if (softDeleted && READ_OPERATIONS.has(operation)) {
            const where = (typedArgs.where ?? {}) as Record<string, unknown>;
            // An explicit mention of deletedAt means the caller is deliberately
            // asking about deleted rows — the restore screen, the retention
            // job — so their intent wins over the default.
            if (where.deletedAt === undefined) {
              typedArgs.where = { ...where, deletedAt: null };
              return query(typedArgs);
            }
          }

          // findUnique cannot take a non-unique filter, so the row is fetched
          // and then withheld. It returns at most one row, which makes the
          // cost of checking after exactly one row read.
          if (
            softDeleted &&
            (operation === "findUnique" || operation === "findUniqueOrThrow")
          ) {
            const row = (await query(typedArgs)) as { deletedAt?: Date | null } | null;
            if (row && row.deletedAt) {
              if (operation === "findUniqueOrThrow") {
                throw new Prisma.PrismaClientKnownRequestError(
                  `No ${model} found (the record was deleted).`,
                  { code: "P2025", clientVersion: Prisma.prismaVersion.client },
                );
              }
              return null;
            }
            return row;
          }

          const audited = !NEVER_AUDITED_MODELS.has(model);

          // -----------------------------------------------------------------
          // delete / deleteMany
          // -----------------------------------------------------------------
          if (operation === "delete" || operation === "deleteMany") {
            const where = typedArgs.where as Record<string, unknown> | undefined;
            assertScoped(model, operation, where);

            const before = await captureBefore(delegate(model), where, operation);
            assertBlastRadius(model, operation, before.count);

            if (softDeleted) {
              const now = new Date();
              const target = delegate(model);
              const result =
                operation === "delete"
                  ? await target.update({ where, data: { deletedAt: now } })
                  : await target.updateMany({ where, data: { deletedAt: now } });

              if (audited) {
                await writeAudit(base, {
                  action: operation,
                  model,
                  recordId: before.singleId,
                  before: before.image,
                  affectedCount: before.count,
                  restorable: true,
                  severity: before.count > 1 ? "alert" : "notice",
                  summary: `Soft-deleted ${before.count} ${model} row(s)`,
                });
              }
              return operation === "delete" ? result : { count: before.count };
            }

            // Not on the soft-delete list: the row really goes. The before
            // image is the only way back, so the audit write is not allowed
            // to fail quietly here.
            const result = await query(typedArgs);
            if (audited) {
              await writeAudit(
                base,
                {
                  action: operation,
                  model,
                  recordId: before.singleId,
                  before: before.image,
                  affectedCount: before.count,
                  restorable: true,
                  severity: before.count > 1 ? "alert" : "notice",
                  summary: `Deleted ${before.count} ${model} row(s)`,
                },
                { required: true },
              );
            }
            return result;
          }

          // -----------------------------------------------------------------
          // update / updateMany
          // -----------------------------------------------------------------
          if (operation === "update" || operation === "updateMany") {
            const where = typedArgs.where as Record<string, unknown> | undefined;
            if (operation === "updateMany") assertScoped(model, operation, where);

            if (!audited || !FULLY_AUDITED_MODELS.has(model)) return query(typedArgs);

            const before = await captureBefore(delegate(model), where, operation);
            const result = await query(typedArgs);

            await writeAudit(base, {
              action: operation,
              model,
              recordId: before.singleId,
              before: before.image,
              after: operation === "update" ? toJsonValue(result) : undefined,
              affectedCount: before.count,
              // An update is reversible from its before image, but putting it
              // back is a field-by-field decision a human has to make, not the
              // one-click restore that a delete gets.
              restorable: false,
              severity: "info",
              summary: `Updated ${before.count} ${model} row(s)`,
            });
            return result;
          }

          // -----------------------------------------------------------------
          // create
          // -----------------------------------------------------------------
          if (operation === "create" && audited && FULLY_AUDITED_MODELS.has(model)) {
            const result = await query(typedArgs);
            const created = result as { id?: string } | null;
            await writeAudit(base, {
              action: "create",
              model,
              recordId: created?.id,
              after: toJsonValue(result),
              affectedCount: 1,
              severity: "info",
              summary: `Created ${model}`,
            });
            return result;
          }

          return query(typedArgs);
        },
      },
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Guards                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * `deleteMany({})` is not a mistake Prisma will stop you making.
 *
 * It is legal, it type-checks, and it means every row in the table. The same
 * goes for a where clause built from a variable that turned out to be
 * undefined, which is the more common way to arrive here — `{ branchId:
 * undefined }` is not "no branch", it is "no condition at all", and Prisma
 * silently drops it.
 */
function assertScoped(model: string, operation: string, where: unknown): void {
  const keys = where && typeof where === "object" ? Object.keys(where as object) : [];
  const meaningful = keys.filter(
    (k) => (where as Record<string, unknown>)[k] !== undefined,
  );
  if (meaningful.length > 0) return;
  if (getAuditActor()?.allowUnscopedWrites) return;

  throw new GuardError(
    `Refusing ${model}.${operation} with no WHERE clause — this would affect every row in the table. ` +
      `If that is genuinely intended, run it inside runWithAuditActor({ allowUnscopedWrites: true }).`,
  );
}

function assertBlastRadius(model: string, operation: string, count: number): void {
  if (count <= MAX_ROWS_PER_DESTRUCTIVE_WRITE) return;
  if (getAuditActor()?.allowUnscopedWrites) return;

  throw new GuardError(
    `Refusing ${model}.${operation}: it would affect ${count} rows, over the ${MAX_ROWS_PER_DESTRUCTIVE_WRITE} limit. ` +
      `Narrow the filter, or run it inside runWithAuditActor({ allowUnscopedWrites: true }) if the size is intended.`,
  );
}

/* -------------------------------------------------------------------------- */
/* Before images                                                               */
/* -------------------------------------------------------------------------- */

type BeforeImage = {
  image: unknown;
  count: number;
  /** Set only when the statement concerns exactly one row. */
  singleId?: string;
};

async function captureBefore(
  target: Record<string, (args: unknown) => Promise<unknown>>,
  where: unknown,
  operation: string,
): Promise<BeforeImage> {
  if (!target) return { image: null, count: 0 };

  const single = operation === "delete" || operation === "update";
  try {
    if (single) {
      const row = (await target.findFirst({ where })) as { id?: string } | null;
      return {
        image: row ? toJsonValue(row) : null,
        count: row ? 1 : 0,
        singleId: row?.id,
      };
    }

    const rows = (await target.findMany({ where, take: MAX_BEFORE_IMAGE_ROWS })) as unknown[];
    // The count is taken separately because `take` caps the image, not the
    // statement — a deleteMany that hits 5000 rows must still be reported as
    // 5000 to the blast-radius guard even though only 500 are stored.
    const total = (await target.count({ where })) as unknown as number;
    return {
      image: rows.map(toJsonValue),
      count: typeof total === "number" ? total : rows.length,
      singleId: rows.length === 1 ? (rows[0] as { id?: string })?.id : undefined,
    };
  } catch {
    // A model without `findFirst` in the shape expected, or a where clause the
    // read cannot express. Losing the image must not block the write, or a
    // quirk of one table takes a working feature down with it.
    return { image: null, count: single ? 1 : 0 };
  }
}

/* -------------------------------------------------------------------------- */
/* Writing the trail                                                           */
/* -------------------------------------------------------------------------- */

type AuditEntry = {
  action: string;
  model?: string;
  recordId?: string;
  before?: unknown;
  after?: unknown;
  affectedCount?: number;
  restorable?: boolean;
  severity?: string;
  summary?: string;
};

/**
 * Write one entry.
 *
 * `required` marks the case where the entry is the only remaining copy of the
 * data — a hard delete — and a failure to record it is therefore worse than a
 * failed request. Everywhere else the trail is best-effort on purpose: an
 * audit bug should not be able to take the school's portal down, and a
 * missing "Student updated" line is a smaller problem than a class of
 * students unable to load their timetable.
 */
export async function writeAudit(
  base: PrismaClient,
  entry: AuditEntry,
  options: { required?: boolean } = {},
): Promise<void> {
  const actor = getAuditActor();
  try {
    await base.auditLog.create({
      data: {
        action: entry.action,
        model: entry.model ?? null,
        recordId: entry.recordId ?? null,
        before: (entry.before ?? null) as Prisma.InputJsonValue,
        after: (entry.after ?? null) as Prisma.InputJsonValue,
        affectedCount: entry.affectedCount ?? 1,
        summary: entry.summary ?? null,
        actorId: actor?.userId ?? null,
        actorEmail: actor?.email ?? null,
        actorRole: actor?.role ?? null,
        source: actor?.source ?? "app",
        ip: actor?.ip ?? null,
        userAgent: actor?.userAgent ?? null,
        route: actor?.route ?? null,
        requestId: actor?.requestId ?? null,
        severity: entry.severity ?? "info",
        restorable: entry.restorable ?? false,
      },
    });
  } catch (error) {
    if (options.required) {
      throw new GuardError(
        `Audit write failed for ${entry.action} on ${entry.model}; the operation is not safe to consider complete. Cause: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    console.error("[audit] failed to record entry", entry.action, entry.model, error);
  }
}

/* -------------------------------------------------------------------------- */
/* Serialisation                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Prisma rows are not JSON.
 *
 * They carry Date, Decimal and BigInt, and `JSON.stringify` throws outright on
 * the last of those — BackupRun.sizeBytes would be enough to break the whole
 * trail. Everything is flattened to a string form that survives the round trip
 * and can be handed back to Prisma on restore.
 */
export function toJsonValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (Buffer.isBuffer(value)) return value.toString("base64");
  if (Array.isArray(value)) return value.map(toJsonValue);
  if (typeof value === "object") {
    // Prisma.Decimal and anything else that knows how to describe itself.
    const maybeDecimal = value as { toFixed?: () => string; constructor?: { name?: string } };
    if (maybeDecimal.constructor?.name === "Decimal" && typeof maybeDecimal.toFixed === "function") {
      return maybeDecimal.toFixed();
    }
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = toJsonValue(item);
    }
    return out;
  }
  return value;
}

function lowerFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}
