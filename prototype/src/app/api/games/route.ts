import { NextResponse, type NextRequest } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveSpaceScope, isStaffRole } from "@/lib/community-spaces";
import { createMatch, turnsAwaiting } from "@/lib/satzkette-server";
import { parseConstraint, type Constraint } from "@/lib/satzkette";

export const dynamic = "force-dynamic";

/**
 * The Games tab: what is being written, and what is waiting on you.
 *
 * Turns you owe come first in the payload and first on the screen, because the
 * whole feature runs on that one line. A student who opens this and has to hunt
 * for their own turn will not open it twice.
 */
export async function GET() {
  const session = await requireAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Sign in to play" }, { status: 401 });
  }

  const userId = session.user.id as string;
  const role = (session.user as { role?: string }).role ?? "STUDENT";

  const scope = await resolveSpaceScope({ userId, role });
  if (scope.spaceIds.length === 0) {
    return NextResponse.json({ waiting: [], matches: [], canStart: isStaffRole(role) });
  }

  const [waiting, matches] = await Promise.all([
    turnsAwaiting(userId),
    prisma.gameMatch.findMany({
      where: { spaceId: { in: scope.spaceIds }, status: { in: ["active", "completed"] } },
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
      take: 20,
      select: {
        id: true,
        title: true,
        prompt: true,
        status: true,
        targetTurns: true,
        completedAt: true,
        updatedAt: true,
        _count: { select: { turns: true } },
      },
    }),
  ]);

  return NextResponse.json({
    waiting,
    matches: matches.map((match) => ({
      id: match.id,
      title: match.title,
      prompt: match.prompt,
      status: match.status,
      targetTurns: match.targetTurns,
      // Turns created, not turns written — the open one counts toward the
      // progress bar because the story really is that far along.
      turnCount: match._count.turns,
      completedAt: match.completedAt,
      updatedAt: match.updatedAt,
    })),
    canStart: isStaffRole(role),
  });
}

/**
 * Start a story. Staff only.
 *
 * A student cannot open one, and that is deliberate rather than an oversight: a
 * cohort where anybody can start a chain ends up with nine half-finished ones
 * and no turns owed on any of them, which breaks the only mechanic that makes
 * the feature work.
 */
export async function POST(request: NextRequest) {
  const session = await requireAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  }

  const role = (session.user as { role?: string }).role ?? "STUDENT";
  if (!isStaffRole(role)) {
    return NextResponse.json({ error: "Only a tutor can start a story" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const spaceId = String(body?.spaceId ?? "");
  const title = String(body?.title ?? "").trim();

  if (!spaceId) return NextResponse.json({ error: "Pick a class" }, { status: 400 });
  if (!title) return NextResponse.json({ error: "Give the story a title" }, { status: 400 });

  // A tutor teaches several cohorts; this checks they teach THIS one, so a
  // hand-edited spaceId cannot start a story in somebody else's class.
  const scope = await resolveSpaceScope({ userId: session.user.id as string, role });
  if (!scope.spaceIds.includes(spaceId)) {
    return NextResponse.json({ error: "That is not one of your classes" }, { status: 403 });
  }

  const constraints: Constraint[] = Array.isArray(body?.constraints)
    ? body.constraints
        .map((entry: unknown) => parseConstraint(entry))
        .filter((entry: Constraint | null): entry is Constraint => entry !== null)
    : [];

  const match = await createMatch({
    spaceId,
    title,
    prompt: typeof body?.prompt === "string" ? body.prompt.trim() || null : null,
    constraints,
    targetTurns: Number(body?.targetTurns) || undefined,
    createdById: session.user.id as string,
  });

  if (!match) {
    return NextResponse.json(
      { error: "That class has no active students to play it yet." },
      { status: 400 },
    );
  }

  return NextResponse.json({ match });
}
