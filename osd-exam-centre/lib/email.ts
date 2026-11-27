import nodemailer from "nodemailer";
import { OFFICE } from "@/lib/config";

/**
 * Best-effort email. Without SMTP_HOST set this logs instead of throwing —
 * a booking must never fail because a confirmation email couldn't send, and
 * local dev shouldn't need real SMTP credentials to exercise the flow.
 *
 * IMPORTANT: SMTP_HOST is Brevo. From must be a Brevo-verified sender
 * (support@easywaylanguageschool.com). exams@ is Zoho — fine as Reply-To so
 * candidates reply into the exams desk, but NEVER as SMTP From on Brevo
 * (accepted then silently dropped; journey log still said "sent").
 *
 * SMTP accept ≠ inbox delivery. Callers must record messageId / failures
 * honestly — see lib/email-delivery.ts.
 */

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;

/** Brevo-verified From. Reply-To is OFFICE.email (exams@ / Zoho). */
const DEFAULT_SMTP_FROM = "Easyway ÖSD Exam Centre <support@easywaylanguageschool.com>";

function getTransporter() {
  if (!process.env.SMTP_HOST) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === "true",
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
      // Single connection per invocation — nodemailer pooling is a poor fit on
      // Vercel serverless and breaks @types/nodemailer when assigned to the
      // default createTransport return type.
      connectionTimeout: 8_000,
      greetingTimeout: 5_000,
      socketTimeout: 20_000,
    });
  }
  return transporter;
}

export type EmailAttachment = { filename: string; content: Uint8Array; contentType: string };

export type SendEmailResult =
  | { ok: true; messageId: string | null }
  | { ok: false; error: string };

/**
 * Hand the message to Brevo (or log in local dev). `ok: true` means SMTP
 * accepted the handoff — NOT that the candidate's inbox received it.
 */
export async function sendEmail(input: {
  to: string;
  subject: string;
  html: string;
  attachments?: EmailAttachment[];
}): Promise<SendEmailResult> {
  const client = getTransporter();
  if (!client) {
    console.log(`[email:not-configured] to=${input.to} subject="${input.subject}"${input.attachments?.length ? ` attachments=${input.attachments.map((a) => a.filename).join(",")}` : ""}`);
    return { ok: true, messageId: "local-dev" };
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
    const rejected = (info as { rejected?: string[] }).rejected ?? [];
    if (rejected.length > 0) {
      console.error("sendEmail rejected recipients:", rejected);
      return { ok: false, error: `Rejected: ${rejected.join(", ")}` };
    }
    const messageId = typeof info.messageId === "string" ? info.messageId : null;
    return { ok: true, messageId };
  } catch (error) {
    console.error("sendEmail failed:", error);
    const message = error instanceof Error ? error.message : "SMTP send failed";
    return { ok: false, error: message.slice(0, 400) };
  }
}
