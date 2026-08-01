import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requiredDepositFor, tuitionFeeFor } from "@/lib/payment";

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
        branch: { select: { name: true } },
      },
    });

    if (!student) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    const feeLookup = { level: student.level, branch: student.branch?.name ?? null, classType: student.classType };
    const tuitionFee = tuitionFeeFor(feeLookup);
    const totalPaid = student.payments
      .filter((payment) => payment.status === "completed")
      .reduce((sum, payment) => sum + payment.amount, 0);
    const requiredDeposit = requiredDepositFor(feeLookup);
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

    const records = await prisma.material.findMany({
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

    // The client reads `fileUrl`; the column is `filePath`. Expose both so the
    // download link resolves instead of rendering as undefined.
    const materials = records.map((material) => ({
      ...material,
      fileUrl: material.filePath.startsWith("/") ? material.filePath : `/${material.filePath}`,
    }));

    return NextResponse.json({ materials, locked: false, totalPaid, tuitionFee });
  } catch (error) {
    console.error("Error fetching materials:", error);
    return NextResponse.json(
      { error: "Failed to fetch materials" },
      { status: 500 }
    );
  }
}
