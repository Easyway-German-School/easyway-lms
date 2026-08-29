import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";
import { withUnsubscribeFooter } from "@/lib/email-queue";
import { KIND, notify } from "@/lib/notify";
import { MAIL_IDENTITIES } from "@/lib/mail-identity";
import {
  applyMergeFields,
  blocksToPlainText,
  parseBlocks,
  renderEmailBlocks,
  type EmailBlock,
} from "@/lib/email-blocks";
import { derivePaymentStatus, requiredDepositFor, tuitionFeeFor } from "@/lib/payment";

/**
 * An announcement from the office, to a selected audience.
 *
 * IT GOES THROUGH notify(), AND THAT IS THE POINT OF THIS FILE.
 *
 * It used to call queueCampaign directly, which meant a message from the
 * school reached a mailbox and nothing else: no row in anybody's bell, no
 * push, no read receipt, nothing in the notification history. A student who
 * had the app installed and notifications on still had to check their email to
 * learn their class had moved. And because the audience query only ever
 * selected Students, there was no way to tell the tutors anything at all.
 *
 * Now one send fans out to every channel a person accepts — bell, push and a
 * designed email — honouring the same per-kind routing and per-person
 * preferences as every other notification in the system. The email keeps its
 * block design via `emailHtmlFor`; the bell and the push get the plain text of
 * the same blocks, because a notification tray is not a place for a letterhead.
 *
 * `preview` returns who WOULD receive it without sending anything. Reaching a
 * few hundred people is not undoable, so the composer always shows the list.
 */

export const dynamic = "force-dynamic";

type Audience = {
  branchId?: string | null;
  level?: string | null;
  /** all | unpaid | paid — students only; a tutor has no tuition. */
  paymentStatus?: string | null;
  /** students | tutors | both */
  group?: string | null;
};

/**
 * A discriminated union rather than "the value, or a Response".
 *
 * `requireCapability` hands back `gate.response` typed as the platform
 * `Response`, and `auth instanceof NextResponse` cannot narrow that — so the
 * previous shape compiled only while nothing read a field off the success
 * branch. An explicit `ok` flag is what the AI guard already does.
 */
type EmailAdminGate =
  | { ok: true; userId: string }
  | { ok: false; response: Response };

async function requireEmailAdmin(): Promise<EmailAdminGate> {
  const gate = await requireCapability("emails");
  if (!gate.ok) return { ok: false, response: gate.response };
  return { ok: true, userId: gate.session.user.id as string };
}

/** One person the send will reach, whichever role they hold. */
type Recipient = {
  userId: string;
  studentId: string | null;
  name: string | null;
  email: string;
  level: string;
  role: "student" | "tutor";
  studentCode: string | null;
};

async function resolveAudience(audience: Audience): Promise<Recipient[]> {
  const group = audience.group ?? "students";
  const out: Recipient[] = [];

  if (group === "students" || group === "both") {
    out.push(...(await resolveStudents(audience)));
  }

  if (group === "tutors" || group === "both") {
    /**
     * Tutors are filtered by branch only. Level on a Lecturer is the class
     * they are ASSIGNED to teach, not a level they are at, and payment status
     * is meaningless for staff — applying either would silently drop tutors
     * from a message meant for all of them.
     */
    const lecturers = await prisma.lecturer.findMany({
      where: {
        ...(audience.branchId ? { branchId: audience.branchId } : {}),
        status: { not: "inactive" },
      },
      select: { level: true, user: { select: { id: true, name: true, email: true } } },
    });

    for (const lecturer of lecturers) {
      if (!lecturer.user?.email) continue;
      out.push({
        userId: lecturer.user.id,
        studentId: null,
        name: lecturer.user.name,
        email: lecturer.user.email,
        level: lecturer.level ?? "—",
        role: "tutor",
        studentCode: null,
      });
    }
  }

  // A tutor who is also enrolled as a student would otherwise be written to
  // twice by a "both" send.
  const seen = new Set<string>();
  return out.filter((person) => (seen.has(person.userId) ? false : seen.add(person.userId)));
}

async function resolveStudents(audience: Audience): Promise<Recipient[]> {
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
      user: { select: { id: true, name: true, email: true } },
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
    .filter((s) => Boolean(s.user.email))
    .map((s) => ({
      userId: s.user.id,
      studentId: s.id,
      name: s.user.name,
      email: s.user.email!,
      level: s.level,
      role: "student" as const,
      studentCode: s.studentCode,
    }));
}

export async function POST(req: NextRequest) {
  const auth = await requireEmailAdmin();
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json();
    const { subject, audience = {}, preview, link } = body as {
      subject?: string; audience?: Audience; preview?: boolean; link?: string;
    };
    const blocks: EmailBlock[] = parseBlocks(body.blocks);

    const recipients = await resolveAudience(audience);

    if (preview) {
      return NextResponse.json({
        count: recipients.length,
        students: recipients.filter((r) => r.role === "student").length,
        tutors: recipients.filter((r) => r.role === "tutor").length,
        sample: recipients.slice(0, 25).map((r) => ({
          name: r.name,
          email: r.email,
          level: r.level,
          role: r.role,
          studentCode: r.studentCode,
        })),
      });
    }

    if (!subject?.trim() || blocks.length === 0) {
      return NextResponse.json({ error: "A subject and at least one block are required" }, { status: 400 });
    }
    if (recipients.length === 0) {
      return NextResponse.json({ error: "That audience has nobody in it" }, { status: 400 });
    }

    /**
     * An announcement from the office invites a reply, so it goes out as the
     * support identity rather than donotreply. See mail-identity.ts — a notice
     * from a person that arrives from a no-reply address tells the reader the
     * school does not want to hear back.
     */
    const identity = MAIL_IDENTITIES.support;
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || "";
    const byUserId = new Map(recipients.map((r) => [r.userId, r]));

    // The bell and the push get prose, not a letterhead.
    const plain = blocksToPlainText(blocks);

    const result = await notify({
      to: { userIds: recipients.map((r) => r.userId) },
      kind: KIND.announcement,
      severity: "info",
      title: subject.trim(),
      message: plain.slice(0, 240),
      link: typeof link === "string" && link.trim() ? link.trim() : "/notifications",
      senderId: auth.userId,
      push: true,
      // Force the email on. This is a human deciding to write to the school;
      // the per-kind default is for automated traffic, and an admin pressing
      // Send has already made the decision the setting exists to make.
      email: true,
      emailHtmlFor: (person) => {
        const who = byUserId.get(person.id);
        const html = renderEmailBlocks({
          blocks,
          subject: subject.trim(),
          senderName: identity.name,
          footer: identity.footer,
          baseUrl,
          greetingName: person.name,
        });
        return withUnsubscribeFooter(
          applyMergeFields(html, { name: person.name, level: who?.level ?? null }),
          person.email,
        );
      },
    });

    return NextResponse.json({
      queued: result.queuedEmails,
      notified: result.created,
      pushed: result.pushed,
      recipients: recipients.length,
      students: recipients.filter((r) => r.role === "student").length,
      tutors: recipients.filter((r) => r.role === "tutor").length,
    });
  } catch (error) {
    console.error("Bulk email failed:", error);
    return NextResponse.json({ error: "Unable to queue that campaign" }, { status: 500 });
  }
}

/** GET — recent campaigns and queue health for the dashboard. */
export async function GET() {
  const auth = await requireEmailAdmin();
  if (!auth.ok) return auth.response;

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
