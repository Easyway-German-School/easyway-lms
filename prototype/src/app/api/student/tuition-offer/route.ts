import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isLevelSellable, requiredDepositFor, tuitionFeeFor } from "@/lib/payment";
import {
  deriveFullPaymentOffer,
  isSocialProofPublishable,
  paymentOptionsFor,
  type BranchFullPaymentRate,
} from "@/lib/pay-in-full";

/**
 * Everything the checkout needs to make the case for paying 100%.
 *
 * Server-side on purpose. The fee, the bonus window and the branch statistic
 * all decide what the student is charged, and a client that computed them could
 * be edited to quote itself a cheaper price.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireAuthSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const student = await prisma.student.findUnique({
    where: { userId: session.user.id as string },
    select: {
      id: true,
      level: true,
      classType: true,
      branchId: true,
      createdAt: true,
      branch: { select: { name: true } },
      payments: {
        where: { status: "completed" },
        orderBy: { createdAt: "asc" },
        select: { amount: true, createdAt: true },
      },
    },
  });

  if (!student) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  const feeLookup = { level: student.level, branch: student.branch?.name ?? null, classType: student.classType };
  const tuitionFee = tuitionFeeFor(feeLookup);
  const totalPaid = student.payments.reduce((sum, payment) => sum + payment.amount, 0);

  // When the running total first crossed the full fee. Judging the bonus on
  // this rather than on "now" means a student who paid in full on day two keeps
  // the bundle forever, instead of losing it the moment the window lapses.
  let running = 0;
  let fullPaidAt: Date | null = null;
  for (const payment of student.payments) {
    running += payment.amount;
    if (running >= tuitionFee && tuitionFee > 0) {
      fullPaidAt = payment.createdAt;
      break;
    }
  }

  const offer = deriveFullPaymentOffer({
    enrolledAt: student.createdAt,
    tuitionFee,
    totalPaid,
    fullPaidAt,
  });

  return NextResponse.json({
    level: student.level,
    branchName: student.branch?.name ?? null,
    /** False for C1/C2, which the branch office still quotes by hand. */
    sellable: isLevelSellable(student.level),
    requiredDeposit: requiredDepositFor(feeLookup),
    offer,
    options: paymentOptionsFor(offer),
    socialProof: await branchFullPaymentRate(student.branchId),
  });
}

/**
 * The share of this student's own branch who paid in full.
 *
 * Their branch rather than the whole school, because "students here pay in
 * full" is the comparison that carries weight — and because a Lagos figure
 * shown to an Abuja student is about a different price.
 */
async function branchFullPaymentRate(branchId: string | null): Promise<BranchFullPaymentRate | null> {
  if (!branchId) return null;

  const peers = await prisma.student.findMany({
    where: { branchId, status: "active" },
    select: {
      level: true,
      branch: { select: { name: true } },
      payments: { where: { status: "completed" }, select: { amount: true } },
    },
  });

  if (!isSocialProofPublishable(peers.length)) return null;

  const fullPayers = peers.filter((peer) => {
    const paid = peer.payments.reduce((sum, payment) => sum + payment.amount, 0);
    return paid >= tuitionFeeFor({ level: peer.level, branch: peer.branch?.name ?? null });
  }).length;

  return {
    percent: Math.round((fullPayers / peers.length) * 100),
    sample: peers.length,
  };
}
