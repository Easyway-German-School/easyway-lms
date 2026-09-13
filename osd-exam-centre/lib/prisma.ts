import { PrismaClient } from "@prisma/client";

/**
 * Standard Next.js dev-mode singleton — without it, every hot-reload opens a
 * fresh pool of connections against Neon until it refuses new ones.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
