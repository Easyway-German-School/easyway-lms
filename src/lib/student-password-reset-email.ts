import { queueEmail } from "@/lib/email-queue";
import { EMAIL_BRAND, absoluteUrl, emailShell, escapeHtml } from "@/lib/email-brand";
import { MAIL_IDENTITIES } from "@/lib/mail-identity";

/**
 * The letter a student gets when the office resets their password by hand.
 *
 * For the case where a student calls in locked out and the self-service
 * "forgot password" email either hasn't been checked or is sitting in the
 * queue — the office sets a new password directly from the student's admin
 * page, and this is the only place that password is ever shown outside the
 * admin's own screen. Same shape as `parent-account-email.ts`: a password
 * mailed in plain text is a first password to change, not a secret to keep.
 */

const { ink: INK, muted: MUTED, orange: BRAND, line: LINE, font: FONT } = EMAIL_BRAND;

export type StudentPasswordReset = {
  studentName: string;
  studentEmail: string;
  temporaryPassword: string;
};

function absolute(link: string): string {
  return absoluteUrl(link, process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || "");
}

export function studentPasswordResetHtml(input: StudentPasswordReset): string {
  const who = MAIL_IDENTITIES.noreply;
  const firstName = input.studentName.trim().split(/\s+/)[0] || "there";
  const signIn = absolute("/auth/signin");

  const content = `
    <tr><td style="padding:26px 24px 8px;font-family:${FONT};">
      <h1 style="margin:0 0 12px;font:700 22px/28px ${FONT};color:${INK};">
        Your password was reset, ${escapeHtml(firstName)}
      </h1>
      <p style="margin:0 0 14px;font-size:15px;line-height:24px;color:${INK};">
        The office set a new password for your account. If you did not ask for this, contact us straight away —
        otherwise, sign in with the password below and you're back in.
      </p>
    </td></tr>

    <tr><td style="padding:0 24px 20px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="border:1px solid ${LINE};border-left:4px solid ${BRAND};border-radius:10px;">
        <tr><td style="padding:14px 18px;font-family:${FONT};">
          <p style="margin:0 0 4px;font-size:12px;letter-spacing:.6px;text-transform:uppercase;color:${MUTED};">
            Your login
          </p>
          <p style="margin:0 0 6px;font:400 14px/20px ${FONT};color:${INK};">
            Email: <strong>${escapeHtml(input.studentEmail)}</strong>
          </p>
          <p style="margin:0;font:400 14px/20px ${FONT};color:${INK};">
            New password: <strong style="font-family:monospace;">${escapeHtml(input.temporaryPassword)}</strong>
          </p>
          <p style="margin:8px 0 0;font-size:12px;line-height:18px;color:${MUTED};">
            Please sign in and change this the first chance you get.
          </p>
        </td></tr>
      </table>
    </td></tr>

    <tr><td style="padding:0 24px 28px;font-family:${FONT};">
      <a href="${signIn}"
         style="background:${BRAND};color:#ffffff;padding:12px 26px;text-decoration:none;border-radius:8px;display:inline-block;font:700 14px/20px ${FONT};">
        Sign in
      </a>
      <p style="margin:14px 0 0;font-size:12px;line-height:18px;color:${MUTED};">
        If the button does not work, open ${escapeHtml(signIn)}
      </p>
    </td></tr>

    <tr><td style="padding:0 24px 24px;font-family:${FONT};">
      <p style="margin:0;font-size:12px;line-height:18px;color:${MUTED};">
        This was set by a member of staff at your request. If that wasn't you, reply to the office and we'll secure
        your account.
      </p>
    </td></tr>`;

  return emailShell({
    title: "Your Easyway password was reset",
    senderName: who.name,
    footer: who.footer,
    content,
    preheader: "The office set a new password for your account.",
  });
}

/** Queue the new-password email. Caller decides what to do if this throws. */
export async function sendStudentPasswordResetEmail(input: StudentPasswordReset): Promise<void> {
  await queueEmail({
    to: input.studentEmail,
    subject: "Your Easyway password was reset",
    html: studentPasswordResetHtml(input),
    type: "student_password_reset",
    identity: "noreply",
  });
}
