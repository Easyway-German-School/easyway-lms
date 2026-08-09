import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { guardedPrisma } from "@/lib/prisma";
import { enterUnscoped } from "@/lib/tenant/context";
import { requireAuthSession } from "@/lib/auth";

/**
 * The operator of the platform, as distinct from the person who runs a school
 * on it.
 *
 * These are two genuinely different jobs and conflating them is how a
 * multi-tenant product leaks. EasyWay's own super admin runs EasyWay: they hire
 * tutors, take fees, and must never be able to read another school's students
 * simply because EasyWay happens to own the software. The operator creates
 * tenants, issues API keys and reads the cross-tenant billing view, and has no
 * business inside anybody's register.
 *
 * So `adminRole = "super"` does not grant this and never should. It is a
 * separate column, granted by hand with scripts/grant-platform-operator.mjs,
 * and there is deliberately no screen that grants it — a privilege that can be
 * clicked into existence is one that eventually is.
 */

export const PLATFORM_ROLE = "operator";

export type PlatformContext = {
  session: Session;
  userId: string;
  email: string;
};

export type PlatformGate =
  | { ok: true; ctx: PlatformContext }
  | { ok: false; response: NextResponse };

export async function requirePlatformOperator(): Promise<PlatformGate> {
  const session = await requireAuthSession();
  if (!session?.user?.id) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  /**
   * User is a global model, so this read needs no tenant — but the routes
   * behind this gate go on to touch Tenant, ApiKey and the billing tables
   * across every tenant, which do. Declaring the bypass here, once, is what
   * lets each of those routes be written plainly.
   *
   * `enterWith` is safe at this point rather than at the top of a handler:
   * requireAuthSession has already awaited, so we are inside this function's
   * own async resource. See the note on enterUnscoped.
   */
  const user = await guardedPrisma.user.findUnique({
    where: { id: session.user.id },
    select: { platformRole: true, email: true },
  });

  if (user?.platformRole !== PLATFORM_ROLE) {
    /**
     * 404, not 403. The platform console is not a feature of the school's
     * product, and a school admin poking at /api/platform should be told the
     * same thing a stranger is told: there is nothing here.
     */
    return {
      ok: false,
      response: NextResponse.json({ error: "Not found" }, { status: 404 }),
    };
  }

  enterUnscoped(`platform operator ${user.email} administering tenants across the platform`);

  return {
    ok: true,
    ctx: { session, userId: session.user.id, email: user.email },
  };
}

/** Whether this session may see the platform console. For the shell/nav. */
export async function isPlatformOperator(userId: string | undefined): Promise<boolean> {
  if (!userId) return false;
  const user = await guardedPrisma.user.findUnique({
    where: { id: userId },
    select: { platformRole: true },
  });
  return user?.platformRole === PLATFORM_ROLE;
}
