import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";
import { logLeadActivity } from "@/lib/growth/activity";
import { isGrowthAiActive } from "@/lib/growth/ai-settings";
import { rescoreOpenTasksForLead, autoCompleteTasksForLeadActivity } from "@/lib/growth/tasks";

export const dynamic = "force-dynamic";

/**
 * Read with Claude after a note lands — gated on the super admin's switch
 * AND a configured key (isGrowthAiActive checks both), and fire-and-forget
 * so a rep saving a note is never held up by an AI call. Mirrors the
 * after()/runUnscoped shape src/lib/email-queue.ts already uses for the
 * same "do real work after the response, outside the request's tenant
 * scope" problem.
 */
async function enrichLeadInBackground(leadId: string, tenantId: string | null | undefined): Promise<void> {
  if (!(await isGrowthAiActive(tenantId))) return;

  try {
    const { after } = await import("next/server");
    after(async () => {
      try {
        const { runUnscoped } = await import("@/lib/tenant/context");
        await runUnscoped("post-note AI read of a lead's activity history, outside request scope like the email kick", async () => {
          const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true, name: true } });
          if (!lead) return;

          const recent = await prisma.leadActivity.findMany({
            where: { leadId, type: { in: ["note", "call"] } },
            orderBy: { createdAt: "desc" },
            take: 10,
            select: { payload: true },
          });
          const notes = recent
            .map((r) => (r.payload && typeof r.payload === "object" ? (r.payload as Record<string, unknown>).note : null))
            .filter((n): n is string => typeof n === "string" && n.trim().length > 0);
          if (notes.length === 0) return;

          const { analyzeLeadSignal } = await import("@/lib/ai");
          const signal = await analyzeLeadSignal({ leadName: lead.name, notes });
          if (!signal) return;

          await logLeadActivity({ leadId, type: "ai_signal", payload: signal, actorId: null });
          await rescoreOpenTasksForLead(leadId);
        });
      } catch (error) {
        console.warn("growth: post-note AI enrichment failed", error);
      }
    });
  } catch {
    /* No request scope — safe to skip; the next note logged will try again. */
  }
}

/** GET — the full, unrewritable history for one lead. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireCapability("growth");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const activity = await prisma.leadActivity.findMany({
    where: { leadId: id },
    include: { actor: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ activity });
}

/** POST — log a note or a call. The only kinds a rep can write by hand. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireCapability("growth");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const { type, note } = (body || {}) as Record<string, unknown>;

  if (type !== "note" && type !== "call") {
    return NextResponse.json({ error: 'type must be "note" or "call"' }, { status: 400 });
  }
  if (typeof note !== "string" || !note.trim()) {
    return NextResponse.json({ error: "note is required" }, { status: 400 });
  }

  const lead = await prisma.lead.findUnique({ where: { id }, select: { id: true } });
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  await logLeadActivity({
    leadId: id,
    type,
    payload: { note: note.trim() },
    actorId: gate.admin.userId,
  });

  // A logged note or call IS the proof of work — see autoCompleteTasksForLeadActivity.
  // No self-click "done" needed or accepted for this lead's follow-up task.
  await autoCompleteTasksForLeadActivity({ leadId: id, actorId: gate.admin.userId });

  // Best-effort, after the response — see enrichLeadInBackground. A rep
  // saving a note never waits on this, and it silently does nothing when
  // the super admin's switch is off or no key is configured.
  await enrichLeadInBackground(id, gate.session.user.tenantId);

  return NextResponse.json({ ok: true });
}
