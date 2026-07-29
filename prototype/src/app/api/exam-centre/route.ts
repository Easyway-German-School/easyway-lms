import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { listOpenExams, registerForExam } from "@/lib/exam-centre";
import { queueEmail } from "@/lib/email-queue";
import { ensureCandidateAccount } from "@/lib/candidates";
import { payToken } from "@/lib/exam-payments";

/**
 * Public exam centre: browse open sittings and book a seat.
 *
 * Deliberately reachable without signing in. The centre sits members of the
 * public for ÖSD, and forcing an account on someone who just wants an exam
 * seat would lose the booking.
 */

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const level = req.nextUrl.searchParams.get("level");
    const branchId = req.nextUrl.searchParams.get("branchId");

    const [exams, branches] = await Promise.all([
      listOpenExams({ level, branchId }),
      prisma.branch.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    ]);

    // Signed-in students get their own details prefilled.
    const session = (await getServerSession(authOptions as any)) as any;
    let me = null;
    if (session?.user?.id) {
      const student = await prisma.student.findUnique({
        where: { userId: session.user.id },
        select: { id: true, level: true, studentCode: true, user: { select: { name: true, email: true } } },
      });
      if (student) {
        me = {
          studentId: student.id,
          name: student.user.name,
          email: student.user.email,
          level: student.level,
          studentCode: student.studentCode,
        };
      }
    }

    return NextResponse.json({ exams, branches, me });
  } catch (error) {
    console.error("Exam centre GET failed:", error);
    return NextResponse.json({ error: "Unable to load exam sittings" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { examId, candidateName, candidateEmail, candidatePhone, notes } = body;

    if (!examId) {
      return NextResponse.json({ error: "examId is required" }, { status: 400 });
    }

    // A signed-in student registers as themselves; the client cannot pass a
    // studentId and book on someone else's behalf.
    const session = (await getServerSession(authOptions as any)) as any;
    let studentId: string | null = null;
    let notifyEmail = candidateEmail as string | undefined;
    let notifyName = candidateName as string | undefined;

    if (session?.user?.id) {
      const student = await prisma.student.findUnique({
        where: { userId: session.user.id },
        select: { id: true, user: { select: { name: true, email: true } } },
      });
      if (student) {
        studentId = student.id;
        notifyEmail = student.user.email ?? notifyEmail;
        notifyName = student.user.name ?? notifyName;
      }
    }

    // An external candidate gets a real account, so they can come back and
    // see their seat, result and certificate rather than relying on one email.
    // An existing account of any role is reused — a former student booking an
    // ÖSD sitting is the same person and must not end up with two logins.
    let ownerUserId: string | null = session?.user?.id ?? null;
    let claimLink: string | undefined;

    if (!studentId && candidateEmail) {
      const account = await ensureCandidateAccount({ email: candidateEmail, name: candidateName });
      ownerUserId = account.userId;
      claimLink = account.claimUrl;
    }

    const result = await registerForExam({
      examId,
      studentId,
      userId: ownerUserId,
      candidateName: studentId ? null : candidateName,
      candidateEmail: studentId ? null : candidateEmail,
      candidatePhone: studentId ? null : candidatePhone,
      notes,
    });

    if (!result.ok) {
      const status = result.code === "full" || result.code === "duplicate" ? 409 : 400;
      return NextResponse.json({ error: result.error, code: result.code }, { status });
    }

    const exam = await prisma.exam.findUnique({
      where: { id: examId },
      select: { name: true, examDate: true, examBody: true, fee: true, branch: { select: { name: true } } },
    });

    // Confirmation is queued, not sent inline — a mail outage must not fail a
    // booking that already holds a seat.
    if (notifyEmail && exam) {
      const feeLine = result.fee
        ? `<p><strong>Fee:</strong> ₦${result.fee.toLocaleString()} — your seat is held once payment is received.</p>`
        : "";
      // Only new accounts get a claim link; existing ones already have a password.
      const claimBlock = claimLink
        ? `<p>We have created an account so you can check your booking, seat and result at any time.
             <a href="${claimLink}">Set your password</a> to sign in.</p>`
        : "";
      await queueEmail({
        to: notifyEmail,
        subject: `Registration confirmed — ${exam.name}`,
        type: "exam_registration",
        studentId,
        html: `
          <p>Hello ${notifyName ?? "there"},</p>
          <p>Your registration for <strong>${exam.name}</strong> is confirmed.</p>
          <p><strong>Date:</strong> ${new Date(exam.examDate).toDateString()}<br/>
             <strong>Seat:</strong> ${result.seatNumber}<br/>
             ${exam.branch?.name ? `<strong>Centre:</strong> ${exam.branch.name}<br/>` : ""}
             <strong>Awarding body:</strong> ${exam.examBody}</p>
          ${feeLine}
          ${claimBlock}
          <p>Please arrive 30 minutes early with a valid photo ID.</p>
        `,
      });
    }

    return NextResponse.json({
      registrationId: result.registrationId,
      seatNumber: result.seatNumber,
      fee: result.fee,
      // Returned only to the browser that just registered with this address,
      // so a new candidate can set a password without waiting for the email.
      claimUrl: claimLink ?? null,
      // Lets them pay immediately, before claiming the account. Bound to this
      // one registration.
      payToken: result.fee ? payToken(result.registrationId) : null,
    });
  } catch (error) {
    console.error("Exam registration POST failed:", error);
    return NextResponse.json({ error: "Unable to register" }, { status: 500 });
  }
}
