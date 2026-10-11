import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, requireCapability } from "@/lib/admin-roles";
import { isOverdue } from "@/lib/growth/fund-requests";

export const dynamic = "force-dynamic";

/**
 * GET — Growth Desk, the COO, and the Accountant can all see the list
 * (small team, and knowing a colleague's request is stuck past the 1-hour
 * window is the entire point of the escalation rule). Approving one is a
 * separate, narrower check — see PATCH.
 */
export async function GET() {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;
  if (!gate.admin.can("growth") && gate.admin.adminRole !== "super" && gate.admin.adminRole !== "accountant") {
    return NextResponse.json({ error: "Your admin role does not cover fund requests" }, { status: 403 });
  }

  const requests = await prisma.fundRequest.findMany({
    include: {
      requester: { select: { id: true, name: true, email: true } },
      approvedBy: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  const isCoo = gate.admin.adminRole === "super";

  return NextResponse.json({
    requests: requests.map((r) => {
      const overdue = isOverdue(r);
      return {
        id: r.id,
        amount: r.amount,
        purpose: r.purpose,
        category: r.category,
        status: r.status,
        requester: r.requester,
        approvedBy: r.approvedBy,
        approvedAt: r.approvedAt,
        decisionNote: r.decisionNote,
        createdAt: r.createdAt,
        overdue,
        canDecide:
          r.status === "pending" &&
          (isCoo || (gate.admin.adminRole === "accountant" && overdue)),
      };
    }),
  });
}

/** POST — raise a request. Who approves it is a separate step (PATCH). */
export async function POST(req: NextRequest) {
  const gate = await requireCapability("growth");
  if (!gate.ok) return gate.response;

  const body = await req.json().catch(() => null);
  const { amount, purpose, category } = (body || {}) as Record<string, unknown>;

  const parsedAmount = Number(amount);
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
    return NextResponse.json({ error: "A positive amount is required" }, { status: 400 });
  }
  if (typeof purpose !== "string" || !purpose.trim()) {
    return NextResponse.json({ error: "A purpose is required" }, { status: 400 });
  }

  const request = await prisma.fundRequest.create({
    data: {
      requesterId: gate.admin.userId,
      amount: Math.round(parsedAmount),
      purpose: purpose.trim(),
      category: ["marketing", "mobility", "other"].includes(String(category)) ? String(category) : "other",
    },
  });

  return NextResponse.json({ ok: true, requestId: request.id });
}
