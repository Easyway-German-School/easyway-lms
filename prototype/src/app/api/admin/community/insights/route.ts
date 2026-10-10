import { NextResponse } from "next/server";

import { requireCapability } from "@/lib/admin-roles";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { lookOfRow, readLookWave } from "@/lib/youth-look-server";
import type { Look } from "@/lib/youth-look";

export const dynamic = "force-dynamic";

/**
 * HOW EACH LOOK IS BEING USED — the community and the portal around it, side by
 * side, for the school to compare the new look with the classic one.
 *
 * Everything here is a count or a total. No names, no birth dates, no message
 * text: behaviour events carry labels the code chose, and messages are only
 * counted per author, never read.
 *
 * Two sources:
 *   - LearnerUsageEvent, which the portal tracker writes for every student who
 *     has not opted out, now tagged with the look the student was on.
 *   - Message, counted against the look each author is on today.
 */

type LookKey = Look | "untagged";
const LOOKS: Look[] = ["youth", "classic"];

type Bucket = {
  activeStudents: number;
  visits: number;
  minutes: number;
  communityStudents: number;
  communityMinutes: number;
  mobileShare: number | null;
  messages: number;
  posters: number;
};

const empty = (): Bucket => ({
  activeStudents: 0,
  visits: 0,
  minutes: 0,
  communityStudents: 0,
  communityMinutes: 0,
  mobileShare: null,
  messages: 0,
  posters: 0,
});

export async function GET(request: Request) {
  const gate = await requireCapability("community");
  if (!gate.ok) return gate.response;

  try {
    const days = Math.min(90, Math.max(1, Number(new URL(request.url).searchParams.get("days")) || 30));
    const since = new Date(Date.now() - days * 86_400_000);
    const tenantId = gate.session.user.tenantId ?? null;
    const scope = tenantId ? { tenantId } : {};

    const [wave, students] = await Promise.all([
      readLookWave(tenantId),
      prisma.student.findMany({
        where: { status: "active" },
        select: { userId: true, uiLook: true, admission: true, profile: { select: { dateOfBirth: true } } },
      }),
    ]);

    // Which look each student is on today — decides whose messages count for which look.
    const now = new Date();
    const lookByUser = new Map<string, Look>();
    const roster = { youth: 0, classic: 0 };
    for (const s of students) {
      const look = lookOfRow(s, wave, now);
      lookByUser.set(s.userId, look);
      roster[look] += 1;
    }
    const buckets: Record<LookKey, Bucket> = { youth: empty(), classic: empty(), untagged: empty() };
    const keyOf = (look: string | null): LookKey => (look === "youth" || look === "classic" ? look : "untagged");

    const where = { ...scope, occurredAt: { gte: since }, area: { not: "look" } } as const;

    const [perUser, perSession, perUserCommunity, perDevice] = await Promise.all([
      prisma.learnerUsageEvent.groupBy({
        by: ["look", "userId"],
        where,
        _sum: { durationSeconds: true },
      }),
      prisma.learnerUsageEvent.groupBy({ by: ["look", "sessionKey"], where: { ...where, sessionKey: { not: null } } }),
      prisma.learnerUsageEvent.groupBy({
        by: ["look", "userId"],
        where: { ...where, area: "community" },
        _sum: { durationSeconds: true },
      }),
      prisma.learnerUsageEvent.groupBy({ by: ["look", "deviceKind"], where, _count: { _all: true } }),
    ]);

    for (const row of perUser) {
      const b = buckets[keyOf(row.look)];
      b.activeStudents += 1;
      b.minutes += (row._sum.durationSeconds ?? 0) / 60;
    }
    for (const row of perSession) buckets[keyOf(row.look)].visits += 1;
    for (const row of perUserCommunity) {
      const b = buckets[keyOf(row.look)];
      b.communityStudents += 1;
      b.communityMinutes += (row._sum.durationSeconds ?? 0) / 60;
    }
    const device: Record<LookKey, { all: number; mobile: number }> = {
      youth: { all: 0, mobile: 0 },
      classic: { all: 0, mobile: 0 },
      untagged: { all: 0, mobile: 0 },
    };
    for (const row of perDevice) {
      const d = device[keyOf(row.look)];
      d.all += row._count._all;
      if (row.deviceKind === "mobile") d.mobile += row._count._all;
    }
    for (const k of Object.keys(buckets) as LookKey[]) {
      buckets[k].mobileShare = device[k].all ? device[k].mobile / device[k].all : null;
      buckets[k].minutes = Math.round(buckets[k].minutes);
      buckets[k].communityMinutes = Math.round(buckets[k].communityMinutes);
    }

    // Messages, counted per author and then folded onto the look that author is on today.
    const written = await prisma.message.groupBy({
      by: ["authorId"],
      where: { createdAt: { gte: since }, hiddenAt: null },
      _count: { _all: true },
    });
    for (const row of written) {
      const look = lookByUser.get(row.authorId);
      if (!look) continue; // staff or a former student
      buckets[look].messages += row._count._all;
      buckets[look].posters += 1;
    }

    // What people actually pressed in the community, per look.
    const clicks = await prisma.learnerUsageEvent.groupBy({
      by: ["look", "detail"],
      where: { ...scope, occurredAt: { gte: since }, detail: { startsWith: "community." } },
      _count: { _all: true },
    });
    const actions: Record<string, { youth: number; classic: number }> = {};
    for (const row of clicks) {
      if (!row.detail) continue;
      const look = keyOf(row.look);
      if (look === "untagged") continue;
      (actions[row.detail] ??= { youth: 0, classic: 0 })[look] += row._count._all;
    }

    // Becca's invitation: shown, taken, declined, and switches either way.
    const decisions = await prisma.learnerUsageEvent.groupBy({
      by: ["detail"],
      where: { ...scope, occurredAt: { gte: since }, area: "look" },
      _count: { _all: true },
    });
    const d = (prefix: string) =>
      decisions.filter((row) => row.detail?.startsWith(prefix)).reduce((sum, row) => sum + row._count._all, 0);
    const invitation = {
      shown: d("prompt-shown:invite"),
      tookIt: d("switch-to-youth:via-invite"),
      declined: d("prompt-declined:invite"),
      announcedShown: d("prompt-shown:announce"),
      wentBack: d("switch-to-classic"),
      switchedToNew: d("switch-to-youth"),
    };

    // Daily active students per look, for the trend line.
    const daily = await prisma.$queryRaw<Array<{ day: Date; look: string | null; students: bigint }>>`
      SELECT date_trunc('day', "occurredAt") AS day, "look", COUNT(DISTINCT "userId") AS students
      FROM "LearnerUsageEvent"
      WHERE "occurredAt" >= ${new Date(Date.now() - Math.min(days, 14) * 86_400_000)}
        AND "area" <> 'look'
        ${tenantId ? Prisma.sql`AND "tenantId" = ${tenantId}` : Prisma.empty}
      GROUP BY 1, 2
      ORDER BY 1`;

    return NextResponse.json({
      windowDays: days,
      roster,
      looks: { youth: buckets.youth, classic: buckets.classic, untagged: buckets.untagged },
      actions,
      invitation,
      daily: daily.map((r) => ({
        day: r.day.toISOString().slice(0, 10),
        look: r.look === "youth" || r.look === "classic" ? r.look : "untagged",
        students: Number(r.students),
      })),
      lookKeys: LOOKS,
    });
  } catch (error) {
    console.error("Failed to load community insights:", error);
    return NextResponse.json({ error: "Could not load the community insights" }, { status: 500 });
  }
}
