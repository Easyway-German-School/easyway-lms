import { isTenantOwned, isGloballyShared } from "@/lib/tenant/registry";
import { isolationMode, type TenantScope } from "@/lib/tenant/context";

/**
 * The filter that sits underneath every query.
 *
 * The problem this replaces: isolation used to be a helper you had to remember
 * to call, and it was called on one route out of fifty-one. Discipline does not
 * scale to a platform — the forty-seventh route somebody writes at 2am is the
 * one that leaks. So the filter moves underneath the query, where forgetting is
 * not an available option.
 *
 * There are two layers, and this is the inner one. Postgres row-level security
 * (see prisma/manual/) is the outer one and covers anything that
 * bypasses Prisma entirely, including raw SQL and a psql session. Neither layer
 * is trusted to be sufficient alone: this one is ergonomic but only applies to
 * code that goes through it, and RLS is absolute but easy to misconfigure. The
 * pair is the design.
 *
 * This file deliberately imports nothing from lib/prisma — it is a factory the
 * client is built from, and importing the client it extends would be a cycle.
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
 * Warn once per model+operation rather than per query.
 *
 * A warning printed on every query is a warning that gets filtered out of the
 * log within a day, and the one path that actually needed fixing goes with it.
 */
const warned = new Set<string>();

export function createTenantExtension(resolveScope: () => TenantScope | undefined) {
  return {
    name: "tenant-isolation",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }: any) {
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

          const scope = resolveScope();

          if (scope?.kind === "unscoped") return query(args);

          if (scope?.kind !== "tenant") {
            const where =
              `${model}.${operation} ran with no tenant in context. ` +
              `Wrap it in runUnscoped("why this spans every tenant", ...) if that is deliberate, ` +
              `or make sure the request passes through a gate that calls setTenantScope().`;

            if (isolationMode() === "strict") throw new TenantIsolationError(where);

            const key = `${model}.${operation}`;
            if (!warned.has(key)) {
              warned.add(key);
              console.warn(`[tenant] UNSCOPED (TENANT_ISOLATION=warn): ${where}`);
            }
            return query(args);
          }

          const { tenantId } = scope;
          const a = (args ?? {}) as Record<string, any>;

          if (READ_OPERATIONS.has(operation) || WRITE_WITH_WHERE.has(operation)) {
            return query({ ...a, where: { ...(a.where ?? {}), tenantId } });
          }

          /**
           * findUnique cannot carry a non-unique filter on its own, but Prisma's
           * WhereUniqueInput has accepted extra scalar filters alongside the
           * unique one since 4.16 — so the clause attaches without rewriting the
           * operation. Without it, every lookup by primary key would be a hole,
           * and lookup by primary key is how most detail pages load.
           */
          if (UNIQUE_READ_OPERATIONS.has(operation)) {
            return query({ ...a, where: { ...(a.where ?? {}), tenantId } });
          }

          if (CREATE_OPERATIONS.has(operation)) {
            if (Array.isArray(a.data)) {
              return query({ ...a, data: a.data.map((row: any) => ({ ...row, tenantId })) });
            }
            return query({ ...a, data: { ...(a.data ?? {}), tenantId } });
          }

          if (operation === "upsert") {
            /**
             * The tenant goes on the lookup and on the row that gets created,
             * but never on the update. An upsert that matches another tenant's
             * row simply will not match — it falls through to create and fails
             * on the unique constraint, which is loud and safe, rather than
             * quietly overwriting somebody else's record.
             */
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
  };
}
