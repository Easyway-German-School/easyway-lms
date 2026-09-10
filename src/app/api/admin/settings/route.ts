import { NextResponse } from "next/server";

import { requireCapability, scopedBranchIds } from "@/lib/admin-roles";
import { prisma, unguardedPrisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/prisma-guard";
import { notifyInBackground, KIND } from "@/lib/notify";
import { readAssignment } from "@/lib/lecturer-assignment";
import {
  CLASS_SESSIONS_KEY,
  diffDisabledCells,
  isSessionEnabled,
  levelsWithNoCell,
  nearestEnabledSlotForMode,
  parseSessionSettings,
  slotTitle,
  MODE_LABELS,
  type ModeSlot,
  type SessionConfig,
  type SessionSettings,
  type SessionSlot,
} from "@/lib/school-settings";

/**
 * The school's own configuration, read and written by /admin/settings.
 *
 * Persisted in SchoolSetting rather than held in module state — a Map on the
 * module lives inside one serverless instance, so on Vercel a save would appear
 * to work, then vanish on the next lambda.
 *
 * The POST does more than store JSON. Turning a (session × mode) cell OFF is a
 * real event: the students in it have nowhere to be. So the write is a
 * two-step handshake —
 *   POST { preview: true, ...settings }  → what would move, nothing written
 *   POST { confirm: true, ...settings }  → write the setting AND move them
 * — and a plain POST with people in the firing line returns 409 needsConfirm
 * rather than moving anyone by surprise. A moved student keeps their mode and
 * only changes session (online-morning → online-afternoon).
 */

export const dynamic = "force-dynamic";

const MAX_GROUP = 800;

export async function GET() {
  const gate = await requireCapability("staff");
  if (!gate.ok) return gate.response;

  try {
    const row = await prisma.schoolSetting.findFirst({ where: { key: CLASS_SESSIONS_KEY } });
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
  mode: ModeSlot;
  from: SessionSlot;
  to: SessionSlot;
  count: number;
  studentIds: string[];
};

type StrandedGroup = {
  level: string;
  mode: ModeSlot;
  slot: SessionSlot;
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
 * What a save would do to the students already enrolled. Reads only.
 */
async function computeImpact(
  prev: SessionSettings,
  next: SessionSettings,
  tenantId: string | null,
  allowedBranchIds: string[] | null,
): Promise<Impact> {
  const cells = diffDisabledCells(prev, next);
  const moves: MoveGroup[] = [];
  const stranded: StrandedGroup[] = [];

  const baseWhere: Record<string, unknown> = { status: "active", ...tenantWhere(tenantId) };
  if (allowedBranchIds) baseWhere.branchId = { in: allowedBranchIds };

  for (const cell of cells) {
    const nextRow = rowOf(next, cell.level);
    if (!nextRow) continue;

    const students = await prisma.student.findMany({
      where: {
        ...baseWhere,
        level: cell.level,
        sessionSlot: cell.slot,
        deliveryMode: cell.mode,
      },
      select: { id: true },
      take: MAX_GROUP,
    });
    if (students.length === 0) continue;

    const to = nearestEnabledSlotForMode(nextRow, cell.slot, cell.mode);
    if (to) {
      moves.push({
        level: cell.level,
        mode: cell.mode,
        from: cell.slot,
        to,
        count: students.length,
        studentIds: students.map((s) => s.id),
      });
    } else {
      // No session runs this mode at this level any more — cannot auto-place.
      stranded.push({
        level: cell.level,
        mode: cell.mode,
        slot: cell.slot,
        count: students.length,
        studentIds: students.map((s) => s.id),
      });
    }
  }

  return { moves, stranded, tutorWarnings: await tutorWarningsFor(next, prev, tenantId) };
}

/**
 * Best-effort heads-up: tutors every one of whose assigned sessions, for a
 * level they teach, now runs no mode at all. Informational — never blocks.
 */
async function tutorWarningsFor(
  next: SessionSettings,
  prev: SessionSettings,
  tenantId: string | null,
): Promise<Array<{ name: string; detail: string }>> {
  // Only bother if some session went fully dark (all modes off) that wasn't before.
  const wentDark = new Map<string, Set<string>>();
  for (const nextRow of next.sessions) {
    const prevRow = prev.sessions.find((r) => r.level === nextRow.level);
    if (!prevRow) continue;
    for (const slot of ["morning", "afternoon", "evening", "weekend"] as const) {
      const before = ["physical", "hybrid", "online"].some((m) => prevRow.grid[slot][m as ModeSlot]);
      const after = ["physical", "hybrid", "online"].some((m) => nextRow.grid[slot][m as ModeSlot]);
      if (before && !after) {
        const set = wentDark.get(nextRow.level) ?? new Set<string>();
        set.add(slot);
        wentDark.set(nextRow.level, set);
      }
    }
  }
  if (wentDark.size === 0) return [];

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
      if (a.sessionSlots.length === 0) continue; // teaches every session — safe
      for (const [level, dark] of wentDark) {
        const teachesLevel = a.levels.length === 0 || a.levels.includes(level);
        if (!teachesLevel) continue;
        const stillHasASession = a.sessionSlots.some((slot) => isSessionEnabled(next, level, slot));
        if (!stillHasASession && a.sessionSlots.every((slot) => dark.has(slot))) {
          out.push({
            name: lecturer.user?.name ?? "A tutor",
            detail: `${level} · ${[...dark].map(slotTitle).join(", ")}`,
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

    const next: SessionSettings | null = parseSessionSettings(body, { strict: true });
    if (!next) {
      return NextResponse.json({ error: "Invalid settings format" }, { status: 400 });
    }

    const empty = levelsWithNoCell(next);
    if (empty.length) {
      return NextResponse.json(
        { error: `Every level needs at least one session running. Re-enable one for: ${empty.join(", ")}.` },
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
      moves: impact.moves.map(({ level, mode, from, to, count }) => ({ level, mode, from, to, count })),
      stranded: impact.stranded.map(({ level, mode, slot, count }) => ({ level, mode, slot, count })),
      tutorWarnings: impact.tutorWarnings,
    };

    if (preview) {
      return NextResponse.json({ ok: true, preview: true, affected, ...summary });
    }

    if (affected > 0 && !confirm) {
      return NextResponse.json({ ok: false, needsConfirm: true, affected, ...summary }, { status: 409 });
    }

    // ---- write the setting ----------------------------------------------
    await prisma.schoolSetting.upsert({
      where: { tenantId_key: { tenantId, key: CLASS_SESSIONS_KEY } },
      update: { value: next },
      create: { tenantId, key: CLASS_SESSIONS_KEY, value: next },
    });

    // ---- move the students out of a now-closed session -----------------
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
                sessionSlot: group.to,
                admission: {
                  ...admission,
                  scheduleChange: {
                    kind: "slot",
                    level: group.level,
                    mode: group.mode,
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
        action: "sessionSlotBulkMove",
        model: "Student",
        affectedCount: group.count,
        severity: "notice",
        summary: `${group.level} ${MODE_LABELS[group.mode]}: ${group.count} student${group.count === 1 ? "" : "s"} moved from ${group.from} to ${group.to} (session settings)`,
        before: { level: group.level, sessionSlot: group.from, deliveryMode: group.mode },
        after: { level: group.level, sessionSlot: group.to, deliveryMode: group.mode },
      });

      notifyInBackground({
        to: { studentIds: group.studentIds },
        kind: KIND.classSessionChanged,
        severity: "warning",
        title: "Your class time has changed",
        message: `Your ${group.level} class has moved to the ${slotTitle(group.to)} session (you are still ${group.mode === "physical" ? "on campus" : group.mode}). Your timetable and community are already updated — open your dashboard for the details.`,
        link: "/dashboard",
        push: true,
      });
    }

    // ---- students whose mode has no session left: tell the office ------
    for (const group of impact.stranded) {
      await writeAudit(unguardedPrisma, {
        action: "sessionSettingsStranded",
        model: "Student",
        affectedCount: group.count,
        severity: "warning",
        summary: `${group.level} ${MODE_LABELS[group.mode]}: ${group.count} student${group.count === 1 ? "" : "s"} left with no session after ${group.slot} ${MODE_LABELS[group.mode]} was switched off`,
        after: { level: group.level, mode: group.mode, slot: group.slot, studentIds: group.studentIds },
      });
    }
    if (impact.stranded.length) {
      const lines = impact.stranded
        .map((g) => `${g.count} × ${g.level} ${MODE_LABELS[g.mode]}`)
        .join(", ");
      notifyInBackground({
        to: { audience: "admin", capability: "students" },
        kind: KIND.general,
        severity: "warning",
        title: "Students need re-placing after a session change",
        message: `Switching sessions off on /admin/settings left students with no class of their mode: ${lines}. They have not been moved — re-place them on /admin/students.`,
        link: "/admin/students",
      });
    }

    return NextResponse.json({ ok: true, saved: true, moved, ...summary });
  } catch (error) {
    console.error("Failed to save school settings:", error);
    return NextResponse.json({ error: "Unable to save settings" }, { status: 500 });
  }
}
