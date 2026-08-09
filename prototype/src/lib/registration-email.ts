import { queueEmail } from "@/lib/email-queue";
import { EMAIL_BRAND, absoluteUrl, emailShell, escapeHtml } from "@/lib/email-brand";
import { MAIL_IDENTITIES } from "@/lib/mail-identity";

/**
 * The letter a student gets for registering.
 *
 * WHY THIS FILE EXISTS. It did not, and that is the whole bug. `/api/auth/signup`
 * created the account, issued the student code, closed the matching lead and
 * emailed the OFFICE — and said nothing whatsoever to the person who had just
 * handed over their name, their photo and a password. The only student-facing
 * "welcome" in the codebase is `/api/emails/send/welcome`, which an admin fires
 * by hand after a payment clears. So between registering and paying, a new
 * student received precisely nothing, and had no written record of the student
 * code they are asked to quote at the desk.
 *
 * It is deliberately NOT called a welcome email. Welcome is the post-payment
 * message and it already exists; this one confirms receipt and tells someone
 * what happens next, which is a different letter with a different job. Sending
 * "welcome, you're enrolled" to somebody who has not paid a kobo is how a
 * school ends up arguing about what was promised.
 *
 * Queued rather than sent inline for the same reason the office alert is: a
 * slow mail provider must not hold open the response that tells a student
 * their account was created.
 */

const { ink: INK, muted: MUTED, orange: BRAND, line: LINE, font: FONT } = EMAIL_BRAND;

export type RegistrationConfirmation = {
  studentName: string;
  studentEmail: string;
  studentCode: string | null;
  level: string;
  sessionSlot: string;
  pathway: string;
  branchName: string | null;
  classType: string;
  deliveryMode: string;
};

function absolute(link: string): string {
  return absoluteUrl(link, process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || "");
}

function detailRow(label: string, value: string): string {
  return `
    <tr>
      <td style="padding:8px 16px 8px 0;font:400 13px/18px ${FONT};color:${MUTED};white-space:nowrap;">${escapeHtml(label)}</td>
      <td style="padding:8px 0;font:700 14px/20px ${FONT};color:${INK};">${escapeHtml(value)}</td>
    </tr>`;
}

function sessionLabel(slot: string): string {
  const map: Record<string, string> = {
    morning: "Morning",
    afternoon: "Afternoon",
    evening: "Evening",
  };
  return map[slot] ?? slot;
}

export function registrationConfirmationHtml(input: RegistrationConfirmation): string {
  const who = MAIL_IDENTITIES.noreply;
  const firstName = input.studentName.trim().split(/\s+/)[0] || "there";
  const signIn = absolute("/auth/signin");

  /**
   * The student code is the one thing in here that is worth keeping, so it gets
   * its own panel rather than a table row. It is what the office asks for on
   * the phone and what a receipt is filed under; buried in a list of eight
   * fields it is a line nobody can find again six weeks later.
   *
   * A missing code is stated plainly instead of being hidden. `assignStudentCode`
   * is allowed to fail without costing someone their account — the backfill
   * script repairs it later — and a student who was told nothing would simply
   * assume the school lost their registration.
   */
  const codePanel = input.studentCode
    ? `
      <tr><td style="padding:0 24px 20px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
               style="border:1px solid ${LINE};border-left:4px solid ${BRAND};border-radius:10px;">
          <tr><td style="padding:14px 18px;font-family:${FONT};">
            <p style="margin:0 0 4px;font-size:12px;letter-spacing:.6px;text-transform:uppercase;color:${MUTED};">
              Your student ID
            </p>
            <p style="margin:0;font:700 20px/26px ${FONT};color:${INK};letter-spacing:.5px;">
              ${escapeHtml(input.studentCode)}
            </p>
            <p style="margin:6px 0 0;font-size:12px;line-height:18px;color:${MUTED};">
              Quote this whenever you contact the office or make a payment.
            </p>
          </td></tr>
        </table>
      </td></tr>`
    : `
      <tr><td style="padding:0 24px 20px;font-family:${FONT};">
        <p style="margin:0;font-size:13px;line-height:20px;color:${MUTED};">
          Your student ID is still being issued. The office will send it to you shortly.
        </p>
      </td></tr>`;

  const content = `
    <tr><td style="padding:26px 24px 8px;font-family:${FONT};">
      <h1 style="margin:0 0 12px;font:700 22px/28px ${FONT};color:${INK};">
        We have your registration, ${escapeHtml(firstName)}
      </h1>
      <p style="margin:0 0 14px;font-size:15px;line-height:24px;color:${INK};">
        Your account has been created and your place is recorded. Here is exactly what we
        have on file — if any of it is wrong, reply to the office and we will correct it
        before your class starts.
      </p>
    </td></tr>

    ${codePanel}

    <tr><td style="padding:0 24px 20px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="border-top:1px solid ${LINE};">
        ${detailRow("Name", input.studentName)}
        ${detailRow("Email", input.studentEmail)}
        ${detailRow("Level", input.level)}
        ${detailRow("Session", sessionLabel(input.sessionSlot))}
        ${detailRow("Class", input.classType === "private" ? "Private (one-to-one)" : "Group")}
        ${detailRow("Pathway", input.pathway)}
        ${detailRow("Branch", input.branchName ?? "Not selected")}
        ${detailRow(
          "Attending",
          input.deliveryMode === "online"
            ? "Online"
            : input.deliveryMode === "hybrid"
              ? "Campus + online"
              : "On campus",
        )}
      </table>
    </td></tr>

    <tr><td style="padding:0 24px 22px;font-family:${FONT};">
      <p style="margin:0 0 10px;font:700 14px/20px ${FONT};color:${INK};">What happens next</p>
      <p style="margin:0 0 8px;font-size:14px;line-height:22px;color:${INK};">
        <strong>1.</strong> Sign in with this email address and the password you chose.
      </p>
      <p style="margin:0 0 8px;font-size:14px;line-height:22px;color:${INK};">
        <strong>2.</strong> Settle your tuition — most of the portal stays locked until a
        payment lands, so this is the step that opens your materials, your timetable and
        your class.
      </p>
      <p style="margin:0;font-size:14px;line-height:22px;color:${INK};">
        <strong>3.</strong> The office will confirm your start date and your tutor.
      </p>
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
        If you did not register with Easyway, ignore this email and nothing further happens —
        no payment is owed and no class is booked in your name.
      </p>
    </td></tr>`;

  return emailShell({
    title: "Your Easyway registration",
    senderName: who.name,
    footer: who.footer,
    content,
    preheader: input.studentCode
      ? `Registration received — your student ID is ${input.studentCode}.`
      : "Registration received. Here is what happens next.",
  });
}

/**
 * Queue the confirmation. Swallows its own errors on purpose: the account
 * already exists by the time this runs, and failing the signup response over an
 * undeliverable courtesy would lose the student an account they can no longer
 * re-create — the email is taken by then, so a retry hits "Email already
 * registered" and looks, to them, like the school is broken.
 */
export async function sendRegistrationConfirmation(
  input: RegistrationConfirmation,
): Promise<void> {
  try {
    await queueEmail({
      to: input.studentEmail,
      subject: input.studentCode
        ? `Registration received — your student ID is ${input.studentCode}`
        : "Your Easyway registration has been received",
      html: registrationConfirmationHtml(input),
      type: "student_registration_confirmation",
      // Transactional, so it goes out as the automated address and carries no
      // unsubscribe footer: this is the receipt for an action they just took,
      // not marketing, and it must reach someone who has opted out of the rest.
      identity: "noreply",
    });
  } catch (error) {
    console.error("Could not queue registration confirmation:", error);
  }
}
