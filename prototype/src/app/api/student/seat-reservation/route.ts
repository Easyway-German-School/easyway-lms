import { NextResponse } from "next/server";

import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { loadUpcomingBatchRows } from "@/lib/batch-reservation-server";

/**
 * The waiting-room screen's own numbers: which seat is mine, how many seats in
 * my intake are already secured, and how far along my payment is.
 *
 * Deliberately returns COUNTS and the caller's own row only — never another
 * learner's name, amount or seat. "12 learners have secured an October seat"
 * is social proof; who they are is not the student's business.
 *
 * Only meaningful while the caller is waiting for a batch; anyone else gets
 * `waiting: false` and the screen never asks.
 */
export async function GET() {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const student = await prisma.student.findUnique({
    where: { userId: session.user.id as string },
    select: { id: true, user: { select: { name: true } } },
  });
  if (!student) return NextResponse.json({ error: "Student not found" }, { status: 404 });

  const rows = await loadUpcomingBatchRows();
  const mine = rows.find((row) => row.studentId === student.id);
  if (!mine) return NextResponse.json({ waiting: false });

  const sameIntake = rows.filter((row) => row.batchLabel === mine.batchLabel);
  const firstName = (student.user?.name ?? "").trim().split(/\s+/)[0] ?? "";

  return NextResponse.json({
    waiting: true,
    firstName,
    batchLabel: mine.batchLabel,
    startsOn: mine.startsOn,
    seat: mine.seat,
    seatNumber: mine.seatNumber,
    // How many learners in this intake have put money down — real, never padded.
    secured: sameIntake.filter((row) => row.seat !== "unpaid").length,
    registrationPaid: mine.registrationPaid,
    tuitionPaid: mine.tuitionPaid,
    tuitionFee: mine.tuitionFee,
    requiredDeposit: mine.requiredDeposit,
    depositOutstanding: mine.depositOutstanding,
    balanceOutstanding: mine.balanceOutstanding,
  });
}
