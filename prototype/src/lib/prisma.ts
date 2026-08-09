import { PrismaClient } from "@prisma/client";
import { createGuardExtension } from "@/lib/prisma-guard";
import { createTenantExtension } from "@/lib/tenant/extension";
import { currentScope } from "@/lib/tenant/context";

const globalForPrisma = global as unknown as {
  prismaBase: PrismaClient | undefined;
  prismaGuarded: ReturnType<typeof buildGuarded> | undefined;
  prisma: ReturnType<typeof buildClient> | undefined;
};

function buildGuarded() {
  const base =
    globalForPrisma.prismaBase ||
    new PrismaClient({
      log:
        process.env.NODE_ENV === "development"
          ? ["query", "error", "warn"]
          : ["error"],
    });
  globalForPrisma.prismaBase = base;

  /**
   * Every query in the application goes through the guard.
   *
   * Wiring it here rather than at the call sites is the whole point. A rule
   * that has to be remembered is a rule that will be missed by the next route
   * somebody adds in a hurry, and the routes most likely to be written in a
   * hurry are the ones that delete things. See src/lib/prisma-guard.ts.
   */
  return base.$extends(createGuardExtension(base));
}

function buildClient() {
  /**
   * And every query goes through the tenant filter, for the same reason one
   * layer up: the routes that leak across tenants are not the ones anybody
   * reviews, they are the ones written quickly and forgotten. The scope comes
   * from async context, which the auth seam sets — see src/lib/tenant/context.ts.
   */
  return guardedPrisma.$extends(createTenantExtension(currentScope));
}

/**
 * Guarded but NOT tenant-scoped.
 *
 * The building block the scoped clients are made from, and the client the
 * deliberate cross-tenant jobs use. Reach for `prisma` unless you can say in a
 * sentence why this request is allowed to see every school at once.
 */
export const guardedPrisma = globalForPrisma.prismaGuarded || buildGuarded();
globalForPrisma.prismaGuarded = guardedPrisma;

export const prisma = globalForPrisma.prisma || buildClient();

/**
 * Cached in production too, not just development.
 *
 * In development the reason was hot reload creating a client per rebuild. On
 * Vercel the reason is bigger: a warm serverless container serves many requests,
 * and a client per request means a Postgres connection per request. Postgres
 * counts connections, not queries — a busy morning across a few branches would
 * exhaust the limit and start refusing everybody, which reads as the whole
 * school going down rather than as a pooling mistake.
 *
 * This is why DATABASE_URL must be the *pooled* connection string. See the
 * datasource note in prisma/schema.prisma.
 */
globalForPrisma.prisma = prisma;

/**
 * The client with no guard on it. Almost nothing should import this.
 *
 * It exists for the two jobs that have to operate on the trail itself rather
 * than through it — the restore path, which reads soft-deleted rows on
 * purpose, and the retention prune. Reaching for it anywhere else is how the
 * protections above get quietly bypassed, so it is deliberately ugly to type
 * and every use of it should be obvious in review.
 */
export const unguardedPrisma: PrismaClient = globalForPrisma.prismaBase!;
