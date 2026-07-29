import nodemailer from "nodemailer";

const transporter = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: Boolean(process.env.SMTP_SECURE) || false,
      auth: process.env.SMTP_USER
        ? {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
          }
        : undefined,
    })
  : null;

export async function sendEmail({
  to,
  subject,
  html,
}: {
  to: string;
  subject: string;
  html: string;
}) {
  if (!transporter) {
    console.warn("SMTP is not configured; skipping email delivery.");
    return { ok: false, skipped: true };
  }

  return transporter.sendMail({
    from: process.env.SMTP_FROM || "Easyway LMS <no-reply@easyway.test>",
    to,
    subject,
    html,
  });
}
