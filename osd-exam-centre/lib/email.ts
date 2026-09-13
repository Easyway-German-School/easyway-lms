import nodemailer from "nodemailer";

/**
 * Best-effort email. Without SMTP_HOST set this logs instead of throwing —
 * a booking must never fail because a confirmation email couldn't send, and
 * local dev shouldn't need real SMTP credentials to exercise the flow.
 */

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;

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

export async function sendEmail(input: { to: string; subject: string; html: string }): Promise<void> {
  const client = getTransporter();
  if (!client) {
    console.log(`[email:not-configured] to=${input.to} subject="${input.subject}"`);
    return;
  }
  try {
    await client.sendMail({
      from: process.env.SMTP_FROM || "Easyway ÖSD Exam Centre <no-reply@easywayschoollms.com.ng>",
      to: input.to,
      subject: input.subject,
      html: input.html,
    });
  } catch (error) {
    // A failed confirmation email must never fail the booking or the payment
    // it's reporting on — the candidate can always look their booking up by
    // reference code on /status.
    console.error("sendEmail failed:", error);
  }
}
