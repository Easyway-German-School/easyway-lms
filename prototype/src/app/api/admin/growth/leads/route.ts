import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability, scopedBranchIds } from "@/lib/admin-roles";
import { assignLead, updateLeadStage } from "@/lib/growth/leads";

export const dynamic = "force-dynamic";

/**
 * GET — the pipeline list. `?scope=team` shows everyone's leads (any
 * Growth Desk account can, since the role is flat for now — see
 * admin-roles.ts); the default is "my own", which is what a rep opens the
 * desk to see.
 */
export async function GET(req: NextRequest) {
  const gate = await requireCapability("growth");
  if (!gate.ok) return gate.response;

  const branchIds = scopedBranchIds(gate.admin);
  const scope = req.nextUrl.searchParams.get("scope");
  const status = req.nextUrl.searchParams.get("status");

  const leads = await prisma.lead.findMany({
    where: {
      ...(scope === "team" ? {} : { assignedToId: gate.admin.userId }),
      ...(status ? { status } : {}),
      ...(branchIds ? { branchId: { in: branchIds } } : {}),
    },
    include: {
      branch: { select: { name: true } },
      assignedTo: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  return NextResponse.json({
    leads: leads.map((l) => ({
      id: l.id,
      name: l.name,
      email: l.email,
      phone: l.phone,
      branchName: l.branch?.name ?? null,
      interestedLevel: l.interestedLevel,
      source: l.source,
      status: l.status,
      assignedTo: l.assignedTo,
      createdAt: l.createdAt,
    })),
  });
}

/**
 * PATCH — the only way a rep moves a lead through the funnel or hands it to
 * someone else. Both actions go through src/lib/growth/leads.ts so every
 * change lands in LeadActivity; there is no path here that writes
 * Lead.status or Lead.assignedToId directly.
 */
export async function PATCH(req: NextRequest) {
  const gate = await requireCapability("growth");
  if (!gate.ok) return gate.response;

  const body = await req.json().catch(() => null);
  const { leadId, action } = (body || {}) as Record<string, unknown>;

  if (typeof leadId !== "string" || !leadId) {
    return NextResponse.json({ error: "leadId is required" }, { status: 400 });
  }

  if (action === "stage") {
    const { status, note } = body as Record<string, unknown>;
    if (typeof status !== "string" || !status) {
      return NextResponse.json({ error: "status is required" }, { status: 400 });
    }
    await updateLeadStage({
      leadId,
      status,
      note: typeof note === "string" ? note : null,
      actorId: gate.admin.userId,
    });
    return NextResponse.json({ ok: true });
  }

  if (action === "reassign") {
    const { assignedToId } = body as Record<string, unknown>;
    if (typeof assignedToId !== "string" || !assignedToId) {
      return NextResponse.json({ error: "assignedToId is required" }, { status: 400 });
    }
    await assignLead({ leadId, assignedToId, actorId: gate.admin.userId });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: `Unknown action "${String(action)}"` }, { status: 400 });
}
