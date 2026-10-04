import { EMAIL_BRAND, absoluteUrl, emailShell, escapeHtml } from "@/lib/email-brand";

/**
 * "Here is where you stand" — the status notice for students whose portal is
 * locked.
 *
 * These are the students the next-level message deliberately skips, and they
 * are the ones who most need to hear from the school: they are not seeing their
 * classroom, and many of them do not know why or what unlocks it. This tells
 * them, plainly, in their own figures.
 *
 * Tone rules, because this goes to people who are already locked out:
 *   - facts from the ledger, never estimates (every ₦ figure is passed in);
 *   - what is wrong, what unlocks it, how — in that order, no scolding;
 *   - no invented deadline and no threat. The only date shown is one the system
 *     already holds (a balance-lock date), and only when it has one;
 *   - always a way to reach a human.
 *
 * Pure: no prisma. The server passes the numbers; this returns the words.
 */

export type LockedFacts = {
  firstName: string;
  level: string;
  /** deriveStudentAccess's lockReason — what the portal itself says. */
  reason: "unpaid_deposit" | "unsettled_balance" | "upcoming_batch" | string | null;
  /** Deposit still to pay before classes open. */
  depositOutstanding: number;
  requiredDeposit: number;
  /** Against the full fee — what a part-payer must clear. */
  balanceOutstanding: number;
  tuitionFee: number;
  totalPaid: number;
  /** ISO date the balance lock landed, if the system holds one. */
  lockAt: string | null;
};

export type LockedNotice = { title: string; message: string; emailBody: string; html: string };

export const LOCKED_KEY_PREFIX = "locked-notice:";

export function lockedNoticeKey(studentId: string, day: string): string {
  return `${LOCKED_KEY_PREFIX}${studentId}:${day}`;
}

export function parseLockedNoticeKey(key: string | null | undefined): { studentId: string; day: string } | null {
  if (!key || !key.startsWith(LOCKED_KEY_PREFIX)) return null;
  const [studentId, day] = key.slice(LOCKED_KEY_PREFIX.length).split(":");
  return studentId && /^\d{4}-\d{2}-\d{2}$/.test(day ?? "") ? { studentId, day } : null;
}

/** A locked student may be sent the notice again after this many days. */
export const LOCKED_AGAIN_AFTER_DAYS = 7;

export function lockedNoticeDue(noticedAt: string | null, now: Date = new Date()): "send" | "again" | "already" {
  if (!noticedAt) return "send";
  const at = Date.parse(noticedAt);
  if (Number.isNaN(at)) return "again";
  return now.getTime() - at >= LOCKED_AGAIN_AFTER_DAYS * 24 * 60 * 60 * 1000 ? "again" : "already";
}

const naira = (n: number) => `₦${Math.max(0, Math.round(n)).toLocaleString("en-NG")}`;

function datePhrase(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "Africa/Lagos" });
}

/** What is wrong, and what unlocks it — the two facts the whole message hangs on. */
export function lockedStatus(facts: LockedFacts): { headline: string; whatUnlocks: string } {
  if (facts.reason === "unsettled_balance") {
    const since = datePhrase(facts.lockAt);
    return {
      headline: `Your ${facts.level} portal is paused while a balance is open.`,
      whatUnlocks:
        facts.balanceOutstanding > 0
          ? `Your remaining balance is ${naira(facts.balanceOutstanding)}${since ? ` (the pause began ${since})` : ""}. Once it is paid, your classroom, materials and recordings open again straight away.`
          : "Once your balance is settled, your classroom, materials and recordings open again straight away.",
    };
  }
  if (facts.reason === "unpaid_deposit") {
    return {
      headline: `Your ${facts.level} classroom is waiting on your deposit.`,
      whatUnlocks:
        facts.depositOutstanding > 0
          ? `The deposit to start is ${naira(facts.requiredDeposit)}; ${naira(facts.depositOutstanding)} of it is still to pay${facts.totalPaid > 0 ? ` (you have paid ${naira(facts.totalPaid)} so far)` : ""}. Once it is in, your classroom opens straight away.`
          : "Once your deposit is confirmed, your classroom opens straight away.",
    };
  }
  return {
    headline: `Your ${facts.level} portal is currently locked.`,
    whatUnlocks: "Open your Payments page to see exactly what is outstanding. Once it is settled, everything opens again straight away.",
  };
}

export function buildLockedNotice(facts: LockedFacts): LockedNotice {
  const { headline, whatUnlocks } = lockedStatus(facts);
  const hi = facts.firstName ? `${facts.firstName}, ` : "";
  const title = `${hi}an update on your EasyWay portal`;
  const message = `${headline} ${whatUnlocks}`;
  const url = absoluteUrl("/payments", process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || "");
  const { ink, muted, orange, teal, font, line } = EMAIL_BRAND;

  const html = emailShell({
    title,
    senderName: "EasyWay German School",
    footer:
      "Reply to this email and a real person at the school will answer. If you have already paid, please reply with your receipt and we will sort it out the same day.",
    preheader: message.slice(0, 120),
    content: `
    <tr><td style="padding:26px 24px 6px;font-family:${font};">
      <p style="margin:0 0 6px;font-size:14px;color:${muted};">${facts.firstName ? `Hallo ${escapeHtml(facts.firstName)},` : "Hallo,"}</p>
      <h1 style="margin:0 0 12px;font-size:20px;line-height:27px;color:${ink};font-weight:800;">An update on where you stand</h1>
      <p style="margin:0 0 14px;font-size:15px;line-height:24px;color:${ink};">We want you back in class, so here is your status in plain words.</p>
    </td></tr>
    <tr><td style="padding:0 24px 14px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${line};border-radius:12px;">
        <tr><td style="padding:14px 16px;font-family:${font};">
          <div style="font-size:11px;font-weight:800;color:${orange};text-transform:uppercase;letter-spacing:1px;">Your status</div>
          <div style="margin-top:4px;font-size:15px;font-weight:700;color:${ink};">${escapeHtml(headline)}</div>
          <div style="margin-top:10px;font-size:11px;font-weight:800;color:${teal};text-transform:uppercase;letter-spacing:1px;">What opens it again</div>
          <div style="margin-top:4px;font-size:14px;line-height:22px;color:${ink};">${escapeHtml(whatUnlocks)}</div>
        </td></tr>
      </table>
    </td></tr>
    <tr><td style="padding:4px 24px 8px;font-family:${font};font-size:14px;line-height:22px;color:${ink};">
      Your results and certificates stay open to you whatever your status is, and once you are back in class, your next-level plan will be waiting.
    </td></tr>
    <tr><td style="padding:10px 24px 28px;font-family:${font};">
      <a href="${escapeHtml(url)}" style="display:inline-block;background:${orange};color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:14px 26px;border-radius:10px;">See my payments</a>
    </td></tr>`,
  });

  const emailBody = [
    headline,
    whatUnlocks,
    "Your results and certificates stay open to you whatever your status is.",
    `See your payments: ${url}`,
    "Reply to this email and a real person at the school will answer.",
  ].join("\n\n");

  return { title, message, emailBody, html };
}
