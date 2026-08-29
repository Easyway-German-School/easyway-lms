import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { beginRequestScope, setTenantScope } from "@/lib/tenant/context";

/**
 * The door in front of every AI endpoint.
 *
 * WHY THIS EXISTS. Five of the seven routes under /api/ai answered an
 * anonymous POST: course-outline, daily-missions, lesson-package,
 * mission-practice and upload-content — the last of which also accepted file
 * uploads from nobody in particular. With a real ANTHROPIC_API_KEY in the
 * environment, each of those calls spends the school's money, and the URLs are
 * guessable from the client bundle. That is not a hypothetical: it is an open
 * meter on a public road.
 *
 * Two levels, because the endpoints are not all the same thing:
 *
 *   requireAiUser()  — any signed-in account. Fine for the student features:
 *                      missions, practice, pronunciation, essays.
 *   requireAiStaff() — lecturers and admins only. The authoring tools
 *                      (lesson package, course outline, content upload) build
 *                      teaching material, cost the most per call because they
 *                      process whole documents, and have no business being
 *                      reachable by a student account at all.
 *
 * Deliberately NOT capability-gated beyond that. An admin sub-role does not
 * need a separate "may use AI" permission — the question these guard is who is
 * spending the budget, not which area of the office someone works in.
 */

export type AiGate =
  | { ok: true; userId: string; role: string }
  | { ok: false; response: NextResponse };

async function resolve(): Promise<{ userId: string; role: string } | null> {
  // Every other auth entry point goes through `requireAuthSession()`, which
  // opens the tenant scope for the whole request before touching the
  // database (see `beginRequestScope`/`setTenantScope` in lib/auth.ts). This
  // gate calls `getServerSession` directly instead and never did that —
  // harmless as long as nothing downstream queries a tenant-owned model
  // (Lecturer, Student, PrivateClass, ...) without its own scoping, but the
  // moment a route built on this gate does, it is running unscoped. Mirrored
  // here so every AI-gated route gets the same tenant safety as everywhere
  // else, not just the ones that happened to avoid a tenant-owned query.
  beginRequestScope();

  const session = (await getServerSession(authOptions as never)) as
    | { user?: { id?: string } }
    | null;
  if (!session?.user?.id) return null;

  // Read the role from the database rather than the session token: a token
  // issued before somebody was demoted still carries the old role, and these
  // routes are the ones with a cost attached.
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, role: true, tenantId: true },
  });
  if (!user) return null;

  setTenantScope(user.tenantId ?? null);

  return { userId: user.id, role: String(user.role ?? "").toUpperCase() };
}

/** Any signed-in account. */
export async function requireAiUser(): Promise<AiGate> {
  const who = await resolve();
  if (!who) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Sign in to use this" }, { status: 401 }),
    };
  }
  return { ok: true, ...who };
}

/** Lecturers and admins only — the authoring tools. */
export async function requireAiStaff(): Promise<AiGate> {
  const who = await resolve();
  if (!who) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Sign in to use this" }, { status: 401 }),
    };
  }
  if (who.role !== "LECTURER" && who.role !== "ADMIN") {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "This tool is for tutors and staff" },
        { status: 403 },
      ),
    };
  }
  return { ok: true, ...who };
}
