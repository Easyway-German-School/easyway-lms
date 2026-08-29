import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { requireAuthSession } from "@/lib/auth";
import { sendDueFeeReminders } from "@/lib/fee-reminders";

/**
 * POST /api/emails/send/fee-reminders
 * Send fee reminder emails for PARTIAL payments at 7, 14, and 30 days
 * Can be called manually or via cron job
 */
export async function POST(request: Request) {
  try {
    const session = await requireAuthSession();
    
    if (!session || (session.user.role !== "ADMIN" && session.user.role !== "SYSTEM")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const { studentId, forceSend = false } = body;

    // The work itself lives in lib/fee-reminders.ts so the scheduler can call
    // it directly instead of making an authenticated request to this route.
    const { sentCount, totalProcessed, errors } = await sendDueFeeReminders({ studentId, forceSend });

    return NextResponse.json({
      success: true,
      message: `Fee reminders sent to ${sentCount} students`,
      sentCount,
      totalProcessed,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error("Error sending fee reminders:", error);
    return NextResponse.json({ error: "Failed to send fee reminders" }, { status: 500 });
  }
}

/**
 * GET /api/emails/send/fee-reminders
 * Get statistics on fee reminders sent
 */
export async function GET(request: Request) {
  try {
    const session = await requireAuthSession();
    
    if (!session || (session.user.role !== "ADMIN" && session.user.role !== "SYSTEM")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get email log statistics
    const emailStats = await prisma.emailLog.groupBy({
      by: ["type"],
      where: {
        type: {
          contains: "fee_reminder",
        },
      },
      _count: true,
    });

    // Get count of students with PARTIAL invoices
    const partialInvoices = await prisma.invoice.count({
      where: { status: "partial" },
    });

    return NextResponse.json({
      totalPartialInvoices: partialInvoices,
      emailStats: emailStats.reduce(
        (acc, stat) => {
          acc[stat.type] = stat._count;
          return acc;
        },
        {} as Record<string, number>
      ),
    });
  } catch (error) {
    console.error("Error fetching fee reminder stats:", error);
    return NextResponse.json({ error: "Failed to fetch statistics" }, { status: 500 });
  }
}
