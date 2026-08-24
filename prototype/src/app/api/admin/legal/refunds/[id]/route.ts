import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";
import { KIND, notifyInBackground } from "@/lib/notify";

const DECISION_STATUSES = new Set(["under_review", "approved", "rejected", "paid"]);

/** Management's decision on one refund request — the only write this queue ever gets. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireCapability("payments");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const { status, decisionAmount, decisionNote } = (body || {}) as Record<string, unknown>;

  if (typeof status !== "string" || !DECISION_STATUSES.has(status)) {
    return NextResponse.json({ error: "Unrecognised decision status." }, { status: 400 });
  }

  const existing = await prisma.refundRequest.findUnique({
    where: { id },
    select: { id: true, userId: true, fullName: true, status: true },
  });
  if (!existing) return NextResponse.json({ error: "Refund request not found" }, { status: 404 });

  const normalizedAmount =
    typeof decisionAmount === "number" && Number.isFinite(decisionAmount) && decisionAmount >= 0
      ? Math.round(decisionAmount)
      : undefined;

  const updated = await prisma.refundRequest.update({
    where: { id },
    data: {
      status,
      decisionAmount: normalizedAmount,
      decisionNote: typeof decisionNote === "string" && decisionNote.trim() ? decisionNote.trim() : undefined,
      decidedById: gate.admin.userId,
      decidedAt: status === "under_review" ? undefined : new Date(),
      paidAt: status === "paid" ? new Date() : undefined,
    },
  });

  const STATUS_LABEL: Record<string, string> = {
    under_review: "is now under review",
    approved: "was approved",
    rejected: "was not approved",
    paid: "has been paid out",
  };

  notifyInBackground({
    to: { userIds: [existing.userId] },
    kind: KIND.refundDecided,
    severity: status === "approved" || status === "paid" ? "success" : status === "rejected" ? "warning" : "info",
    title: "Your refund request was updated",
    message: `Your refund request ${STATUS_LABEL[status] ?? "was updated"}.${
      typeof decisionNote === "string" && decisionNote.trim() ? ` Note: ${decisionNote.trim()}` : ""
    }`,
    link: "/payments",
  });

  return NextResponse.json({ request: { id: updated.id, status: updated.status } });
}
