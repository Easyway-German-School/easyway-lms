import { queueEmail } from "@/lib/email-queue";
import { EMAIL_BRAND, absoluteUrl, escapeHtml } from "@/lib/email-brand";
import { MAIL_IDENTITIES } from "@/lib/mail-identity";

/**
 * The proof-of-enrolment letter, emailed automatically on a student's first
 * tuition payment (full or part) — never at registration. See
 * `lib/enrolment-letter-trigger.ts` for the check that decides WHEN this
 * fires, and `lib/enrolment-letter-pdf.ts` for the
 * downloadable A4 document it points at.
 *
 * DELIBERATELY NOT `emailShell` from email-brand.ts. Every other transactional
 * email in this codebase is a receipt or a nudge — a plain teal masthead reads
 * fine for those. This one is handed to a visa office or an employer, so it is
 * built to look like a letter on the school's own paper: a real letterhead
 * with the logo image (not just the wordmark spelled out in text, which is
 * what every other email does), a formal salutation, and a closing signature
 * block — the same register as the PDF it links to, not the receipt tone of
 * `registration-email.ts`.
 */

const { ink: INK, muted: MUTED, teal: TEAL, orange: ACCENT, line: LINE, font: FONT, canvas: CANVAS, paper: PAPER } = EMAIL_BRAND;

export type EnrolmentLetterNotice = {
  studentName: string;
  studentEmail: string;
  studentCode: string | null;
  level: string;
  pathway: string;
  branchName: string | null;
  deliveryMode: string | null;
  enrolledAt: Date;
  schoolName?: string | null;
  /** Fully paid, or a part-payment so far — only changes the wording. Defaults to part-paid, the safer claim. */
  tuitionSettled?: boolean;
};

function absolute(link: string): string {
  return absoluteUrl(link, process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || "");
}

function logoUrl(): string {
  return absolute("/logo.png");
}

function factRow(label: string, value: string): string {
  return `
    <tr>
      <td style="padding:7px 16px 7px 0;font:400 12px/18px ${FONT};color:${MUTED};white-space:nowrap;">${escapeHtml(label)}</td>
      <td style="padding:7px 0;font:700 13px/18px ${FONT};color:${INK};">${escapeHtml(value)}</td>
    </tr>`;
}

function deliveryLabel(mode: string | null): string {
  if (mode === "online") return "Online";
  if (mode === "hybrid") return "Campus + online";
  return "On campus";
}

export function enrolmentLetterEmailHtml(input: EnrolmentLetterNotice): string {
  const who = MAIL_IDENTITIES.noreply;
  const schoolName = input.schoolName || "Easyway Language School";
  const firstName = input.studentName.trim().split(/\s+/)[0] || "there";
  const signIn = absolute("/auth/signin");
  const issued = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const enrolledSince = input.enrolledAt.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Your Easyway enrolment letter</title></head>
<body style="margin:0;padding:0;background:${CANVAS};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">
  ${input.tuitionSettled ? "Tuition is settled" : "Your tuition payment is in"} — your official enrolment letter is ready to view and print.
</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CANVAS};padding:24px 12px;">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:${PAPER};border:1px solid ${LINE};border-radius:14px;overflow:hidden;">

    <!-- Letterhead: the actual logo, not a text wordmark — every other email
         in this codebase settles for text because emailShell() is shared
         across seven templates and a shared shell can't assume the logo file
         exists. This one is bespoke, so it can. -->
    <tr><td style="padding:28px 32px 20px;text-align:center;border-bottom:3px solid ${ACCENT};">
      <img src="${logoUrl()}" alt="${escapeHtml(schoolName)}" height="40" style="height:40px;width:auto;display:inline-block;" />
      <p style="margin:10px 0 0;font:700 11px/1 ${FONT};color:${TEAL};letter-spacing:2px;text-transform:uppercase;">
        Certificate of Enrolment
      </p>
    </td></tr>

    <tr><td style="padding:28px 32px 0;font-family:${FONT};">
      <p style="margin:0 0 18px;font-size:12px;line-height:18px;color:${MUTED};text-align:right;">${escapeHtml(issued)}</p>
      <p style="margin:0 0 18px;font-size:15px;line-height:24px;color:${INK};">Dear ${escapeHtml(firstName)},</p>
      <p style="margin:0 0 16px;font-size:15px;line-height:24px;color:${INK};">
        ${input.tuitionSettled ? "Your tuition is now fully settled and your" : "We have received your tuition payment and your"} enrolment at ${escapeHtml(schoolName)} is confirmed. This
        letter is your official record of that — keep it for a visa application, an embassy, an employer, or
        wherever proof of enrolment is asked for.
      </p>
    </td></tr>

    <tr><td style="padding:0 32px 20px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="border:1px solid ${LINE};border-left:4px solid ${ACCENT};border-radius:10px;">
        <tr><td style="padding:16px 18px;font-family:${FONT};">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${factRow("Name", input.studentName)}
            ${input.studentCode ? factRow("Student ID", input.studentCode) : ""}
            ${factRow("Programme", input.pathway)}
            ${factRow("Level", input.level)}
            ${factRow("Branch", input.branchName ?? "Not selected")}
            ${factRow("Attending", deliveryLabel(input.deliveryMode))}
            ${factRow("Enrolled since", enrolledSince)}
            ${factRow("Tuition status", input.tuitionSettled ? "Fully settled" : "Payment received")}
          </table>
        </td></tr>
      </table>
    </td></tr>

    <tr><td style="padding:0 32px 24px;font-family:${FONT};">
      <p style="margin:0 0 20px;font-size:13px;line-height:22px;color:${MUTED};">
        A signed, printable PDF of this letter — the version an office will want — is waiting in your portal.
      </p>
      <a href="${signIn}"
         style="background:${ACCENT};color:#ffffff;padding:12px 26px;text-decoration:none;border-radius:8px;display:inline-block;font:700 14px/20px ${FONT};">
        Sign in to download &amp; print
      </a>
      <p style="margin:14px 0 0;font-size:12px;line-height:18px;color:${MUTED};">
        Once signed in, open Payments → "Download proof-of-enrolment letter".
      </p>
    </td></tr>

    <tr><td style="padding:22px 32px 8px;border-top:1px solid ${LINE};font-family:${FONT};">
      <p style="margin:0 0 2px;font-size:13px;line-height:20px;color:${INK};">Yours sincerely,</p>
      <p style="margin:0;font:700 13px/20px ${FONT};color:${INK};">Admissions Office</p>
      <p style="margin:0;font-size:13px;line-height:20px;color:${MUTED};">${escapeHtml(schoolName)}</p>
    </td></tr>

    <tr><td style="padding:16px 32px 20px;font-family:${FONT};">
      <p style="margin:0;font-size:11px;line-height:17px;color:${MUTED};">
        ${escapeHtml(who.footer)}
      </p>
    </td></tr>

  </table>
</td></tr>
</table>
</body></html>`;
}

/**
 * Queue the enrolment letter. Called only after tuition is confirmed settled —
 * see `notifyEnrolmentLetterIfSettled` for the gate and the once-only claim.
 * Swallows its own errors: the payment that triggered this has already been
 * recorded, and a mail provider hiccup must not turn into a 500 on a webhook
 * that a gateway will otherwise retry as a duplicate charge event.
 */
export async function sendEnrolmentLetterEmail(input: EnrolmentLetterNotice): Promise<void> {
  try {
    await queueEmail({
      to: input.studentEmail,
      subject: "Your Easyway enrolment letter",
      html: enrolmentLetterEmailHtml(input),
      type: "enrolment_letter",
      identity: "noreply",
    });
  } catch (error) {
    console.error("Could not queue enrolment letter email:", error);
  }
}
