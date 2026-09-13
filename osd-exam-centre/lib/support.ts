import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";

/**
 * "Need help?" — a candidate messaging the office directly. Distinct from
 * the nurture drip's EXAM_PREP_LINK, which is a deliberate soft-sell CTA
 * ("have you practiced the listening? ... click this link") — this is the
 * plain "something's wrong, get me a human" path off the booking page and
 * the printed admission slip's "what to bring" section.
 *
 * No in-app admin notification system exists in this small app (no user
 * accounts, no bell icon) — email is the office's actual inbox, so that's
 * the notification channel. The message is also stored so /admin/support
 * has a durable list even if the notification email is missed.
 */

export type SubmitSupportMessageInput = {
  /** The public reference code, not the internal id — never exposed to the browser. */
  bookingReference?: string | null;
  name: string;
  email: string;
  message: string;
};

const MESSAGE_RATE_LIMIT = 5;
const MESSAGE_RATE_WINDOW_MS = 60 * 60 * 1000;

export async function submitSupportMessage(input: SubmitSupportMessageInput): Promise<{ ok: true } | { ok: false; error: string }> {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  const message = input.message.trim();
  if (!name || !email || !message) {
    return { ok: false, error: "Name, email and a message are required." };
  }

  const recentCount = await prisma.supportMessage.count({
    where: { email, createdAt: { gte: new Date(Date.now() - MESSAGE_RATE_WINDOW_MS) } },
  });
  if (recentCount >= MESSAGE_RATE_LIMIT) {
    return { ok: false, error: "Too many messages sent recently — please wait before sending another." };
  }

  let booking: { id: string; referenceCode: string; session: { title: string } } | null = null;
  if (input.bookingReference) {
    booking = await prisma.examBooking.findUnique({
      where: { referenceCode: input.bookingReference },
      select: { id: true, referenceCode: true, session: { select: { title: true } } },
    });
  }

  await prisma.supportMessage.create({
    data: { bookingId: booking?.id ?? null, name, email, message },
  });

  const officeEmail = process.env.OFFICE_NOTIFICATION_EMAIL;
  if (officeEmail) {
    await sendEmail({
      to: officeEmail,
      subject: booking ? `Help request — ${booking.referenceCode}` : "Help request — ÖSD Exam Centre",
      html: `
        <p><strong>${name}</strong> (${email}) needs help${booking ? ` with booking <strong>${booking.referenceCode}</strong> (${booking.session.title})` : ""}:</p>
        <p>${escapeHtml(message)}</p>
      `,
    });
  }

  return { ok: true };
}

export async function resolveSupportMessage(id: string): Promise<void> {
  await prisma.supportMessage.update({ where: { id }, data: { status: "resolved", resolvedAt: new Date() } });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br/>");
}
