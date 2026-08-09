import nodemailer from "nodemailer";
import { prisma } from "@/lib/prisma";
import { mailersendToken, sendViaMailerSend } from "@/lib/mailerlite";
import { formatFrom, MAIL_IDENTITIES, type MailIdentityKey } from "@/lib/mail-identity";

/**
 * Outbound email.
 *
 * Zoho is the school's provider, so `EMAIL_PROVIDER=zoho` fills in the host
 * and port and you only supply the mailbox and an app-specific password.
 * Anything else falls back to explicit SMTP_* settings.
 *
 * Every send is written to EmailLog — sent or failed. Without that there is no
 * way to answer "did the fee reminder actually go out?", which is the whole
 * point of having reminders.
 */

/**
 * Env vars arrive as strings, so `Boolean(process.env.X)` is true for the
 * string "false". Parse it properly: that exact bug forced TLS on port 587,
 * where STARTTLS is expected, and made every send fail to connect.
 */
function envFlag(value: string | undefined, fallback = false): boolean {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

const PROVIDER_PRESETS: Record<string, { host: string; port: number; secure: boolean }> = {
  // Zoho requires SSL on 465 for SMTP.
  zoho: { host: "smtp.zoho.com", port: 465, secure: true },
  gmail: { host: "smtp.gmail.com", port: 465, secure: true },
  /**
   * Brevo relays on 587 with STARTTLS, so `secure` is FALSE here.
   *
   * That looks wrong and is not: `secure: true` means "wrap the socket in TLS
   * from the first byte", which is port 465's behaviour. On 587 the connection
   * opens in the clear and upgrades via STARTTLS, and forcing TLS immediately
   * makes every send fail to connect. This codebase has already been bitten by
   * exactly that — see the envFlag() comment above, where the string "false"
   * was being read as true and doing this same damage.
   */
  brevo: { host: "smtp-relay.brevo.com", port: 587, secure: false },
};

function buildTransport() {
  const provider = (process.env.EMAIL_PROVIDER ?? "").trim().toLowerCase();
  const preset = PROVIDER_PRESETS[provider];

  const host = preset?.host ?? process.env.SMTP_HOST;
  if (!host) return null;

  /**
   * A preset supplies a host but never a mailbox, so `EMAIL_PROVIDER=zoho` with
   * no SMTP_USER produced a transport that looked configured and failed at
   * authentication on every send — `isEmailConfigured()` returning true while
   * nothing could actually be delivered. Zoho and Gmail always require
   * credentials, so treat their absence as "not configured".
   *
   * An explicit SMTP_HOST is left alone: a relay on the same box legitimately
   * accepts unauthenticated mail.
   */
  if (preset && !process.env.SMTP_USER) return null;

  /**
   * An explicit SMTP_PORT wins over the preset, exactly as SMTP_SECURE below
   * already does.
   *
   * This was `preset?.port ?? SMTP_PORT`, so choosing a provider silently made
   * the port unsettable — and that is not a theoretical inconvenience. Many
   * networks (Nigerian consumer ISPs especially, but plenty of office and
   * hosting firewalls too) block outbound 587 and 465 wholesale to stop spam
   * from compromised machines. Measured on this one: Brevo 587 and 465 both
   * hang with no connection and no error, Gmail 587 likewise — while Brevo's
   * alternate 2525 answers immediately. Every provider publishes a port like
   * 2525 for precisely this case, and there was no way to select it without
   * abandoning the preset and hand-writing the host too.
   *
   * A blocked port fails as a silent hang rather than a refusal, which reads
   * exactly like a wrong password. That is the trap this closes.
   */
  const portOverride = Number(process.env.SMTP_PORT);
  const port = Number.isFinite(portOverride) && portOverride > 0
    ? portOverride
    : preset?.port ?? 587;

  // An explicit SMTP_SECURE still wins over the preset when it is set.
  const secure =
    process.env.SMTP_SECURE !== undefined && process.env.SMTP_SECURE !== ""
      ? envFlag(process.env.SMTP_SECURE)
      : port === 465
        ? true
        : port === preset?.port
          ? preset.secure
          : false;

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
}

const transporter = buildTransport();

/**
 * MailerSend is preferred when configured: it is an HTTP API, so it needs no
 * SMTP port open and survives hosts that block outbound 587. SMTP remains the
 * fallback.
 */
export function isEmailConfigured() {
  return Boolean(mailersendToken()) || transporter !== null;
}

export function activeTransport(): "mailersend" | "smtp" | "none" {
  if (mailersendToken()) return "mailersend";
  return transporter ? "smtp" : "none";
}

function fromAddress() {
  const raw = process.env.SMTP_FROM || "Easyway LMS <no-reply@easyway.test>";
  // Accept both "Name <a@b.c>" and a bare address.
  const match = raw.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  return match
    ? { name: match[1] || undefined, email: match[2] }
    : { name: undefined, email: raw.trim() };
}

export type SendEmailResult = {
  ok: boolean;
  skipped?: boolean;
  error?: string;
};

export async function sendEmail({
  to,
  subject,
  html,
  type = "general",
  studentId,
  identity,
}: {
  to: string;
  subject: string;
  html: string;
  /** Categorises the row in EmailLog: welcome, fee_reminder_7d, etc. */
  type?: string;
  studentId?: string | null;
  /**
   * Which of the school's two addresses this goes out as — "support" or
   * "noreply". See src/lib/mail-identity.ts. Omitted falls back to SMTP_FROM,
   * so every existing caller keeps the behaviour it already had.
   */
  identity?: MailIdentityKey;
}): Promise<SendEmailResult> {
  // The chosen identity wins over SMTP_FROM. Authentication is still the one
  // mailbox in SMTP_USER — only the From: header changes per message, which is
  // exactly what lets one paid mailbox send as both addresses.
  const chosen = identity ? MAIL_IDENTITIES[identity] : null;

  // Preferred path: MailerSend's HTTP API.
  if (mailersendToken()) {
    const from = chosen
      ? { email: chosen.email, name: chosen.name }
      : fromAddress();
    const result = await sendViaMailerSend({
      to,
      subject,
      html,
      fromEmail: from.email,
      fromName: from.name,
    });

    await logEmail({
      to, subject, type, studentId,
      status: result.ok ? "sent" : "failed",
      error: result.ok ? undefined : result.error,
    });

    return result.ok ? { ok: true } : { ok: false, error: result.error };
  }

  if (!transporter) {
    console.warn("Email is not configured; skipping delivery to", to);
    // Recorded as failed rather than silently dropped, so an unconfigured
    // server cannot look like one that delivered successfully.
    await logEmail({ to, subject, type, studentId, status: "failed", error: "Email not configured" });
    return { ok: false, skipped: true, error: "Email not configured" };
  }

  try {
    await transporter.sendMail({
      from: chosen ? formatFrom(chosen) : process.env.SMTP_FROM || "Easyway LMS <no-reply@easyway.test>",
      // Even the automated address routes replies to a person — a student who
      // hits reply on a wrong receipt should reach the office, not a bounce.
      ...(chosen?.replyTo ? { replyTo: chosen.replyTo } : {}),
      to,
      subject,
      html,
    });
    await logEmail({ to, subject, type, studentId, status: "sent" });
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown mail error";
    console.error("Email delivery failed:", message);
    await logEmail({ to, subject, type, studentId, status: "failed", error: message });
    return { ok: false, error: message };
  }
}

async function logEmail(entry: {
  to: string;
  subject: string;
  type: string;
  studentId?: string | null;
  status: string;
  error?: string;
}) {
  // Logging must never be the reason a send fails.
  try {
    await prisma.emailLog.create({
      data: {
        recipientEmail: entry.to,
        subject: entry.subject,
        type: entry.type,
        status: entry.status,
        studentId: entry.studentId ?? null,
        errorMessage: entry.error ?? null,
      },
    });
  } catch (err) {
    console.warn("Could not write EmailLog entry:", err);
  }
}
