/**
 * The database half of online-branch.ts — kept separate for the same reason:
 * that file has no prisma import so client code (the signup form) can use
 * it, and this lookup needs one.
 */

import { prisma } from "@/lib/prisma";

export async function resolveOnlineBranchId(tenantId: string | null | undefined): Promise<string | null> {
  const branch = await prisma.branch.findFirst({
    where: { mode: "online", ...(tenantId ? { tenantId } : {}) },
    select: { id: true },
  });
  return branch?.id ?? null;
}
