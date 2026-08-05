import { NextResponse } from "next/server";

/**
 * GET /api/cron/fee-reminders
 * Scheduled cron job to send fee reminders
 * Call this endpoint periodically (e.g., daily) using a service like EasyCron or GitHub Actions
 */
export async function GET(request: Request) {
  try {
    // Verify the request is from a trusted source
    const authHeader = request.headers.get("authorization");
    const expectedToken = process.env.CRON_SECRET;

    if (!expectedToken || authHeader !== `Bearer ${expectedToken}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const response = await fetch(`${process.env.NEXTAUTH_URL}/api/emails/send/fee-reminders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.SYSTEM_API_KEY}`,
      },
      body: JSON.stringify({ forceSend: false }),
    });

    const data = await response.json();
    return NextResponse.json({
      success: true,
      message: "Cron job executed",
      result: data,
    });
  } catch (error) {
    console.error("Cron job error:", error);
    return NextResponse.json({ error: "Cron job failed" }, { status: 500 });
  }
}
