import { EMAIL_BRAND, absoluteUrl, emailShell, escapeHtml } from "@/lib/email-brand";
import { MAIL_IDENTITIES } from "@/lib/mail-identity";

/**
 * The letter a school's owner gets when an operator sets them up on the
 * platform. Their account exists but has no password yet — this carries the
 * one-time link that lets them choose one and sign in.
 *
 * Deliberately does not name EduPrime: to the recipient this is their own
 * school's portal, and the invite should read as coming from the school, not
 * from the company that hosts it.
 */

const { ink: INK, muted: MUTED, orange: BRAND, line: LINE, font: FONT } = EMAIL_BRAND;

export function tenantOwnerInviteHtml(input: {
  name: string;
  schoolName: string;
  setupUrl: string;
}): string {
  const who = MAIL_IDENTITIES.support;
  const firstName = input.name.trim().split(/\s+/)[0] || "there";
  const url = absoluteUrl(input.setupUrl, process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || "");

  const content = `
    <tr><td style="padding:26px 24px 8px;font-family:${FONT};">
      <h1 style="margin:0 0 12px;font:700 22px/28px ${FONT};color:${INK};">
        Welcome, ${escapeHtml(firstName)}
      </h1>
      <p style="margin:0 0 14px;font-size:15px;line-height:24px;color:${INK};">
        Your administrator account for <strong>${escapeHtml(input.schoolName)}</strong> has been created.
        You have full control of the school &mdash; students, tutors, classes, fees and settings.
      </p>
      <p style="margin:0 0 14px;font-size:15px;line-height:24px;color:${INK};">
        To get in, set your password using the link below. It works once and expires in an hour;
        if it lapses, use &ldquo;Forgot password&rdquo; on the sign-in page.
      </p>
    </td></tr>

    <tr><td style="padding:4px 24px 24px;">
      <a href="${escapeHtml(url)}"
         style="display:inline-block;padding:12px 22px;border-radius:10px;background:${BRAND};
                color:#ffffff;font:700 14px/1 ${FONT};text-decoration:none;">
        Set your password
      </a>
      <p style="margin:14px 0 0;font-size:12px;line-height:18px;color:${MUTED};word-break:break-all;">
        Or paste this into your browser:<br />${escapeHtml(url)}
      </p>
    </td></tr>

    <tr><td style="padding:0 24px 26px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="border:1px solid ${LINE};border-left:4px solid ${BRAND};border-radius:10px;">
        <tr><td style="padding:14px 18px;font-family:${FONT};">
          <p style="margin:0 0 4px;font-size:12px;letter-spacing:.6px;text-transform:uppercase;color:${MUTED};">
            First steps
          </p>
          <p style="margin:0;font-size:14px;line-height:22px;color:${INK};">
            Add your branches, invite your tutors, then import or register your students.
            Everything is under the sidebar once you sign in.
          </p>
        </td></tr>
      </table>
    </td></tr>
  `;

  return emailShell({
    title: `Your ${input.schoolName} administrator account`,
    senderName: who.name,
    preheader: `Set your password and sign in to ${input.schoolName}.`,
    footer: `You are receiving this because an administrator account was created for you at ${escapeHtml(
      input.schoolName,
    )}. If you were not expecting this, you can ignore this email.`,
    content,
  });
}
