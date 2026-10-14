import { NextResponse } from "next/server";

import { requireCapability } from "@/lib/admin-roles";
import { repairCapability, runRepair, type RepairOutcome } from "@/lib/diagnose-server";
import type { RepairId } from "@/lib/diagnose";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BATCH_SIZE = 10;

type RepairRequest = { studentId: string; repairId: RepairId };
type BatchResult = RepairRequest & { outcome: RepairOutcome };

function isBatchableRepair(id: unknown): id is RepairId {
  return id === "sync_tuition_charge" || id === "assign_student_code";
}

/** Run only deterministic, non-payment-recording repairs from a reviewed scan. */
export async function POST(request: Request) {
  const gate = await requireCapability("security");
  if (!gate.ok) return gate.response;

  const body = (await request.json().catch(() => ({}))) as { items?: unknown };
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > MAX_BATCH_SIZE) {
    return NextResponse.json({ error: `Provide between 1 and ${MAX_BATCH_SIZE} repairs` }, { status: 400 });
  }

  const items: RepairRequest[] = [];
  const seen = new Set<string>();
  for (const item of body.items) {
    if (!item || typeof item !== "object") {
      return NextResponse.json({ error: "Each repair must include a student ID and repair ID" }, { status: 400 });
    }
    const candidate = item as Record<string, unknown>;
    const studentId = candidate.studentId;
    const repairId = candidate.repairId;
    if (
      typeof studentId !== "string" ||
      studentId.length < 1 ||
      studentId.length > 128 ||
      !isBatchableRepair(repairId)
    ) {
      return NextResponse.json({ error: "That repair is not allowed in a batch" }, { status: 400 });
    }
    const key = `${studentId}:${repairId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ studentId, repairId });
  }

  const results: BatchResult[] = [];
  for (const item of items) {
    const capability = repairCapability(item.repairId);
    const outcome = !capability || !gate.admin.can(capability)
      ? {
          ok: false,
          verified: false,
          message: `This repair needs the "${capability ?? "unknown"}" permission, which your account does not have.`,
        }
      : await runRepair(item);
    results.push({ ...item, outcome });
  }

  return NextResponse.json({ results });
}
