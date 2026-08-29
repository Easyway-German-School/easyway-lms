import { queueEmail } from "@/lib/email-queue";
import { EMAIL_BRAND, absoluteUrl, emailShell, escapeHtml } from "@/lib/email-brand";
import { MAIL_IDENTITIES } from "@/lib/mail-identity";

/**
 * The letter a parent gets when their login is created automatically, as a
 * side effect of their child completing the main signup form.
 *
 * The parent never chose a password in that flow — there was no field for
 * one — so this is the only place they ever see it. Framed as a first
 * password to change rather than a secret to keep: a generated string mailed
 * in plain text is not something anyone should go on using.
 */

const { ink: INK, muted: MUTED, orange: BRAND, line: LINE, font: FONT } = EMAIL_BRAND;

export type ParentAccountCreated = {
  parentName: string;
  parentEmail: string;
  temporaryPassword: string;
  studentName: string;
};

function absolute(link: string): string {
  return absoluteUrl(link, process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || "");
}

export function parentAccountCreatedHtml(input: ParentAccountCreated): string {
  const who = MAIL_IDENTITIES.noreply;
  const firstName = input.parentName.trim().split(/\s+/)[0] || "there";
  const signIn = absolute("/auth/parent/signin");

  const content = `
    <tr><td style="padding:26px 24px 8px;font-family:${FONT};">
      <h1 style="margin:0 0 12px;font:700 22px/28px ${FONT};color:${INK};">
        A parent account was set up for you, ${escapeHtml(firstName)}
      </h1>
      <p style="margin:0 0 14px;font-size:15px;line-height:24px;color:${INK};">
        ${escapeHtml(input.studentName)} named you as a parent/guardian while registering, so we created your own
        login — separate from theirs. The school will confirm the link to their record before anything shows in it.
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
            Email: <strong>${escapeHtml(input.parentEmail)}</strong>
          </p>
          <p style="margin:0;font:400 14px/20px ${FONT};color:${INK};">
            Temporary password: <strong style="font-family:monospace;">${escapeHtml(input.temporaryPassword)}</strong>
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
        Sign in to your parent portal
      </a>
      <p style="margin:14px 0 0;font-size:12px;line-height:18px;color:${MUTED};">
        If the button does not work, open ${escapeHtml(signIn)}
      </p>
    </td></tr>

    <tr><td style="padding:0 24px 24px;font-family:${FONT};">
      <p style="margin:0;font-size:12px;line-height:18px;color:${MUTED};">
        If you did not expect this, someone may have entered your email by mistake — reply to the office and we will
        remove this account. Nothing has been charged and no data is shared until the school confirms the link.
      </p>
    </td></tr>`;

  return emailShell({
    title: "Your Easyway parent account",
    senderName: who.name,
    footer: who.footer,
    content,
    preheader: `A parent login was created for ${input.studentName}'s account.`,
  });
}

/**
 * Queue the credentials email. Swallows its own errors, same reasoning as
 * `sendRegistrationConfirmation`: the account already exists by the time
 * this runs, and losing the courtesy email must not look like a failed
 * signup to the student who is still on the confirmation screen.
 */
export async function sendParentAccountCreatedEmail(input: ParentAccountCreated): Promise<void> {
  try {
    await queueEmail({
      to: input.parentEmail,
      subject: `Your Easyway parent account for ${input.studentName}`,
      html: parentAccountCreatedHtml(input),
      type: "parent_account_created",
      identity: "noreply",
    });
  } catch (error) {
    console.error("Could not queue parent account email:", error);
  }
}
