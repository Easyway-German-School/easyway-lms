import { prisma } from "@/lib/prisma";
import { queueEmail } from "@/lib/email-queue";
import { EMAIL_BRAND, absoluteUrl, escapeHtml } from "@/lib/email-brand";
import { MAIL_IDENTITIES } from "@/lib/mail-identity";
import { amountInWords } from "@/lib/pdf-brand";
import { balanceAfterPayment, isReceivedPayment, isRegistrationFeePayment, tuitionFeeFor } from "@/lib/payment";

/**
 * The receipt a student gets by email the moment a payment lands.
 *
 * WHY THIS EXISTS. Every gateway path used to answer a payment with a bare
 * `<p>Hello … Thank you, Easyway LMS</p>` — no amount, no date, no balance, no
 * receipt number — and a payment the office recorded by hand (a bank transfer
 * or cash at the desk, which is how a lot of tuition arrives) sent nothing at
 * all. The only receipt was a PDF buried under Payments. So the email is now
 * the receipt itself — an invoice-style card with the figures inline, in the
 * school's own letterhead — and the PDF is the keep-for-later copy, one tap
 * away in the portal. Nothing is attached: the mail queue carries no
 * attachments, and the card already says everything the PDF does.
 *
 * Same look and register as `enrolment-letter-email.ts` (bespoke letterhead
 * with the logo image, not the shared teal `emailShell`), because both are
 * documents a student may forward to a parent or an office.
 */

const { ink: INK, muted: MUTED, teal: TEAL, orange: ACCENT, line: LINE, font: FONT, canvas: CANVAS, paper: PAPER } = EMAIL_BRAND;
const NAVY = "#28357A";
const GREEN = "#157F46";

export type PaymentReceiptEmail = {
  receiptNo: string;
  studentName: string;
  studentEmail: string;
  studentCode: string | null;
  amount: number;
  currency: string;
  method: string;
  description: string;
  paidAt: Date;
  /** Tuition balance after this payment; null for a registration fee or when not tracked. */
  balanceAfter: number | null;
  /** The level's tuition fee, for the progress bar. 0 hides the bar. */
  tuitionFee: number;
  schoolName?: string | null;
};

function absolute(link: string): string {
  return absoluteUrl(link, process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || "");
}

function money(amount: number, currency: string): string {
  const digits = amount.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency.toUpperCase() === "NGN" ? `₦${digits}` : `${currency.toUpperCase()} ${digits}`;
}

function methodLabel(method: string): string {
  const spaced = method.replace(/[_-]+/g, " ").trim();
  return spaced ? `${spaced.charAt(0).toUpperCase()}${spaced.slice(1).toLowerCase()}` : "—";
}

function factRow(label: string, value: string): string {
  return `
    <tr>
      <td style="padding:8px 16px 8px 0;font:400 12px/18px ${FONT};color:${MUTED};white-space:nowrap;vertical-align:top;border-bottom:1px solid ${LINE};">${escapeHtml(label)}</td>
      <td style="padding:8px 0;font:700 13px/18px ${FONT};color:${INK};text-align:right;border-bottom:1px solid ${LINE};">${escapeHtml(value)}</td>
    </tr>`;
}

export function paymentReceiptEmailHtml(input: PaymentReceiptEmail): string {
  const who = MAIL_IDENTITIES.noreply;
  const schoolName = input.schoolName || "Easyway Language School";
  const firstName = input.studentName.trim().split(/\s+/)[0] || "there";
  const currency = (input.currency || "NGN").toUpperCase();
  const date = input.paidAt.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const hasBalance = typeof input.balanceAfter === "number";
  const settled = hasBalance && (input.balanceAfter as number) <= 0;
  const partial = hasBalance && !settled;
  const isRegistration = isRegistrationFeePayment(input.description);
  const paidSoFar = hasBalance && input.tuitionFee > 0 ? Math.max(0, input.tuitionFee - (input.balanceAfter as number)) : 0;
  const pct = input.tuitionFee > 0 ? Math.max(4, Math.min(100, Math.round((paidSoFar / input.tuitionFee) * 100))) : 0;
  const payments = absolute("/payments");

  const badge = settled ? { text: "PAID IN FULL", color: GREEN } : partial ? { text: "PART PAYMENT", color: ACCENT } : { text: "PAYMENT RECEIVED", color: NAVY };

  const intro = isRegistration
    ? "Your registration fee has been received. Here is your official receipt."
    : settled
      ? "Your tuition is now fully paid — thank you. Here is your official receipt."
      : "Your payment has been received — thank you. Here is your official receipt.";

  const progress =
    partial && pct > 0
      ? `
    <tr><td style="padding:14px 0 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f8;border-radius:6px;">
        <tr><td width="${pct}%" style="background:${ACCENT};height:8px;border-radius:6px;font-size:0;line-height:0;">&nbsp;</td><td style="font-size:0;line-height:0;">&nbsp;</td></tr>
      </table>
      <p style="margin:6px 0 0;font:400 11px/16px ${FONT};color:${MUTED};">${escapeHtml(money(paidSoFar, currency))} of ${escapeHtml(money(input.tuitionFee, currency))} paid so far</p>
    </td></tr>`
      : "";

  const balanceBlock = hasBalance
    ? `
    <tr><td style="padding:14px 0 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="font:700 11px/16px ${FONT};color:${MUTED};letter-spacing:1px;text-transform:uppercase;">${settled ? "Balance" : "Balance remaining"}</td>
          <td style="font:700 16px/20px ${FONT};color:${settled ? GREEN : NAVY};text-align:right;">${escapeHtml(money(input.balanceAfter as number, currency))}</td>
        </tr>
      </table>
    </td></tr>${progress}`
    : "";

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Your Easyway receipt</title></head>
<body style="margin:0;padding:0;background:${CANVAS};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">
  ${escapeHtml(money(input.amount, currency))} received — receipt No. ${escapeHtml(input.receiptNo)}.
</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CANVAS};padding:24px 12px;">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:${PAPER};border:1px solid ${LINE};border-radius:14px;overflow:hidden;">

    <tr><td style="padding:26px 32px 18px;text-align:center;border-bottom:3px solid ${ACCENT};">
      <img src="${absolute("/logo.png")}" alt="${escapeHtml(schoolName)}" height="40" style="height:40px;width:auto;display:inline-block;" />
      <p style="margin:10px 0 0;font:700 11px/1 ${FONT};color:${TEAL};letter-spacing:2px;text-transform:uppercase;">Official Receipt</p>
    </td></tr>

    <tr><td style="padding:26px 32px 0;font-family:${FONT};">
      <p style="margin:0 0 14px;font-size:15px;line-height:24px;color:${INK};">Dear ${escapeHtml(firstName)},</p>
      <p style="margin:0 0 20px;font-size:15px;line-height:24px;color:${INK};">${escapeHtml(intro)}</p>
    </td></tr>

    <!-- The invoice card: figures inline so the email IS the receipt. -->
    <tr><td style="padding:0 32px 8px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="border:1px solid ${LINE};border-top:4px solid ${NAVY};border-radius:10px;">
        <tr><td style="padding:18px 20px 6px;font-family:${FONT};">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="font:700 11px/16px ${FONT};color:${MUTED};letter-spacing:1px;text-transform:uppercase;">Receipt No.<br /><span style="font:700 15px/22px ${FONT};color:${NAVY};letter-spacing:0;">${escapeHtml(input.receiptNo)}</span></td>
              <td style="text-align:right;vertical-align:top;"><span style="display:inline-block;border:2px solid ${badge.color};color:${badge.color};font:700 11px/1 ${FONT};letter-spacing:1.5px;padding:6px 10px;border-radius:4px;">${badge.text}</span></td>
            </tr>
          </table>
        </td></tr>

        <tr><td style="padding:10px 20px 2px;font-family:${FONT};">
          <p style="margin:0;font:700 11px/16px ${FONT};color:${MUTED};letter-spacing:1px;text-transform:uppercase;">Amount received</p>
          <p style="margin:2px 0 0;font:700 32px/40px ${FONT};color:${ACCENT};">${escapeHtml(money(input.amount, currency))}</p>
          <p style="margin:2px 0 0;font:italic 400 12px/18px ${FONT};color:${MUTED};">${escapeHtml(amountInWords(input.amount, currency))}</p>
        </td></tr>

        <tr><td style="padding:14px 20px 4px;font-family:${FONT};">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${factRow("Received from", input.studentName)}
            ${input.studentCode ? factRow("Student ID", input.studentCode) : ""}
            ${factRow("Payment for", input.description)}
            ${factRow("Method", methodLabel(input.method))}
            ${factRow("Date", date)}
          </table>
        </td></tr>

        <tr><td style="padding:0 20px 18px;font-family:${FONT};">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${balanceBlock}</table>
        </td></tr>
      </table>
    </td></tr>

    <tr><td style="padding:16px 32px 24px;font-family:${FONT};">
      <p style="margin:0 0 18px;font-size:13px;line-height:22px;color:${MUTED};">
        Want a copy to keep? A printable PDF of this receipt — with the school's stamp and signature — is saved in your portal, for whenever you need it.
      </p>
      <a href="${payments}"
         style="background:${ACCENT};color:#ffffff;padding:12px 26px;text-decoration:none;border-radius:8px;display:inline-block;font:700 14px/20px ${FONT};">
        View payments &amp; download PDF
      </a>
      <p style="margin:14px 0 0;font-size:12px;line-height:18px;color:${MUTED};">
        Sign in, open Payments, and tap &ldquo;Receipt&rdquo; beside this payment.
      </p>
    </td></tr>

    <tr><td style="padding:16px 32px 6px;border-top:1px solid ${LINE};font-family:${FONT};">
      <p style="margin:0 0 2px;font-size:13px;line-height:20px;color:${INK};">Thanks for your patronage,</p>
      <p style="margin:0;font:700 13px/20px ${FONT};color:${NAVY};">${escapeHtml(schoolName)}</p>
    </td></tr>

    <tr><td style="padding:12px 32px 20px;font-family:${FONT};">
      <p style="margin:0 0 6px;font-size:11px;line-height:17px;color:${MUTED};">
        This receipt confirms the payment above was received. It is not a tax invoice.
      </p>
      <p style="margin:0;font-size:11px;line-height:17px;color:${MUTED};">${escapeHtml(who.footer)}</p>
    </td></tr>

  </table>
</td></tr>
</table>
</body></html>`;
}

/**
 * Queue the receipt for one recorded payment.
 *
 * Idempotent per payment: a gateway delivers the same event twice, and the
 * Paystack webhook and the browser-side verify both record the same charge, so
 * the queue row is keyed on the payment id (`campaignId`, an ungrouped string
 * column — no migration) and a second call finds it and does nothing.
 *
 * Deliberately unable to throw, for the reason `notifyEnrolmentLetterIfSettled`
 * is: it runs inside payment webhooks a gateway retries on a non-2xx, and a
 * mail hiccup must never make a recorded payment look like it failed.
 */
export async function sendPaymentReceiptEmail(paymentId: string): Promise<void> {
  try {
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      select: {
        id: true,
        studentId: true,
        amount: true,
        currency: true,
        status: true,
        method: true,
        description: true,
        createdAt: true,
        student: {
          select: {
            studentCode: true,
            level: true,
            classType: true,
            pathway: true,
            branch: { select: { name: true } },
            user: { select: { name: true, email: true, tenant: { select: { brandName: true } } } },
            payments: { orderBy: { createdAt: "asc" }, select: { amount: true, status: true, description: true, createdAt: true } },
          },
        },
      },
    });
    if (!payment?.student?.user?.email || !isReceivedPayment(payment.status)) return;

    const key = `receipt:${payment.id}`;
    const already = await prisma.emailMessage.findFirst({ where: { type: "payment_receipt", campaignId: key }, select: { id: true } });
    if (already) return;

    const { student } = payment;
    const tuitionFee = tuitionFeeFor({
      level: student.level,
      branch: student.branch?.name ?? null,
      classType: student.classType,
      pathway: student.pathway,
    });
    const balanceAfter = balanceAfterPayment(student.payments, payment, tuitionFee);

    await queueEmail({
      to: student.user.email,
      subject: balanceAfter === 0 ? "Your Easyway receipt — tuition paid in full" : "Your Easyway receipt",
      html: paymentReceiptEmailHtml({
        receiptNo: payment.id.slice(-10).toUpperCase(),
        studentName: student.user.name ?? "Student",
        studentEmail: student.user.email,
        studentCode: student.studentCode,
        amount: payment.amount,
        currency: payment.currency,
        method: payment.method,
        description: payment.description || "Tuition payment",
        paidAt: payment.createdAt,
        balanceAfter,
        tuitionFee,
        schoolName: student.user.tenant?.brandName ?? undefined,
      }),
      type: "payment_receipt",
      studentId: payment.studentId,
      campaignId: key,
      identity: "noreply",
    });
  } catch (error) {
    console.error("sendPaymentReceiptEmail failed:", { paymentId, error });
  }
}
