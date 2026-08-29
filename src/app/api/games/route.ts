import { NextResponse, type NextRequest } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveSpaceScope } from "@/lib/community-spaces";
import { createMatch, turnsAwaiting } from "@/lib/satzkette-server";
import { parseConstraint, type Constraint } from "@/lib/satzkette";
import { derivePaymentStatus, requiredDepositFor, tuitionFeeFor } from "@/lib/payment";

export const dynamic = "force-dynamic";

async function canUseStudentGames(userId: string) {
  const student = await prisma.student.findUnique({
    where: { userId },
    select: {
      classType: true,
      level: true,
      branch: { select: { name: true } },
      payments: { where: { status: "completed" }, select: { amount: true } },
    },
  });
  if (!student) return false;
  if (student.classType === "private") return false;
  const lookup = { level: student.level, branch: student.branch?.name, classType: student.classType };
  const payment = derivePaymentStatus({
    totalPaid: student.payments.reduce((sum, payment) => sum + payment.amount, 0),
    tuitionFee: tuitionFeeFor(lookup),
    requiredDeposit: requiredDepositFor(lookup),
  });
  return payment.depositPaid;
}

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

  if (String(role).toUpperCase() === "STUDENT" && !(await canUseStudentGames(userId))) {
    return NextResponse.json({ waiting: [], matches: [], canStart: false, spaceIds: [], locked: true });
  }

  const scope = await resolveSpaceScope({ userId, role });
  if (scope.spaceIds.length === 0) {
    return NextResponse.json({ waiting: [], matches: [], canStart: false, spaceIds: [] });
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
    // Every visible room is one this viewer belongs to (resolveSpaceScope
    // already enforced that), so if there's a room there's somewhere to start
    // a story. The per-room cap is checked for real at POST time.
    canStart: scope.spaceIds.length > 0,
    // A student has exactly one; staff may have several, and pick when starting.
    spaceIds: scope.spaceIds,
  });
}

/** Nobody's chain monopolises a room. See the cap check below. */
const MAX_ACTIVE_STORIES_PER_ROOM = 2;

/**
 * Start a story. Any paid student in the room, or staff.
 *
 * Used to be staff-only, on the theory that a cohort where anybody can start a
 * chain ends up with nine half-finished ones and no turns owed on any of them.
 * That risk is real but the fix is a cap, not a lock: `MAX_ACTIVE_STORIES_PER_ROOM`
 * below keeps a room from filling up with half-finished chains while still
 * letting a student who wants to write kick one off without waiting on a tutor.
 */
export async function POST(request: NextRequest) {
  const session = await requireAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  }

  const role = (session.user as { role?: string }).role ?? "STUDENT";

  if (String(role).toUpperCase() === "STUDENT" && !(await canUseStudentGames(session.user.id as string))) {
    return NextResponse.json({ error: "Pay your tuition deposit to unlock class games.", locked: true }, { status: 402 });
  }

  const body = await request.json().catch(() => ({}));
  const spaceId = String(body?.spaceId ?? "");
  const title = String(body?.title ?? "").trim();

  if (!spaceId) return NextResponse.json({ error: "Pick a class" }, { status: 400 });
  if (!title) return NextResponse.json({ error: "Give the story a title" }, { status: 400 });

  // Anyone in the room may start one — a tutor teaching several cohorts, or a
  // paid student in their own single cohort. Either way, this checks the
  // viewer actually belongs to THIS room, so a hand-edited spaceId cannot
  // start a story in somebody else's class.
  const scope = await resolveSpaceScope({ userId: session.user.id as string, role });
  if (!scope.spaceIds.includes(spaceId)) {
    return NextResponse.json({ error: "That is not one of your classes" }, { status: 403 });
  }

  const activeCount = await prisma.gameMatch.count({ where: { spaceId, status: "active" } });
  if (activeCount >= MAX_ACTIVE_STORIES_PER_ROOM) {
    return NextResponse.json(
      { error: `This room already has ${MAX_ACTIVE_STORIES_PER_ROOM} stories going — finish one first.` },
      { status: 400 },
    );
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
