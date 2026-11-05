import { queueEmail } from "@/lib/email-queue";
import { EMAIL_BRAND, absoluteUrl, emailShell, escapeHtml } from "@/lib/email-brand";
import { MAIL_IDENTITIES } from "@/lib/mail-identity";

/**
 * The login email every admin-side account gets — office staff (secretary,
 * accountant, support, growth, …) and partners (influencer/travel
 * agent/ambassador/other) alike, since both sign in at the same door,
 * /auth/admin. Tutors have their own version of this
 * (src/lib/tutor-welcome-email.ts) because they sign in somewhere else.
 */

export type AdminWelcome = {
  name: string;
  email: string;
  temporaryPassword: string;
  /** e.g. "Secretary", "Partner / Ambassador" — from ADMIN_ROLE_LABELS. */
  roleLabel: string;
};

const { ink: INK, muted: MUTED, orange: BRAND, line: LINE, font: FONT } = EMAIL_BRAND;

function absolute(link: string): string {
  return absoluteUrl(link, process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || "");
}

export function adminWelcomeHtml(input: AdminWelcome): string {
  const sender = MAIL_IDENTITIES.noreply;
  const firstName = input.name.trim().split(/\s+/)[0] || "there";
  const signIn = absolute("/auth/admin");
  const content = `
    <tr><td style="padding:26px 24px 8px;font-family:${FONT};">
      <h1 style="margin:0 0 12px;font:700 22px/28px ${FONT};color:${INK};">
        Welcome to Easyway, ${escapeHtml(firstName)}
      </h1>
      <p style="margin:0 0 14px;font-size:15px;line-height:24px;color:${INK};">
        An account was created for you as <strong>${escapeHtml(input.roleLabel)}</strong>. Use the login below to open
        your dashboard.
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
            Email: <strong>${escapeHtml(input.email)}</strong>
          </p>
          <p style="margin:0;font:400 14px/20px ${FONT};color:${INK};">
            Temporary password: <strong style="font-family:monospace;">${escapeHtml(input.temporaryPassword)}</strong>
          </p>
          <p style="margin:8px 0 0;font-size:12px;line-height:18px;color:${MUTED};">
            Please sign in and change this password as soon as possible.
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
        This account was created by Easyway staff. If you were not expecting it, contact the school office.
      </p>
    </td></tr>`;

  return emailShell({
    title: "Welcome to Easyway",
    senderName: sender.name,
    footer: sender.footer,
    content,
    preheader: "Your Easyway account is ready.",
  });
}

export async function sendAdminWelcomeEmail(input: AdminWelcome) {
  return queueEmail({
    to: input.email,
    subject: "Welcome to Easyway — your login",
    html: adminWelcomeHtml(input),
    type: "admin_welcome",
    identity: "noreply",
  });
}
