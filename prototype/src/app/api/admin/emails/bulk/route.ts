import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { adminHasCapability } from "@/lib/admin-roles";
import { queueCampaign, withUnsubscribeFooter } from "@/lib/email-queue";
import { derivePaymentStatus, requiredDepositFor, tuitionFeeFor } from "@/lib/payment";

/**
 * Bulk email to a selected audience.
 *
 * Sending is never immediate — everything is queued and drained by the worker,
 * so composing for 300 students returns straight away and one bad address
 * cannot take down the batch.
 *
 * `preview` returns who WOULD receive it without queueing anything. Sending a
 * few hundred emails is not undoable, so the composer always shows the list
 * first.
 */

export const dynamic = "force-dynamic";

type Audience = {
  branchId?: string | null;
  level?: string | null;
  /** all | unpaid | paid */
  paymentStatus?: string | null;
};

async function requireEmailAdmin() {
  const session = (await getServerSession(authOptions as any)) as any;
  if (!session?.user?.id) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (!(await adminHasCapability(session.user.id, "emails"))) {
    return { error: NextResponse.json({ error: "Your admin role does not cover email" }, { status: 403 }) };
  }
  return { userId: session.user.id as string };
}

async function resolveAudience(audience: Audience) {
  const students = await prisma.student.findMany({
    where: {
      status: "active",
      ...(audience.branchId ? { branchId: audience.branchId } : {}),
      ...(audience.level ? { level: audience.level } : {}),
    },
    select: {
      id: true,
      level: true,
      classType: true,
      studentCode: true,
      // Needed for the fee: Abuja is priced above the other branches.
      branch: { select: { name: true } },
      user: { select: { name: true, email: true } },
      payments: { where: { status: "completed" }, select: { amount: true } },
    },
  });

  const wanted = audience.paymentStatus ?? "all";

  return students
    .filter((s) => {
      if (wanted === "all") return true;
      const feeLookup = { level: s.level, branch: s.branch?.name ?? null, classType: s.classType };
      const totalPaid = s.payments.reduce((sum, p) => sum + p.amount, 0);
      const { fullPaid } = derivePaymentStatus({
        totalPaid,
        tuitionFee: tuitionFeeFor(feeLookup),
        requiredDeposit: requiredDepositFor(feeLookup),
      });
      return wanted === "paid" ? fullPaid : !fullPaid;
    })
    .filter((s) => Boolean(s.user.email));
}

export async function POST(req: NextRequest) {
  const auth = await requireEmailAdmin();
  if (auth.error) return auth.error;

  try {
    const body = await req.json();
    const { subject, html, audience = {}, preview } = body as {
      subject?: string; html?: string; audience?: Audience; preview?: boolean;
    };

    const recipients = await resolveAudience(audience);

    if (preview) {
      return NextResponse.json({
        count: recipients.length,
        sample: recipients.slice(0, 25).map((s) => ({
          name: s.user.name,
          email: s.user.email,
          level: s.level,
          studentCode: s.studentCode,
        })),
      });
    }

    if (!subject?.trim() || !html?.trim()) {
      return NextResponse.json({ error: "A subject and a message are required" }, { status: 400 });
    }
    if (recipients.length === 0) {
      return NextResponse.json({ error: "That audience has nobody in it" }, { status: 400 });
    }

    const campaignId = `bulk-${Date.now()}`;

    const result = await queueCampaign(
      recipients.map((s) => ({
        to: s.user.email!,
        subject: subject.trim(),
        // Personalise, then append the unsubscribe footer that keeps bulk mail
        // out of spam folders.
        html: withUnsubscribeFooter(
          html.replace(/\{\{name\}\}/g, s.user.name ?? "there").replace(/\{\{level\}\}/g, s.level),
          s.user.email!,
        ),
        type: "bulk",
        studentId: s.id,
      })),
      campaignId,
    );

    return NextResponse.json(result);
  } catch (error) {
    console.error("Bulk email failed:", error);
    return NextResponse.json({ error: "Unable to queue that campaign" }, { status: 500 });
  }
}

/** GET — recent campaigns and queue health for the dashboard. */
export async function GET() {
  const auth = await requireEmailAdmin();
  if (auth.error) return auth.error;

  const [counts, recent, suppressions] = await Promise.all([
    prisma.emailMessage.groupBy({ by: ["status"], _count: { status: true } }),
    prisma.emailMessage.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true, to: true, subject: true, type: true, status: true,
        attempts: true, lastError: true, sentAt: true, createdAt: true, campaignId: true,
      },
    }),
    prisma.emailSuppression.findMany({ orderBy: { createdAt: "desc" }, take: 25 }),
  ]);

  return NextResponse.json({
    counts: Object.fromEntries(counts.map((c) => [c.status, c._count.status])),
    recent,
    suppressions,
  });
}
