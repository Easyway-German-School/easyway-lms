import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { deriveStudentAccess } from "@/lib/access";
import { requiredDepositFor, tuitionFeeFor } from "@/lib/payment";

/**
 * The one question every gated page asks: may this student see class content yet?
 *
 * Deliberately tiny. The five gated pages used to each fetch the full
 * /api/student/profile payload — enrollments, materials, every notification and
 * payment row — only to read two booleans off it. The shell now calls this once
 * per navigation instead.
 */
export async function GET() {
  const session = (await getServerSession(authOptions as any)) as any;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const student = await prisma.student.findUnique({
    where: { userId: session.user.id as string },
    select: {
      level: true,
      classType: true,
      // The fee depends on the branch as well as the level — leaving it out
      // would compute an Abuja student's gate at the cheaper Lagos price.
      branch: { select: { name: true } },
      payments: {
        where: { status: "completed" },
        select: { amount: true },
      },
    },
  });

  if (!student) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  const totalPaid = student.payments.reduce((sum, payment) => sum + payment.amount, 0);
  const feeLookup = { level: student.level, branch: student.branch?.name ?? null, classType: student.classType };

  return NextResponse.json(
    deriveStudentAccess({
      totalPaid,
      tuitionFee: tuitionFeeFor(feeLookup),
      requiredDeposit: requiredDepositFor(feeLookup),
    }),
  );
}
