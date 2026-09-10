import { NextResponse } from "next/server";

import { requireCapability, scopedBranchIds } from "@/lib/admin-roles";
import { prisma, unguardedPrisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/prisma-guard";
import { notifyInBackground, KIND } from "@/lib/notify";
import { readAssignment } from "@/lib/lecturer-assignment";
import {
  CLASS_SESSIONS_KEY,
  diffDisabled,
  levelsWithNoMode,
  levelsWithNoSlot,
  nearestEnabledMode,
  nearestEnabledSlot,
  parseSessionSettings,
  type ModeSlot,
  type SessionConfig,
  type SessionSettings,
  type SessionSlot,
} from "@/lib/school-settings";

/**
 * The school's own configuration, read and written by /admin/settings.
 *
 * Persisted in SchoolSetting rather than held in module state. That is not a
 * refinement — a Map on the module lives inside one serverless instance, so on
 * Vercel a save would appear to work, then vanish the moment the next request
 * landed on a different lambda. A settings screen that silently forgets is
 * worse than no settings screen, because the office stops trusting every other
 * number on the site too.
 *
 * The POST here does more than store a JSON blob. Turning a sitting or a mode
 * OFF is a real event: the students already in it have nowhere to be. So the
 * write is a two-step handshake —
 *   POST { preview: true, ...settings }  → what would move, nothing written
 *   POST { confirm: true, ...settings }  → write the setting AND move them
 * — and a plain POST with people in the firing line returns 409 needsConfirm
 * rather than moving anyone by surprise.
 */

export const dynamic = "force-dynamic";

const MAX_GROUP = 800;

export async function GET() {
  const gate = await requireCapability("staff");
  if (!gate.ok) return gate.response;

  try {
    const row = await prisma.schoolSetting.findFirst({
      where: { key: CLASS_SESSIONS_KEY },
    });

    return NextResponse.json(parseSessionSettings(row?.value));
  } catch (error) {
    console.error("Failed to load school settings:", error);
    return NextResponse.json({ error: "Unable to load settings" }, { status: 500 });
  }
}

/** The tenant fence GET/DELETE on /api/admin/students use — no-branch students included. */
function tenantWhere(tenantId: string | null | undefined) {
  if (!tenantId) return {};
  return { OR: [{ tenantId }, { branch: { tenantId } }, { user: { tenantId } }] };
}

type MoveGroup = {
  level: string;
  kind: "slot" | "mode";
  from: string;
  to: string;
  count: number;
  studentIds: string[];
  userIds: string[];
};

type StrandedGroup = {
  level: string;
  reason: "mode";
  from: string;
  count: number;
  studentIds: string[];
};

type Impact = {
  moves: MoveGroup[];
  stranded: StrandedGroup[];
  tutorWarnings: Array<{ name: string; detail: string }>;
};

function rowOf(settings: SessionSettings, level: string): SessionConfig | undefined {
  return settings.sessions.find((r) => r.level === level);
}

/**
 * What a save would do to the students already enrolled. Reads only — the
 * caller decides whether to act on it.
 */
async function computeImpact(
  prev: SessionSettings,
  next: SessionSettings,
  tenantId: string | null,
  allowedBranchIds: string[] | null,
): Promise<Impact> {
  const changes = diffDisabled(prev, next);
  const moves: MoveGroup[] = [];
  const stranded: StrandedGroup[] = [];

  const baseWhere: Record<string, unknown> = {
    status: "active",
    ...tenantWhere(tenantId),
  };
  if (allowedBranchIds) baseWhere.branchId = { in: allowedBranchIds };

  for (const change of changes) {
    const nextRow = rowOf(next, change.level);
    if (!nextRow) continue;

    if (change.kind === "slot") {
      const from = change.key as SessionSlot;
      const to = nearestEnabledSlot(nextRow, from);
      const students = await prisma.student.findMany({
        where: { ...baseWhere, level: change.level, sessionSlot: from },
        select: { id: true, userId: true },
        take: MAX_GROUP,
      });
      if (students.length === 0) continue;
      // `to` is only null when the level has no sitting left at all, which the
      // validation below refuses before we ever get here.
      moves.push({
        level: change.level,
        kind: "slot",
        from,
        to: to ?? from,
        count: students.length,
        studentIds: students.map((s) => s.id),
        userIds: students.map((s) => s.userId),
      });
      continue;
    }

    // mode change
    const from = change.key as ModeSlot;
    const students = await prisma.student.findMany({
      where: { ...baseWhere, level: change.level, deliveryMode: from },
      select: { id: true, userId: true },
      take: MAX_GROUP,
    });
    if (students.length === 0) continue;

    const to = from === "online" ? null : nearestEnabledMode(nextRow, from);
    if (to) {
      moves.push({
        level: change.level,
        kind: "mode",
        from,
        to,
        count: students.length,
        studentIds: students.map((s) => s.id),
        userIds: students.map((s) => s.userId),
      });
    } else {
      // online-only switched off, or physical AND hybrid both gone: these
      // students cannot be auto-placed. The office gets a worklist, not a
      // surprise move onto a campus they may live hundreds of km from.
      stranded.push({
        level: change.level,
        reason: "mode",
        from,
        count: students.length,
        studentIds: students.map((s) => s.id),
      });
    }
  }

  return { moves, stranded, tutorWarnings: await tutorWarningsFor(changes, next, tenantId) };
}

/**
 * Best-effort heads-up: tutors whose assignment points only at sittings being
 * switched off. Informational — it never blocks the save.
 */
async function tutorWarningsFor(
  changes: ReturnType<typeof diffDisabled>,
  next: SessionSettings,
  tenantId: string | null,
): Promise<Array<{ name: string; detail: string }>> {
  const disabledSlotsByLevel = new Map<string, Set<string>>();
  for (const c of changes) {
    if (c.kind !== "slot") continue;
    const set = disabledSlotsByLevel.get(c.level) ?? new Set<string>();
    set.add(c.key);
    disabledSlotsByLevel.set(c.level, set);
  }
  if (disabledSlotsByLevel.size === 0) return [];

  try {
    const lecturers = await unguardedPrisma.lecturer.findMany({
      where: tenantId ? { tenantId } : {},
      select: {
        branchId: true, level: true, sessionSlot: true,
        branchIds: true, levels: true, sessionSlots: true, assignmentGroups: true,
        user: { select: { name: true } },
      },
    });

    const out: Array<{ name: string; detail: string }> = [];
    for (const lecturer of lecturers) {
      const a = readAssignment(lecturer);
      if (a.sessionSlots.length === 0) continue; // teaches every sitting — safe

      for (const [level, disabled] of disabledSlotsByLevel) {
        const teachesLevel = a.levels.length === 0 || a.levels.includes(level);
        if (!teachesLevel) continue;
        const stillHas = a.sessionSlots.some((slot) => {
          const stillOn = rowOf(next, level);
          return stillOn ? Boolean(stillOn[slot as SessionSlot]) : true;
        });
        if (!stillHas && a.sessionSlots.every((slot) => disabled.has(slot))) {
          out.push({
            name: lecturer.user?.name ?? "A tutor",
            detail: `assigned to ${level} · ${[...disabled].join(", ")}`,
          });
        }
      }
    }
    return out;
  } catch {
    return [];
  }
}

export async function POST(request: Request) {
  const gate = await requireCapability("staff");
  if (!gate.ok) return gate.response;

  const tenantId = gate.session.user.tenantId ?? null;
  if (!tenantId) {
    return NextResponse.json({ error: "No school in context" }, { status: 400 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const preview = body?.preview === true;
    const confirm = body?.confirm === true;

    /**
     * Validated into the known shape rather than stored as sent. This column
     * is JSON, so without this a malformed POST becomes a malformed row, and
     * the thing that breaks is the sign-up form reading it back weeks later.
     */
    const next: SessionSettings | null = parseSessionSettings(body, { strict: true });
    if (!next) {
      return NextResponse.json({ error: "Invalid settings format" }, { status: 400 });
    }

    const noSlot = levelsWithNoSlot(next);
    if (noSlot.length) {
      return NextResponse.json(
        { error: `Every level needs at least one session. Re-enable one for: ${noSlot.join(", ")}.` },
        { status: 400 },
      );
    }
    const noMode = levelsWithNoMode(next);
    if (noMode.length) {
      return NextResponse.json(
        { error: `Every level needs at least one way to attend. Re-enable one for: ${noMode.join(", ")}.` },
        { status: 400 },
      );
    }

    const prevRow = await prisma.schoolSetting.findFirst({ where: { key: CLASS_SESSIONS_KEY } });
    const prev = parseSessionSettings(prevRow?.value);

    const allowedBranchIds = scopedBranchIds(gate.admin);
    const impact = await computeImpact(prev, next, tenantId, allowedBranchIds ?? null);
    const affected =
      impact.moves.reduce((n, g) => n + g.count, 0) +
      impact.stranded.reduce((n, g) => n + g.count, 0);

    const summary = {
      moves: impact.moves.map(({ level, kind, from, to, count }) => ({ level, kind, from, to, count })),
      stranded: impact.stranded.map(({ level, from, count }) => ({ level, from, count })),
      tutorWarnings: impact.tutorWarnings,
    };

    if (preview) {
      return NextResponse.json({ ok: true, preview: true, affected, ...summary });
    }

    if (affected > 0 && !confirm) {
      return NextResponse.json(
        { ok: false, needsConfirm: true, affected, ...summary },
        { status: 409 },
      );
    }

    // ---- write the setting -------------------------------------------------
    await prisma.schoolSetting.upsert({
      where: { tenantId_key: { tenantId, key: CLASS_SESSIONS_KEY } },
      update: { value: next },
      create: { tenantId, key: CLASS_SESSIONS_KEY, value: next },
    });

    // ---- move the students who were in a now-closed sitting / mode --------
    const now = new Date().toISOString();
    let moved = 0;

    for (const group of impact.moves) {
      const rows = await prisma.student.findMany({
        where: { id: { in: group.studentIds } },
        select: { id: true, admission: true },
      });
      for (let i = 0; i < rows.length; i += 50) {
        const chunk = rows.slice(i, i + 50);
        await Promise.all(
          chunk.map((s) => {
            const admission =
              s.admission && typeof s.admission === "object"
                ? (s.admission as Record<string, unknown>)
                : {};
            return prisma.student.update({
              where: { id: s.id },
              data: {
                ...(group.kind === "slot" ? { sessionSlot: group.to } : { deliveryMode: group.to }),
                admission: {
                  ...admission,
                  scheduleChange: {
                    kind: group.kind,
                    level: group.level,
                    from: group.from,
                    to: group.to,
                    at: now,
                    by: "settings",
                  },
                },
              },
            });
          }),
        );
      }
      moved += group.count;

      await writeAudit(unguardedPrisma, {
        action: group.kind === "slot" ? "sessionSlotBulkMove" : "deliveryModeBulkMove",
        model: "Student",
        affectedCount: group.count,
        severity: "notice",
        summary: `${group.level}: ${group.count} student${group.count === 1 ? "" : "s"} moved from ${group.from} to ${group.to} (session settings)`,
        before: { level: group.level, [group.kind === "slot" ? "sessionSlot" : "deliveryMode"]: group.from },
        after: { level: group.level, [group.kind === "slot" ? "sessionSlot" : "deliveryMode"]: group.to },
      });

      const label =
        group.kind === "slot"
          ? `Your ${group.level} class has moved to the ${group.to} session.`
          : `Your ${group.level} class is now ${group.to === "physical" ? "on campus" : group.to}.`;
      notifyInBackground({
        to: { studentIds: group.studentIds },
        kind: KIND.classSessionChanged,
        severity: "warning",
        title: "Your class schedule has changed",
        message: `${label} Your timetable and community are already updated — open your dashboard for the details.`,
        link: "/dashboard",
        push: true,
      });
    }

    // ---- online-only (and other un-placeable) students: tell the office ---
    for (const group of impact.stranded) {
      await writeAudit(unguardedPrisma, {
        action: "sessionSettingsStranded",
        model: "Student",
        affectedCount: group.count,
        severity: "warning",
        summary: `${group.level}: ${group.count} ${group.from} student${group.count === 1 ? "" : "s"} left with no class after ${group.from} was switched off`,
        after: { level: group.level, mode: group.from, studentIds: group.studentIds },
      });
    }
    if (impact.stranded.length) {
      const lines = impact.stranded
        .map((g) => `${g.count} × ${g.level} (${g.from})`)
        .join(", ");
      notifyInBackground({
        to: { audience: "admin", capability: "students" },
        kind: KIND.general,
        severity: "warning",
        title: "Students need re-placing after a session change",
        message: `Switching sessions off on /admin/settings left students with no class: ${lines}. They have not been moved — re-place them on /admin/students.`,
        link: "/admin/students",
      });
    }

    return NextResponse.json({
      ok: true,
      saved: true,
      moved,
      ...summary,
    });
  } catch (error) {
    console.error("Failed to save school settings:", error);
    return NextResponse.json({ error: "Unable to save settings" }, { status: 500 });
  }
}
