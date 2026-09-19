import { NextRequest, NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readSessionSettings } from "@/lib/school-settings-server";
import { isCellEnabled } from "@/lib/school-settings";
import { HYBRID_COMBOS, fallbackHybridCombo, findHybridCombo } from "@/lib/hybrid-combo";
import { autoAssignTutor } from "@/lib/tutor-auto-assign";

/**
 * "Pick your hybrid sittings" — HybridComboMoment. Existing hybrid students
 * predate the combo picker on signup (lib/hybrid-combo.ts): they registered
 * under the old single vague "hybrid" mode, with no concrete online sitting
 * and so no online tutor ever matched to them. This is the retroactive
 * version of the same question, and posts through the same write-time
 * assignment engine (lib/tutor-auto-assign.ts) the signup route uses, so a
 * student answering this gets exactly the same rule-based pairing a new
 * hybrid signup gets — not a special case.
 *
 *   GET  → { due, combos } — due only for a hybrid student with no
 *          `hybridOnlineSlot` on file yet; everyone else (including a new
 *          signup who already picked one) never sees this.
 *   POST { comboId } → stores the pair and re-runs auto-assignment. An
 *          invalid or missing id, exactly like "Other" on signup, falls back
 *          to the first combo that still runs for their level rather than
 *          leaving them unanswered.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const student = await prisma.student.findUnique({
    where: { userId: session.user.id },
    select: { deliveryMode: true, hybridOnlineSlot: true, level: true },
  });
  if (!student) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const due = student.deliveryMode === "hybrid" && !student.hybridOnlineSlot;
  return NextResponse.json({
    due,
    level: student.level,
    combos: HYBRID_COMBOS.map((combo) => ({ id: combo.id, label: combo.label })),
  });
}

export async function POST(req: NextRequest) {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const comboId = typeof body?.comboId === "string" ? body.comboId : "";

  const student = await prisma.student.findUnique({
    where: { userId: session.user.id },
    select: {
      id: true,
      level: true,
      branchId: true,
      deliveryMode: true,
      admission: true,
      user: { select: { name: true, email: true, tenantId: true } },
    },
  });
  if (!student) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (student.deliveryMode !== "hybrid") {
    return NextResponse.json({ error: "This is only for hybrid students." }, { status: 400 });
  }

  const tenantId = student.user?.tenantId ?? null;
  const sessionSettings = await readSessionSettings(tenantId);
  const isSlotOpen = (level: string | null | undefined, slot: string, mode: "hybrid" | "online") =>
    isCellEnabled(sessionSettings, level, slot, mode, student.branchId);

  const picked = findHybridCombo(comboId);
  const resolved =
    picked && picked.id !== "other" && picked.physicalSlot && picked.onlineSlot
      ? picked
      : fallbackHybridCombo(isSlotOpen, student.level);
  const wasDefaulted = !picked || picked.id === "other";

  const admission: Record<string, unknown> =
    student.admission && typeof student.admission === "object" ? { ...(student.admission as Record<string, unknown>) } : {};
  admission.hybridComboWasDefaulted = wasDefaulted || undefined;

  await prisma.student.update({
    where: { id: student.id },
    data: {
      sessionSlot: resolved.physicalSlot!,
      hybridOnlineSlot: resolved.onlineSlot!,
      admission,
    },
  });

  await autoAssignTutor({
    studentId: student.id,
    studentName: student.user?.name || student.user?.email || "A student",
    tenantId,
    branchId: student.branchId,
    level: student.level,
    deliveryMode: "hybrid",
    sessionSlot: resolved.physicalSlot!,
    hybridOnlineSlot: resolved.onlineSlot!,
    admission,
  }).catch((error) => console.error("Auto-assign after hybrid-combo answer failed", error));

  return NextResponse.json({ ok: true, combo: { id: resolved.id, label: resolved.label } });
}
