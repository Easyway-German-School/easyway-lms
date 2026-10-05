import { NextResponse } from "next/server";

import { requireCapability, scopedBranchIds } from "@/lib/admin-roles";
import { graduateStudents, loadGraduationDesk, setBatchAutomatic } from "@/lib/graduation-server";

/**
 * The graduation desk.
 *
 *   GET                                  every batch that has finished (or
 *                                        finishes within a fortnight), grouped
 *                                        by branch · level · batch, with who is
 *                                        ready and who is not and why
 *   POST {action:"graduate", studentIds} for the learners named: move up the ready ones
 *                                        (sign off, certificate, next level and
 *                                        intake) and INVITE the ones who only owe on
 *                                        the level just finished; everyone gets
 *                                        Becca's next-level message, and tutors a note
 *   POST {action:"setAuto", enabled}     one switch for the whole thing, run each morning
 *
 * The browser sends ids, never a verdict: readiness is recomputed here at the
 * moment of the click (see lib/graduation-server.ts).
 */

export const dynamic = "force-dynamic";
// Each call moves a small slice (the page sends ten at a time), but every
// learner is a dozen writes.
export const maxDuration = 60;

const MAX_PER_CALL = 25;

function tenantWhere(tenantId: string | null | undefined) {
  if (!tenantId) return {};
  return { OR: [{ tenantId }, { branch: { tenantId } }, { user: { tenantId } }] };
}

type Gate = Extract<Awaited<ReturnType<typeof requireCapability>>, { ok: true }>;

function fence(gate: Gate) {
  const where: Record<string, unknown> = { ...tenantWhere(gate.session.user.tenantId ?? null) };
  const allowedBranchIds = scopedBranchIds(gate.admin);
  if (allowedBranchIds) where.branchId = { in: allowedBranchIds };
  return where;
}

export async function GET() {
  const gate = await requireCapability("students");
  if (!gate.ok) return gate.response;

  try {
    const desk = await loadGraduationDesk({ where: fence(gate), tenantId: gate.session.user.tenantId ?? null });
    return NextResponse.json(desk);
  } catch (error) {
    console.error("Graduation desk failed to load:", error);
    return NextResponse.json({ error: "Unable to load the graduation desk" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const gate = await requireCapability("students");
  if (!gate.ok) return gate.response;

  const body = await request.json().catch(() => ({}));
  const action = typeof body.action === "string" ? body.action : "";
  const tenantId = gate.session.user.tenantId ?? null;

  try {
    if (action === "graduate") {
      const ids: string[] = Array.isArray(body.studentIds)
        ? (body.studentIds as unknown[]).filter((id): id is string => typeof id === "string" && id.trim().length > 0)
        : [];
      if (ids.length === 0) return NextResponse.json({ error: "Choose at least one learner" }, { status: 400 });
      if (ids.length > MAX_PER_CALL) {
        return NextResponse.json({ error: `Move at most ${MAX_PER_CALL} learners at a time` }, { status: 400 });
      }
      const result = await graduateStudents(ids, { where: fence(gate), tenantId });
      return NextResponse.json({ ok: true, ...result });
    }

    if (action === "setAuto") {
      if (!tenantId) return NextResponse.json({ error: "No school in context" }, { status: 400 });
      const auto = await setBatchAutomatic(tenantId, body.enabled === true);
      return NextResponse.json({ ok: true, auto });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("Graduation action failed:", error);
    return NextResponse.json({ error: "That did not work — please try again" }, { status: 500 });
  }
}
