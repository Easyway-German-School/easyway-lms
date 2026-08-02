import { PrismaClient } from "@prisma/client";

const globalForPrisma = global as unknown as { prisma: PrismaClient | undefined };

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });

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
