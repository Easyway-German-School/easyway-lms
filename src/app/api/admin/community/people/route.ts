import { NextResponse } from "next/server";

import { requireCapability } from "@/lib/admin-roles";
import { slotLabel } from "@/lib/community-spaces";
import { ARCHETYPES, type ArchetypeKey } from "@/lib/learner-signals";
import { prisma } from "@/lib/prisma";
import { lookDecisionOfRow, readLookWave } from "@/lib/youth-look-server";

export const dynamic = "force-dynamic";

/**
 * THE PEOPLE IN EACH LOOK — names, what they do, how they use the community.
 *
 * Insights (the sibling route) is totals. This is the roster: every active
 * student, which look they are on and why, how recently they were in the
 * portal, how much they post, and the behaviour label the school already
 * computes (night owl, fading, community-first). The office asked for it
 * because a count cannot tell you who to ring.
 *
 * Behind `community`, the same gate as the rooms themselves: staff who can
 * already read every message can also see who is in which look. Message text
 * is never returned — only how many they posted, and when the last one was.
 */

export async function GET(request: Request) {
  const gate = await requireCapability("community");
  if (!gate.ok) return gate.response;

  try {
    const days = Math.min(90, Math.max(1, Number(new URL(request.url).searchParams.get("days")) || 30));
    const since = new Date(Date.now() - days * 86_400_000);
    const tenantId = gate.session.user.tenantId ?? null;
    const now = new Date();

    const [wave, students] = await Promise.all([
      readLookWave(tenantId),
      prisma.student.findMany({
        where: { status: "active" },
        select: {
          id: true,
          userId: true,
          level: true,
          sessionSlot: true,
          uiLook: true,
          lookPromptedAt: true,
          admission: true,
          profile: { select: { dateOfBirth: true } },
          branch: { select: { name: true } },
          user: { select: { id: true, name: true, email: true, analyticsOptOutAt: true } },
        },
      }),
    ]);

    const userIds = students.map((s) => s.userId);
    const usageWhere = {
      userId: { in: userIds },
      occurredAt: { gte: since },
      area: { not: "look" },
    };

    const [posted, usage, community, devices, profiles] = await Promise.all([
      userIds.length
        ? prisma.message.groupBy({
            by: ["authorId"],
            where: { authorId: { in: userIds }, createdAt: { gte: since }, hiddenAt: null },
            _count: { _all: true },
            _max: { createdAt: true },
          })
        : Promise.resolve([]),
      userIds.length
        ? prisma.learnerUsageEvent.groupBy({
            by: ["userId"],
            where: usageWhere,
            _sum: { durationSeconds: true },
            _max: { occurredAt: true },
          })
        : Promise.resolve([]),
      userIds.length
        ? prisma.learnerUsageEvent.groupBy({
            by: ["userId"],
            where: { ...usageWhere, area: "community" },
            _sum: { durationSeconds: true },
          })
        : Promise.resolve([]),
      userIds.length
        ? prisma.learnerUsageEvent.groupBy({
            by: ["userId", "deviceKind"],
            where: usageWhere,
            _count: { _all: true },
          })
        : Promise.resolve([]),
      userIds.length
        ? prisma.learnerBehaviourProfile.findMany({
            where: { userId: { in: userIds } },
            select: {
              userId: true,
              archetype: true,
              engagementScore: true,
              riskScore: true,
              daysSinceSeen: true,
              peakHour: true,
              sessionsPerWeek: true,
              avgSessionMinutes: true,
            },
          })
        : Promise.resolve([]),
    ]);

    const postedBy = new Map(posted.map((r) => [r.authorId, { count: r._count._all, lastAt: r._max.createdAt }]));
    const usageBy = new Map(usage.map((r) => [r.userId, { seconds: r._sum.durationSeconds ?? 0, lastAt: r._max.occurredAt }]));
    const communityBy = new Map(community.map((r) => [r.userId, r._sum.durationSeconds ?? 0]));
    const profileBy = new Map(profiles.map((r) => [r.userId, r]));

    const deviceBy = new Map<string, { mobile: number; other: number }>();
    for (const row of devices) {
      const entry = deviceBy.get(row.userId) ?? { mobile: 0, other: 0 };
      if (row.deviceKind === "mobile") entry.mobile += row._count._all;
      else entry.other += row._count._all;
      deviceBy.set(row.userId, entry);
    }

    const people = students.map((s) => {
      const decision = lookDecisionOfRow(s, wave, now);
      const used = usageBy.get(s.userId);
      const postedRow = postedBy.get(s.userId);
      const device = deviceBy.get(s.userId);
      const profile = profileBy.get(s.userId);
      const archetype = profile && profile.archetype in ARCHETYPES ? (profile.archetype as ArchetypeKey) : null;
      const optedOut = Boolean(s.user.analyticsOptOutAt);

      return {
        studentId: s.id,
        userId: s.userId,
        name: s.user.name ?? s.user.email ?? "Unnamed",
        email: s.user.email,
        age: decision.age,
        level: s.level,
        branch: s.branch?.name ?? null,
        sitting: s.sessionSlot ? slotLabel(s.sessionSlot) : null,
        look: decision.look,
        reason: decision.reason,
        cohort: decision.cohort,
        prompted: s.lookPromptedAt !== null,
        lastSeenAt: used?.lastAt?.toISOString() ?? null,
        minutes: Math.round((used?.seconds ?? 0) / 60),
        communityMinutes: Math.round((communityBy.get(s.userId) ?? 0) / 60),
        messages: postedRow?.count ?? 0,
        lastPostedAt: postedRow?.lastAt?.toISOString() ?? null,
        device: deviceKindOf(device),
        optedOut,
        pattern:
          optedOut || !profile || !archetype
            ? null
            : {
                key: archetype,
                label: ARCHETYPES[archetype].label,
                tone: ARCHETYPES[archetype].tone,
                engagement: profile.engagementScore,
                risk: profile.riskScore,
                peakHour: profile.peakHour,
                daysSinceSeen: profile.daysSinceSeen,
                sessionsPerWeek: profile.sessionsPerWeek,
                avgSessionMinutes: profile.avgSessionMinutes,
              },
      };
    });

    people.sort((a, b) => {
      const aSeen = a.lastSeenAt ? Date.parse(a.lastSeenAt) : 0;
      const bSeen = b.lastSeenAt ? Date.parse(b.lastSeenAt) : 0;
      if (aSeen !== bSeen) return bSeen - aSeen;
      return a.name.localeCompare(b.name);
    });

    return NextResponse.json({
      windowDays: days,
      counts: {
        total: people.length,
        youth: people.filter((p) => p.look === "youth").length,
        classic: people.filter((p) => p.look === "classic").length,
        active: people.filter((p) => p.lastSeenAt).length,
        posters: people.filter((p) => p.messages > 0).length,
      },
      people,
    });
  } catch (error) {
    console.error("Failed to load community people:", error);
    return NextResponse.json({ error: "Could not load the people in each look" }, { status: 500 });
  }
}

function deviceKindOf(entry: { mobile: number; other: number } | undefined): "mobile" | "desktop" | "mixed" | "unknown" {
  if (!entry || entry.mobile + entry.other === 0) return "unknown";
  if (entry.mobile > 0 && entry.other === 0) return "mobile";
  if (entry.other > 0 && entry.mobile === 0) return "desktop";
  return "mixed";
}
