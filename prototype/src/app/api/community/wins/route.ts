import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveSpaceScope } from "@/lib/community-spaces";

export const dynamic = "force-dynamic";

/**
 * The wins strip — a thin band of good news at the top of a room.
 *
 * Read-only and ambient. It writes nothing, sends no notification, and staff
 * cannot post to it: it is DERIVED from things that already happened elsewhere
 * in the product, so it can never be another moderation surface. Three sources,
 * all scoped to the one cohort the viewer belongs to:
 *
 *   - a class story that got finished       (GameMatch, status completed)
 *   - a classmate earning a certificate     (Certificate, recent, not revoked)
 *   - a classmate finishing / advancing a level  (JourneyEvent)
 *
 * A student who opens their room and sees "Amara earned an A2 certificate" is
 * looking at the reason to stay, stated by the people next to them rather than
 * by the school.
 */

/** Nothing older than this is a "recent" win worth surfacing. */
const WINDOW_DAYS = 30;

type Win = {
  id: string;
  kind: "story" | "certificate" | "level";
  /** Whose win — a first name, or "Your class" for a shared one. */
  name: string;
  /** The one line under the name. */
  detail: string;
  at: string;
  link?: string;
};

export async function GET(request: Request) {
  const session = await requireAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const spaceId = url.searchParams.get("spaceId");
    if (!spaceId) {
      return NextResponse.json({ error: "spaceId is required" }, { status: 400 });
    }

    const viewer = { userId: session.user.id as string, role: (session.user as any).role };
    const scope = await resolveSpaceScope(viewer);
    if (!scope.spaceIds.includes(spaceId)) {
      return NextResponse.json({ error: "That is not one of your rooms" }, { status: 403 });
    }

    const space = await prisma.space.findUnique({
      where: { id: spaceId },
      select: { branchId: true, level: true, sessionSlot: true },
    });
    if (!space) return NextResponse.json({ wins: [] });

    const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000);

    // The cohort: everyone active in this branch + level + sitting. Same
    // membership rule the chat and the story roster use.
    const classmates = await prisma.student.findMany({
      where: {
        branchId: space.branchId,
        level: space.level,
        sessionSlot: space.sessionSlot,
        status: "active",
      },
      select: { id: true, user: { select: { name: true } } },
    });
    const studentIds = classmates.map((s) => s.id);
    const firstNameOf = (name: string | null) =>
      (name ?? "Someone").trim().split(/\s+/)[0] || "Someone";

    const [stories, certificates, journey] = await Promise.all([
      prisma.gameMatch.findMany({
        where: { spaceId, status: "completed", completedAt: { gte: since } },
        orderBy: { completedAt: "desc" },
        take: 6,
        select: { id: true, title: true, completedAt: true },
      }),
      studentIds.length
        ? prisma.certificate.findMany({
            where: { studentId: { in: studentIds }, issuedAt: { gte: since }, revokedAt: null },
            orderBy: { issuedAt: "desc" },
            take: 8,
            select: { id: true, level: true, kind: true, issuedAt: true, studentName: true },
          })
        : Promise.resolve([] as Array<{ id: string; level: string; kind: string; issuedAt: Date; studentName: string }>),
      studentIds.length
        ? prisma.journeyEvent.findMany({
            where: {
              studentId: { in: studentIds },
              type: { in: ["level-completed", "level-advanced"] },
              occurredAt: { gte: since },
            },
            orderBy: { occurredAt: "desc" },
            take: 8,
            select: {
              id: true,
              label: true,
              detail: true,
              occurredAt: true,
              student: { select: { user: { select: { name: true } } } },
            },
          })
        : Promise.resolve(
            [] as Array<{
              id: string;
              label: string;
              detail: string | null;
              occurredAt: Date;
              student: { user: { name: string | null } };
            }>,
          ),
    ]);

    const wins: Win[] = [
      ...stories.map((s) => ({
        id: `story:${s.id}`,
        kind: "story" as const,
        name: "Your class",
        detail: `finished a story — ${s.title}`,
        at: (s.completedAt ?? new Date()).toISOString(),
        link: `/games/${s.id}`,
      })),
      ...certificates.map((c) => ({
        id: `cert:${c.id}`,
        kind: "certificate" as const,
        name: firstNameOf(c.studentName),
        detail:
          c.kind === "achievement"
            ? `earned a ${c.level} achievement certificate`
            : `earned a ${c.level} certificate`,
        at: c.issuedAt.toISOString(),
      })),
      ...journey.map((e) => ({
        id: `journey:${e.id}`,
        kind: "level" as const,
        name: firstNameOf(e.student.user.name),
        // The label is already written for a student to read.
        detail: e.label,
        at: e.occurredAt.toISOString(),
      })),
    ]
      .sort((a, b) => (a.at < b.at ? 1 : -1))
      .slice(0, 12);

    return NextResponse.json({ wins });
  } catch (error) {
    console.error("Community wins error:", error);
    // A strip that fails is nothing — the room renders fine without it.
    return NextResponse.json({ wins: [] });
  }
}
