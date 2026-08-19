import { queueEmail } from "@/lib/email-queue";
import { EMAIL_BRAND, absoluteUrl, emailShell, escapeHtml } from "@/lib/email-brand";
import { MAIL_IDENTITIES } from "@/lib/mail-identity";

/**
 * The letter a student gets when the office creates their account for them —
 * a manual add, a pasted batch, or a CSV import of students already mid-course.
 * Distinct from `student-password-reset-email.ts`: that one tells someone
 * their *existing* password just changed; this one is a first introduction to
 * an account they never signed up for themselves, so the copy welcomes them
 * in rather than warning them something happened. Same shell, same brand,
 * same "a password mailed in plain text is a first password to change" rule.
 */

const { ink: INK, muted: MUTED, orange: BRAND, line: LINE, font: FONT } = EMAIL_BRAND;

export type StudentWelcome = {
  studentName: string;
  studentEmail: string;
  temporaryPassword: string;
  studentCode?: string | null;
};

function absolute(link: string): string {
  return absoluteUrl(link, process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || "");
}

export function studentWelcomeHtml(input: StudentWelcome): string {
  const who = MAIL_IDENTITIES.noreply;
  const firstName = input.studentName.trim().split(/\s+/)[0] || "there";
  const signIn = absolute("/auth/signin");

  const content = `
    <tr><td style="padding:26px 24px 8px;font-family:${FONT};">
      <h1 style="margin:0 0 12px;font:700 22px/28px ${FONT};color:${INK};">
        Welcome to Easyway, ${escapeHtml(firstName)}
      </h1>
      <p style="margin:0 0 14px;font-size:15px;line-height:24px;color:${INK};">
        The office has set up your student portal account. Everything — your classes, your materials, your
        progress — lives behind the login below.
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
            Password: <strong style="font-family:monospace;">${escapeHtml(input.temporaryPassword)}</strong>
          </p>
          ${
            input.studentCode
              ? `<p style="margin:8px 0 0;font-size:12px;line-height:18px;color:${MUTED};">
                   Your student ID is <strong>${escapeHtml(input.studentCode)}</strong>.
                 </p>`
              : ""
          }
          <p style="margin:8px 0 0;font-size:12px;line-height:18px;color:${MUTED};">
            Please sign in and change this the first chance you get.
          </p>
        </td></tr>
      </table>
    </td></tr>

    <tr><td style="padding:0 24px 28px;font-family:${FONT};">
      <a href="${signIn}"
         style="background:${BRAND};color:#ffffff;padding:12px 26px;text-decoration:none;border-radius:8px;display:inline-block;font:700 14px/20px ${FONT};">
        Sign in to your portal
      </a>
      <p style="margin:14px 0 0;font-size:12px;line-height:18px;color:${MUTED};">
        If the button does not work, open ${escapeHtml(signIn)}
      </p>
    </td></tr>

    <tr><td style="padding:0 24px 24px;font-family:${FONT};">
      <p style="margin:0;font-size:12px;line-height:18px;color:${MUTED};">
        This account was created by a member of staff. If that wasn't expected, reply to the office and we'll
        look into it.
      </p>
    </td></tr>`;

  return emailShell({
    title: "Welcome to Easyway",
    senderName: who.name,
    footer: who.footer,
    content,
    preheader: "Your student portal account is ready — here's your login.",
  });
}

/** Queue the welcome email. Caller decides what to do if this throws. */
export async function sendStudentWelcomeEmail(input: StudentWelcome): Promise<void> {
  await queueEmail({
    to: input.studentEmail,
    subject: "Welcome to Easyway — your account is ready",
    html: studentWelcomeHtml(input),
    type: "student_welcome",
    identity: "noreply",
  });
}
