import { getServerSession } from "next-auth";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requiredDepositFor, tuitionFeeFor } from "@/lib/payment";

export async function GET() {
  try {
    const session = await requireAuthSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

    /**
     * MATCH ON THE MATERIAL'S OWN LEVEL AS WELL AS ITS COURSE'S.
     *
     * This used to be `course: { level: student.level }` alone, and that is a
     * relation filter on a NULLABLE relation — so it silently excluded every
     * material with no course at all. `Material.courseId` became optional when
     * class recordings arrived (a recording belongs to a level and a date, not
     * to a course), and the lecturer upload route deliberately allows a null
     * course for anything that is not a document.
     *
     * The result: a tutor uploaded a class video, the row was written with
     * `level = "A1"` and no course, and it appeared for nobody. On this
     * database that was four of the eight A1 materials — half of everything at
     * the level, invisible, with no error anywhere to explain it.
     *
     * `/api/student/videos` had this right all along, which is what made the
     * bug so confusing to look at: the same upload showed on the Watch shelf
     * and not in Materials. The two queries now agree.
     */
    const records = await prisma.material.findMany({
      where: {
        OR: [{ level: student.level }, { course: { level: student.level } }],
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
