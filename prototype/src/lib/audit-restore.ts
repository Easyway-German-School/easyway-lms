import { prisma, unguardedPrisma } from "@/lib/prisma";
import { SOFT_DELETE_MODELS, writeAudit } from "@/lib/prisma-guard";

/**
 * Putting one record back.
 *
 * This is the whole reason the audit trail stores before images. The disaster
 * everyone prepares for is the database being lost; the disaster that actually
 * arrives is a secretary removing the wrong student on Tuesday and nobody
 * noticing until Friday. A backup answers the first and is actively harmful
 * for the second — rolling the school back to Tuesday would discard three
 * days of payments, attendance and marks to recover one row.
 *
 * There are two ways back, decided by how the row left:
 *
 *   soft-deleted  the row never went anywhere; clearing `deletedAt` is enough
 *                 and nothing else in the database has moved.
 *   hard-deleted  the row is genuinely gone and is written again from its
 *                 before image. This can fail, and the honest reason is worth
 *                 stating: a row is only insertable if the things it points at
 *                 still exist. Restoring a Payment whose Student was also
 *                 removed will be refused by the foreign key, and the fix is
 *                 to restore the student first.
 */

export type RestoreResult = {
  ok: boolean;
  restored: number;
  message: string;
};

export async function restoreFromAudit(
  auditId: string,
  actorId: string | null,
): Promise<RestoreResult> {
  const entry = await prisma.auditLog.findUnique({ where: { id: auditId } });

  if (!entry) {
    return { ok: false, restored: 0, message: "That audit entry no longer exists." };
  }
  if (!entry.restorable) {
    return {
      ok: false,
      restored: 0,
      message:
        entry.restoredAt
          ? "This record has already been restored."
          : "This entry is not restorable — only deletions can be undone this way.",
    };
  }
  if (!entry.model || entry.before == null) {
    return { ok: false, restored: 0, message: "This entry has no before image to restore from." };
  }

  const rows = Array.isArray(entry.before)
    ? (entry.before as Record<string, unknown>[])
    : [entry.before as Record<string, unknown>];

  const model = entry.model;
  const table = (unguardedPrisma as unknown as Record<string, Record<string, (a: unknown) => Promise<unknown>>>)[
    lowerFirst(model)
  ];
  if (!table) {
    return { ok: false, restored: 0, message: `Unknown model "${model}".` };
  }

  let restored = 0;
  const failures: string[] = [];

  for (const row of rows) {
    const id = typeof row.id === "string" ? row.id : undefined;
    try {
      if (SOFT_DELETE_MODELS.has(model) && id) {
        // The unguarded client on purpose: the guarded one filters out exactly
        // the rows this is trying to reach.
        await table.update({ where: { id }, data: { deletedAt: null } });
      } else {
        await table.create({ data: stripUnwritable(row) });
      }
      restored += 1;
    } catch (error) {
      failures.push(
        `${id ?? "(no id)"}: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`,
      );
    }
  }

  if (restored > 0) {
    /**
     * The bookkeeping must not be able to undo the rescue.
     *
     * Marking the entry as restored is the least important thing happening
     * here, and it is the only part that can fail on its own — an actor id
     * that no longer resolves to a user, say, because the person who deleted
     * the record has since left. Letting that throw would report a failed
     * restore to somebody who is looking at rows that came back perfectly
     * well, and the obvious next move — press it again — would then try to
     * re-create rows that already exist.
     */
    try {
      await prisma.auditLog.update({
        where: { id: auditId },
        data: { restorable: false, restoredAt: new Date(), restoredById: actorId },
      });
    } catch {
      await prisma.auditLog
        .update({
          where: { id: auditId },
          data: { restorable: false, restoredAt: new Date(), restoredById: null },
        })
        .catch(() => {});
    }
    // The restore is itself an event worth recording. Somebody bringing a
    // deleted record back is as interesting as somebody deleting one, and on
    // a bad day it is the more interesting of the two.
    await writeAudit(unguardedPrisma, {
      action: "restore",
      model,
      recordId: entry.recordId ?? undefined,
      after: entry.before,
      affectedCount: restored,
      severity: "notice",
      summary: `Restored ${restored} ${model} row(s) from audit entry ${auditId}`,
    });
  }

  if (failures.length) {
    return {
      ok: restored > 0,
      restored,
      message:
        `Restored ${restored} of ${rows.length}. ` +
        `Failed: ${failures.slice(0, 3).join("; ")}` +
        (failures.length > 3 ? ` (+${failures.length - 3} more)` : "") +
        ". A row that points at something also deleted must wait until that is restored first.",
    };
  }

  return {
    ok: true,
    restored,
    message: `Restored ${restored} ${model} row${restored === 1 ? "" : "s"}.`,
  };
}

/**
 * Drop the fields a write must not carry back.
 *
 * `updatedAt` is managed by Prisma and will be refused if supplied, and
 * `deletedAt` has to come back as null or the row would be restored into the
 * same invisible state it was rescued from.
 */
function stripUnwritable(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === "updatedAt" || key === "deletedAt") continue;
    if (value === null) continue;
    out[key] = value;
  }
  return out;
}

function lowerFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}
