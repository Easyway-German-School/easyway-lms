import { prisma } from "@/lib/prisma";

/**
 * The two documents ÖSD registration needs beyond name/email/phone: a
 * passport-style photograph and the passport's data page. Collected on the
 * registration itself (not the Student/User row) — see the schema comment on
 * ExamRegistration.passportPhotoUrl for why.
 *
 * Reuses the same ownership rule as paying (session owner OR the booking's
 * payToken) rather than a second auth path, even though this has nothing to
 * do with paying — a walk-in candidate who has not claimed their account yet
 * still needs to be able to upload from the confirmation screen.
 */

export type DocumentsOwner = { userId?: string | null; token?: string | null };

export function documentsComplete(reg: { passportPhotoUrl: string | null; passportDataPageUrl: string | null }): boolean {
  return Boolean(reg.passportPhotoUrl && reg.passportDataPageUrl);
}

export async function submitExamDocuments(
  registrationId: string,
  owner: DocumentsOwner,
  files: { passportPhotoUrl?: string | null; passportDataPageUrl?: string | null },
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  // resolvePayable also requires a fee > 0, which document upload should not
  // depend on — an internal free sitting will never call this route, but an
  // exam with a fee that is later waived must not be locked out of it.
  const registration = await prisma.examRegistration.findUnique({
    where: { id: registrationId },
    select: { userId: true, studentId: true, student: { select: { userId: true } } },
  });
  if (!registration) return { ok: false, error: "That registration does not exist.", status: 404 };

  const ownerId = registration.userId ?? registration.student?.userId ?? null;
  const bySession = Boolean(owner.userId && ownerId && owner.userId === ownerId);
  const byToken = Boolean(owner.token && (await tokenMatches(registrationId, owner.token)));
  if (!bySession && !byToken) {
    return { ok: false, error: "You cannot upload documents for this registration.", status: 403 };
  }

  if (!files.passportPhotoUrl && !files.passportDataPageUrl) {
    return { ok: false, error: "Nothing to save.", status: 400 };
  }

  await prisma.examRegistration.update({
    where: { id: registrationId },
    data: {
      ...(files.passportPhotoUrl ? { passportPhotoUrl: files.passportPhotoUrl } : {}),
      ...(files.passportDataPageUrl ? { passportDataPageUrl: files.passportDataPageUrl } : {}),
      // Any new upload clears a prior rejection — the office asked for a
      // resubmission and just got one.
      documentStatus: "pending",
      documentRejectedReason: null,
    },
  });

  return { ok: true };
}

async function tokenMatches(registrationId: string, token: string): Promise<boolean> {
  const { verifyPayToken } = await import("@/lib/exam-payments");
  return verifyPayToken(registrationId, token);
}

/** An admin approves or rejects the uploaded documents. */
export async function reviewExamDocuments(
  registrationId: string,
  decision: "approved" | "rejected",
  reason?: string | null,
): Promise<void> {
  await prisma.examRegistration.update({
    where: { id: registrationId },
    data: {
      documentStatus: decision,
      documentRejectedReason: decision === "rejected" ? reason ?? "Please re-upload a clearer copy." : null,
    },
  });

  if (decision !== "rejected") return;

  const registration = await prisma.examRegistration.findUnique({
    where: { id: registrationId },
    select: {
      examName: true, candidateEmail: true, candidateName: true,
      student: { select: { id: true, user: { select: { email: true, name: true } } } },
      user: { select: { email: true, name: true } },
    },
  });
  if (!registration) return;
  const to = registration.student?.user.email ?? registration.user?.email ?? registration.candidateEmail;
  if (!to) return;
  const name = registration.student?.user.name ?? registration.user?.name ?? registration.candidateName ?? "there";

  const { queueEmail } = await import("@/lib/email-queue");
  await queueEmail({
    to,
    subject: `Please re-upload a document — ${registration.examName}`,
    type: "exam_registration",
    studentId: registration.student?.id ?? null,
    html: `
      <p>Hello ${name},</p>
      <p>We couldn't accept one of your documents for <strong>${registration.examName}</strong>: ${reason ?? "please re-upload a clearer copy."}</p>
      <p>Sign back in and upload it again from your exam booking.</p>
    `,
  });
}
