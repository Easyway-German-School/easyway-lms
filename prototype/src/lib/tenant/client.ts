import { prisma } from "@/lib/prisma";
import { isTenantOwned, isGloballyShared } from "@/lib/tenant/registry";

/**
 * A Prisma client that cannot read or write another tenant's rows.
 *
 * The problem this replaces: isolation used to be a helper you had to remember
 * to call, and it was called on four routes out of fifty-one. Discipline does
 * not scale to a platform — the forty-seventh route somebody writes at 2am is
 * the one that leaks. So the filter moves underneath the query, where
 * forgetting is not an available option.
 *
 * There are two layers, and this is the inner one. Postgres row-level security
 * (see prisma/migrations/manual/) is the outer one and covers anything that
 * bypasses Prisma entirely, including raw SQL and a psql session. Neither layer
 * is trusted to be sufficient alone: this one is ergonomic but only applies to
 * code that goes through it, and RLS is absolute but easy to misconfigure. The
 * pair is the design.
 */

/** Thrown rather than returning nothing, so a mistake is loud instead of empty. */
export class TenantIsolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantIsolationError";
  }
}

const READ_OPERATIONS = new Set([
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
]);

const UNIQUE_READ_OPERATIONS = new Set(["findUnique", "findUniqueOrThrow"]);

const WRITE_WITH_WHERE = new Set(["update", "updateMany", "delete", "deleteMany"]);

const CREATE_OPERATIONS = new Set(["create", "createMany", "createManyAndReturn"]);

/**
 * The scoped client.
 *
 * `tenantId` is required and non-nullable on purpose. The previous helper,
 * `tenantWhere()`, returned `{}` when it had no tenant — meaning "no filter",
 * meaning every row. For an internal admin tool that default was merely
 * convenient; for a platform it is precisely backwards. Absence of a tenant
 * must mean deny, never mean all, so there is no way to spell "no tenant" here
 * short of calling `unscopedClient()` and explaining yourself.
 */
export function tenantClient(tenantId: string) {
  if (!tenantId || typeof tenantId !== "string") {
    throw new TenantIsolationError(
      "tenantClient() requires a tenant id. If this call genuinely spans tenants, use unscopedClient(reason).",
    );
  }

  return prisma.$extends({
    name: "tenant-isolation",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!isTenantOwned(model)) {
            /**
             * Unknown models fail closed. A table that is in neither list is
             * almost certainly one somebody just added and has not thought
             * about yet, and the safe reading of "I don't know who owns this"
             * is not "everyone may see it".
             */
            if (!isGloballyShared(model)) {
              throw new TenantIsolationError(
                `Model "${model}" is not classified in the tenant registry. Add it to TENANT_OWNED_MODELS or GLOBAL_MODELS before querying it.`,
              );
            }
            return query(args);
          }

          const a = (args ?? {}) as Record<string, any>;

          if (READ_OPERATIONS.has(operation) || WRITE_WITH_WHERE.has(operation)) {
            return query({ ...a, where: { ...(a.where ?? {}), tenantId } });
          }

          /**
           * findUnique cannot carry a non-unique filter, so a tenant clause
           * would be rejected by the query builder. Rewriting to findFirst
           * keeps the same single-row semantics while allowing the filter —
           * without this, every lookup by primary key would be a hole, and
           * lookup by primary key is how most detail pages load.
           */
          if (UNIQUE_READ_OPERATIONS.has(operation)) {
            const rewritten = operation === "findUnique" ? "findFirst" : "findFirstOrThrow";
            const delegate = (prisma as any)[lowerFirst(model)];
            return delegate[rewritten]({ ...a, where: { ...(a.where ?? {}), tenantId } });
          }

          if (CREATE_OPERATIONS.has(operation)) {
            if (Array.isArray(a.data)) {
              return query({ ...a, data: a.data.map((row: any) => ({ ...row, tenantId })) });
            }
            return query({ ...a, data: { ...(a.data ?? {}), tenantId } });
          }

          if (operation === "upsert") {
            return query({
              ...a,
              where: { ...(a.where ?? {}), tenantId },
              create: { ...(a.create ?? {}), tenantId },
              update: { ...(a.update ?? {}) },
            });
          }

          /**
           * Anything not named above — a future Prisma operation, most likely.
           * Refused rather than passed through unfiltered, because passing it
           * through is the same mistake this file exists to make impossible.
           */
          throw new TenantIsolationError(
            `Operation "${operation}" on tenant-owned model "${model}" is not handled by the isolation extension. Add explicit handling before using it.`,
          );
        },
      },
    },
  });
}

function lowerFirst(value: string) {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

/**
 * The deliberate way out, for the small number of jobs that legitimately span
 * every tenant: the nightly cron, the backup runner, operator tooling.
 *
 * It takes a written reason and logs it. That is not ceremony — an unscoped
 * client is the one object in this codebase that can read every school's data
 * at once, and the log is what lets somebody later answer "what ran across all
 * tenants last Tuesday, and why". Grepping for this function is also the
 * fastest audit of where isolation is bypassed on purpose.
 */
export function unscopedClient(reason: string) {
  if (!reason || reason.trim().length < 10) {
    throw new TenantIsolationError(
      "unscopedClient() requires a reason describing why this operation spans every tenant.",
    );
  }
  console.info(`[tenant] unscoped access: ${reason}`);
  return prisma;
}
