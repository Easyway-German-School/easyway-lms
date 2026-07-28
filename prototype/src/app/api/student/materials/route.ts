import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

const TUITION_LEVELS: Record<string, number> = {
  A1: 150000,
  A2: 150000,
  B1: 180000,
  B2: 180000,
  C1: 200000,
  C2: 220000,
};

export async function GET() {
  try {
    const session = await getServerSession(authOptions as any) as any;
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const student = await prisma.student.findUnique({
      where: { userId: session.user.id },
      include: {
        payments: true,
      },
    });

    if (!student) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    const tuitionFee = TUITION_LEVELS[student.level] ?? 150000;
    const totalPaid = student.payments
      .filter((payment) => payment.status === "completed")
      .reduce((sum, payment) => sum + payment.amount, 0);
    const registrationFee = 5000;
    const requiredDeposit = Math.round(tuitionFee * 0.6);
    const canUnlockMaterials = totalPaid >= requiredDeposit;

    if (!canUnlockMaterials) {
      return NextResponse.json(
        {
          materials: [],
          locked: true,
          requiredDeposit,
          tuitionFee,
          totalPaid,
          message: `Pay the deposit of ${requiredDeposit.toLocaleString()} NGN (${Math.round((requiredDeposit / tuitionFee) * 100)}%) to unlock course materials.`,
        },
        { status: 403 }
      );
    }

    const materials = await prisma.material.findMany({
      where: {
        course: {
          level: student.level,
        },
      },
      include: {
        course: {
          select: { title: true, level: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ materials, locked: false, totalPaid, tuitionFee });
  } catch (error) {
    console.error("Error fetching materials:", error);
    return NextResponse.json(
      { error: "Failed to fetch materials" },
      { status: 500 }
    );
  }
}
