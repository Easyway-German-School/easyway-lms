import nodemailer from "nodemailer";
import { OFFICE } from "@/lib/config";

/**
 * Best-effort email. Without SMTP_HOST set this logs instead of throwing —
 * a booking must never fail because a confirmation email couldn't send, and
 * local dev shouldn't need real SMTP credentials to exercise the flow.
 *
 * IMPORTANT: SMTP_FROM must be an address on a domain Brevo has verified
 * (currently easywayschoollms.com.ng). Using exams@easywaylanguageschool.com
 * as From made Brevo accept then silently drop mail — the journey log still
 * said "sent". Reply-To stays on exams@ so candidates reply to the right desk.
 */

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;

/** Verified Brevo sending identity — never default From to an unverified mailbox. */
const DEFAULT_SMTP_FROM = "Easyway ÖSD Exam Centre <no-reply@easywayschoollms.com.ng>";

function getTransporter() {
  if (!process.env.SMTP_HOST) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === "true",
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
  }
  return transporter;
}

export type EmailAttachment = { filename: string; content: Uint8Array; contentType: string };

/**
 * Resolves true when the message was handed to the SMTP server (or, with no
 * SMTP configured, logged for local dev), false when sending failed. Callers
 * that record "this email went out" (the journey log) must honour that — a
 * failed send that is logged as sent would never be retried.
 */
export async function sendEmail(input: {
  to: string;
  subject: string;
  html: string;
  attachments?: EmailAttachment[];
}): Promise<boolean> {
  const client = getTransporter();
  if (!client) {
    console.log(`[email:not-configured] to=${input.to} subject="${input.subject}"${input.attachments?.length ? ` attachments=${input.attachments.map((a) => a.filename).join(",")}` : ""}`);
    return true;
  }
  try {
    const info = await client.sendMail({
      from: process.env.SMTP_FROM || DEFAULT_SMTP_FROM,
      replyTo: OFFICE.email,
      to: input.to,
      subject: input.subject,
      html: input.html,
      attachments: input.attachments?.map((a) => ({ filename: a.filename, content: Buffer.from(a.content), contentType: a.contentType })),
    });
    // Brevo can return success with rejected recipients — treat that as failure
    // so the journey log is released and Drain Queue can retry.
    const rejected = (info as { rejected?: string[] }).rejected ?? [];
    if (rejected.length > 0) {
      console.error("sendEmail rejected recipients:", rejected);
      return false;
    }
    return true;
  } catch (error) {
    // A failed confirmation email must never fail the booking or the payment
    // it's reporting on — the candidate can always look their booking up by
    // reference code on /status.
    console.error("sendEmail failed:", error);
    return false;
  }
}
