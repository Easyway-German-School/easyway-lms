import { Prisma } from "@prisma/client";

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

/**
 * ---------------------------------------------------------------------------
 * NESTED WRITES
 * ---------------------------------------------------------------------------
 * A Prisma client extension is handed the TOP-LEVEL model and operation only.
 * `user.create({ data: { lecturer: { create: {...} } } })` arrives here as one
 * `User.create` — the Lecturer row it also writes is invisible to everything
 * below, so it was created with no tenant at all.
 *
 * That is not a hypothetical. Every tutor created from the admin screen after
 * the tenant layer went in, and every self-signup student, landed with
 * `tenantId = NULL`: invisible to their own school's tenant-scoped reads, and
 * holding a session with no tenant, which in strict mode makes every query in
 * their portal throw. The admin board stopped showing tutors it had just
 * created, and those tutors were bounced straight back out of the portal.
 *
 * So the walk below stamps nested creates the same way the top-level one is
 * stamped. It STAMPS rather than refusing: refusing would be truer to the
 * "fail closed" spirit of this file, but it would also turn every unfixed call
 * site into a 500 at the moment of deploy, and adding the correct owner is
 * never the unsafe direction. The relation map comes from the generated DMMF
 * rather than a hand-kept list, so a relation added later is covered without
 * anybody remembering this file exists.
 */

let relationIndex: Map<string, Map<string, string>> | null = null;

/** Which model does `model.field` point at, if it is a relation at all? */
function relatedModel(model: string, field: string): string | undefined {
  if (!relationIndex) {
    relationIndex = new Map();
    for (const entry of Prisma.dmmf.datamodel.models) {
      const fields = new Map<string, string>();
      for (const field of entry.fields) {
        if (field.kind === "object" && typeof field.type === "string") {
          fields.set(field.name, field.type);
        }
      }
      relationIndex.set(entry.name, fields);
    }
  }
  return relationIndex.get(model)?.get(field);
}

/** `{...row, tenantId}` for one row or a list of them. */
function stampRows(target: string, rows: unknown, tenantId: string): unknown {
  if (Array.isArray(rows)) return rows.map((row) => stampRows(target, row, tenantId));
  if (!rows || typeof rows !== "object") return rows;
  const row = rows as Record<string, unknown>;
  // Recurse first: a nested create can itself nest another one.
  const inner = stampNestedCreates(target, row, tenantId) as Record<string, unknown>;
  return isTenantOwned(target) ? { ...inner, tenantId } : inner;
}

/**
 * Walk one `data` payload and stamp every nested create of a tenant-owned
 * model. Handles the four shapes Prisma accepts for a nested write; anything
 * else (`connect`, `set`, plain scalars) is passed through untouched.
 */
function stampNestedCreates(
  model: string,
  data: unknown,
  tenantId: string,
): Record<string, unknown> | unknown {
  if (Array.isArray(data)) return data.map((row) => stampNestedCreates(model, row, tenantId));
  if (!data || typeof data !== "object") return data;

  const source = data as Record<string, unknown>;
  let changed = false;
  const out: Record<string, unknown> = { ...source };

  for (const [key, value] of Object.entries(source)) {
    if (!value || typeof value !== "object") continue;
    const target = relatedModel(model, key);
    if (!target) continue;

    const relation = { ...(value as Record<string, unknown>) };
    let touched = false;

    if ("create" in relation) {
      relation.create = stampRows(target, relation.create, tenantId);
      touched = true;
    }

    if ("connectOrCreate" in relation && relation.connectOrCreate) {
      const branches = relation.connectOrCreate;
      const stampBranch = (branch: unknown) => {
        if (!branch || typeof branch !== "object") return branch;
        const entry = branch as Record<string, unknown>;
        return { ...entry, create: stampRows(target, entry.create, tenantId) };
      };
      relation.connectOrCreate = Array.isArray(branches)
        ? branches.map(stampBranch)
        : stampBranch(branches);
      touched = true;
    }

    if ("createMany" in relation && relation.createMany && typeof relation.createMany === "object") {
      const many = relation.createMany as Record<string, unknown>;
      relation.createMany = { ...many, data: stampRows(target, many.data, tenantId) };
      touched = true;
    }

    if ("upsert" in relation && relation.upsert) {
      const branches = relation.upsert;
      const stampBranch = (branch: unknown) => {
        if (!branch || typeof branch !== "object") return branch;
        const entry = branch as Record<string, unknown>;
        // The create half only — never the update, for the same reason the
        // top-level upsert below leaves `update` alone.
        return { ...entry, create: stampRows(target, entry.create, tenantId) };
      };
      relation.upsert = Array.isArray(branches) ? branches.map(stampBranch) : stampBranch(branches);
      touched = true;
    }

    if (touched) {
      out[key] = relation;
      changed = true;
    }
  }

  return changed ? out : source;
}

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

            /**
             * A global model is not filtered — but it can still CARRY a
             * tenant-owned row into the database. `User` is global and
             * `User.student` / `User.lecturer` are not, and creating one
             * through the other is how the school's own tutors ended up
             * belonging to nobody. So a write on a global model still gets the
             * nested walk.
             */
            const globalScope = resolveScope();
            if (globalScope?.kind === "tenant" && globalScope.tenantId) {
              const a = (args ?? {}) as Record<string, any>;
              if (CREATE_OPERATIONS.has(operation)) {
                return query({ ...a, data: stampNestedCreates(model, a.data, globalScope.tenantId) });
              }
              if (operation === "upsert") {
                return query({
                  ...a,
                  create: stampNestedCreates(model, a.create, globalScope.tenantId),
                });
              }
              if (operation === "update" || operation === "updateMany") {
                return query({ ...a, data: stampNestedCreates(model, a.data, globalScope.tenantId) });
              }
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

          /**
           * `kind: "tenant"` with no id is a holder somebody filled in badly.
           * Refused rather than coerced: the alternative is a query filtered on
           * `tenantId: undefined`, which Prisma reads as no filter at all —
           * every row of every school, from the layer whose entire job is to
           * make that impossible.
           */
          const { tenantId } = scope;
          if (!tenantId) {
            throw new TenantIsolationError(
              `${model}.${operation} ran with a tenant scope that has no tenant id.`,
            );
          }

          const a = (args ?? {}) as Record<string, any>;

          if (READ_OPERATIONS.has(operation)) {
            return query({ ...a, where: { ...(a.where ?? {}), tenantId } });
          }

          if (WRITE_WITH_WHERE.has(operation)) {
            // An update can nest a create too — `student.update({ data: {
            // payments: { create: … } } })` writes a Payment that needs owning.
            return query({
              ...a,
              where: { ...(a.where ?? {}), tenantId },
              ...(a.data === undefined ? {} : { data: stampNestedCreates(model, a.data, tenantId) }),
            });
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
              return query({
                ...a,
                data: a.data.map((row: any) => ({
                  ...(stampNestedCreates(model, row, tenantId) as object),
                  tenantId,
                })),
              });
            }
            return query({
              ...a,
              data: { ...(stampNestedCreates(model, a.data ?? {}, tenantId) as object), tenantId },
            });
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
              create: { ...(stampNestedCreates(model, a.create ?? {}, tenantId) as object), tenantId },
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
