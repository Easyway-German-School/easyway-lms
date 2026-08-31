import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildResultSheet, resultSheetToCsv } from "@/lib/result-sheet";

/**
 * The signed-in student's own result sheet.
 *
 * `?format=csv` returns the flat CSV the "Download CSV" button asks for;
 * anything else returns the JSON the print page renders. Ownership is implicit —
 * the sheet is built for the caller's own student row and nobody else's, so
 * there is no id to guess.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await requireAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const student = await prisma.student.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  });
  if (!student) {
    return NextResponse.json({ error: "No student record" }, { status: 404 });
  }

  const sheet = await buildResultSheet(student.id, { audience: "student" });
  if (!sheet) {
    return NextResponse.json({ error: "No student record" }, { status: 404 });
  }

  if (new URL(request.url).searchParams.get("format") === "csv") {
    return new NextResponse(resultSheetToCsv(sheet), {
      headers: {
        "Content-Type": "text/csv;charset=utf-8",
        "Content-Disposition": `attachment; filename="result-sheet-${sheet.student.level}.csv"`,
      },
    });
  }

  return NextResponse.json({ sheet });
}
