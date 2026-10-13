import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isLevelSellable, requiredDepositFor, tuitionFeeFor, receivedPaymentFilter } from "@/lib/payment";
import { getStudentAccess } from "@/lib/student-access";
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
      pathway: true,
      sessionSlot: true,
      branchId: true,
      createdAt: true,
      branch: { select: { name: true } },
      payments: {
        where: receivedPaymentFilter(),
        orderBy: { createdAt: "asc" },
        select: { amount: true, createdAt: true },
      },
    },
  });

  if (!student) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  const feeLookup = { level: student.level, branch: student.branch?.name ?? null, classType: student.classType, pathway: student.pathway };

  /**
   * THE FIX FOR THE "PAID IN FULL, CERTIFICATE CLEAN" LIE.
   *
   * This used to compare the student's LIFETIME total (every payment, every
   * level, via the raw `student.payments` sum below) against only the CURRENT
   * level's fee. For a returning student with an older, unsettled level on
   * file, lifetime money easily clears one level's fee while the ledger
   * (src/lib/finance/ledger.ts, FIFO oldest-charge-first) has actually
   * allocated that money to the old debt first — so this screen said
   * "Tuition paid in full — certificate issued clean" while the SAME
   * student's community/dashboard, reading the ledger correctly via
   * access.ts, kept them locked out for unpaid tuition. Two screens, two
   * different answers to "have they paid?", because this one re-implemented
   * the question instead of asking the one place that owns it.
   *
   * `access.currentLevelPaid` is that one place's answer: what the ledger
   * actually credits to THIS level, FIFO-reconciled. Using it here means this
   * screen can never again claim "paid in full" while the portal disagrees.
   */
  const access = await getStudentAccess(student.id);
  const tuitionFee = access?.tuitionFee ?? tuitionFeeFor(feeLookup);
  const totalPaidForLevel = access?.currentLevelPaid ?? student.payments.reduce((sum, payment) => sum + payment.amount, 0);

  // When the running total first crossed the full fee. Judging the bonus on
  // this rather than on "now" means a student who paid in full on day two keeps
  // the bundle forever, instead of losing it the moment the window lapses.
  // (This walk is still over the raw lifetime payments — the bonus window is a
  // low-stakes perk, not a lock gate, and only matters in the first 14 days of
  // a FRESH enrolment, where lifetime and current-level money are the same
  // thing anyway.)
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
    totalPaid: totalPaidForLevel,
    fullPaidAt,
    sessionSlot: student.sessionSlot,
  });

  return NextResponse.json({
    level: student.level,
    branchName: student.branch?.name ?? null,
    /** False for C1/C2, which the branch office still quotes by hand. */
    sellable: isLevelSellable(student.level),
    requiredDeposit: access?.requiredDeposit ?? requiredDepositFor(feeLookup),
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
      payments: { where: receivedPaymentFilter(), select: { amount: true } },
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
