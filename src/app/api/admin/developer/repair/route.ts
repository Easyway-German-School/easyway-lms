import { NextResponse } from "next/server";

import { requireCapability } from "@/lib/admin-roles";
import { repairCapability, runRepair } from "@/lib/diagnose-server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const REFERENCE = /^[A-Za-z0-9_.\-]{4,120}$/;

/**
 * Run ONE repair from the developer console's whitelist.
 *
 * Two gates: access to the console (`security`, super admin only), AND the
 * capability the specific repair needs — recording a payment needs `payments`
 * even for somebody who can otherwise see this console. The body is treated as
 * a request, not an instruction: runRepair re-derives the problem itself and does
 * nothing unless it still exists (see lib/diagnose-server.ts).
 */
export async function POST(request: Request) {
  const gate = await requireCapability("security");
  if (!gate.ok) return gate.response;

  const body = (await request.json().catch(() => ({}))) as { studentId?: unknown; repairId?: unknown; params?: unknown };
  const studentId = typeof body.studentId === "string" ? body.studentId : "";
  const repairId = typeof body.repairId === "string" ? body.repairId : "";
  if (!studentId || !repairId) return NextResponse.json({ error: "studentId and repairId are required" }, { status: 400 });

  const needs = repairCapability(repairId);
  if (!needs) return NextResponse.json({ error: "Unknown repair" }, { status: 400 });
  if (!gate.admin.can(needs)) {
    return NextResponse.json({ error: `This repair needs the "${needs}" permission, which your account does not have.` }, { status: 403 });
  }

  // Only known, well-formed params pass through — nothing free-form reaches a repair.
  const params: Record<string, string> = {};
  if (body.params && typeof body.params === "object") {
    const reference = (body.params as Record<string, unknown>).reference;
    if (typeof reference === "string") {
      if (!REFERENCE.test(reference)) return NextResponse.json({ error: "That does not look like a Paystack reference" }, { status: 400 });
      params.reference = reference;
    }
  }

  return NextResponse.json(await runRepair({ studentId, repairId, params }));
}
