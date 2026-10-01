import { EMAIL_BRAND, absoluteUrl, emailShell, escapeHtml } from "@/lib/email-brand";
import { naira } from "@/lib/level-advance";
import type { JourneyPayload } from "@/lib/next-level-journey-server";

/**
 * The message the office sends — written once, here, so nobody types it again.
 *
 * The same words reach a student three ways at the same moment: the Becca pop
 * (NextLevelMoment), the bell + push, and this email. Everything personal in it
 * (their numbers, their plan, their opening day) comes from their own journey,
 * so two students never get the same email and nobody on the staff writes a
 * word.
 *
 * Pure: no prisma, no fetch. The server hands it a journey; it hands back text.
 */

export type Invite = {
  /** Bell / push / email subject. */
  title: string;
  /** One or two lines for the bell and the push. */
  message: string;
  /** Plain-text email body (used when HTML is unavailable, and as the preheader). */
  emailBody: string;
  /** The designed email. */
  html: string;
};

const { ink: INK, muted: MUTED, orange: ORANGE, teal: TEAL, font: FONT, line: LINE } = EMAIL_BRAND;

export function firstNameOf(name: string | null | undefined): string {
  return (name || "").trim().split(/\s+/)[0] || "";
}

function lead(journey: JourneyPayload, first: string) {
  const { audience } = journey;
  const fin = audience.finishedLevel;
  const target = audience.targetLevel;
  const hi = first ? `${first}, ` : "";

  if (audience.state === "midway") {
    return {
      title: `${hi}you're a month into ${fin} — see what comes next`,
      message: `Look what you've done in your first month of ${fin}, and your ${target} plan built around how you learn. Tell us you're coming and the office keeps your place.`,
      standfirst: `You are a month into ${fin}, and I have been watching how you learn. Here is what you have done so far, and the ${target} plan I built for you.`,
    };
  }
  return {
    title: `${hi}your ${target} plan is ready`,
    message: `You finished ${fin}. Here is what you achieved, and your ${target} plan built around how you learn. Two minutes, and your seat can be kept.`,
    standfirst: `You finished ${fin}. I put together what you achieved and a ${target} plan built around how you learn.`,
  };
}

export function buildInvite(journey: JourneyPayload, name: string | null | undefined): Invite {
  const first = firstNameOf(name);
  const { audience, recap, offer } = journey;
  const target = audience.targetLevel;
  const text = lead(journey, first);

  const stats = recap.stats.slice(0, 3);
  const plan = recap.plan.slice(0, 3);

  const url = absoluteUrl("/next-level", process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || "");

  const statCells = stats
    .map(
      (s) => `<td width="${Math.floor(100 / stats.length)}%" valign="top" style="padding:0 4px;">
        <div style="border:1px solid ${LINE};border-radius:12px;padding:12px 8px;text-align:center;">
          <div style="font:800 24px/1.1 ${FONT};color:${TEAL};">${s.value}${s.suffix ? `<span style="font-size:12px;font-weight:600;color:${MUTED};"> ${escapeHtml(s.suffix)}</span>` : ""}</div>
          <div style="margin-top:4px;font:600 11px/1.3 ${FONT};color:${MUTED};text-transform:uppercase;letter-spacing:.5px;">${escapeHtml(s.label)}</div>
        </div>
      </td>`,
    )
    .join("");

  const planRows = plan
    .map(
      (p) => `<tr><td style="padding:0 0 12px;font-family:${FONT};">
        <div style="font-size:14px;font-weight:700;color:${INK};">${escapeHtml(p.title)}</div>
        <div style="margin-top:2px;font-size:13px;line-height:20px;color:${MUTED};">${escapeHtml(p.detail)}</div>
        <div style="margin-top:3px;font-size:11px;color:${ORANGE};font-weight:700;">Because: ${escapeHtml(p.because)}</div>
      </td></tr>`,
    )
    .join("");

  const facts: string[] = [];
  if (offer.opensLabel) facts.push(`${target} opens <strong>${escapeHtml(offer.opensLabel)}</strong>.`);
  if (offer.tuitionFee > 0) {
    facts.push(
      `${target} tuition is <strong>${escapeHtml(naira(offer.tuitionFee))}</strong>; the deposit to start is <strong>${escapeHtml(naira(offer.requiredDeposit))}</strong>.`,
    );
  }

  const html = emailShell({
    title: text.title,
    senderName: "EasyWay German School",
    footer: "You are receiving this because you study with EasyWay. Reply to this email and a real person will answer.",
    preheader: text.message.slice(0, 120),
    content: `
    <tr><td style="padding:26px 24px 6px;font-family:${FONT};">
      <p style="margin:0 0 6px;font-size:14px;color:${MUTED};">${first ? `Hallo ${escapeHtml(first)},` : "Hallo,"}</p>
      <h1 style="margin:0 0 12px;font-size:21px;line-height:28px;color:${INK};font-weight:800;">${escapeHtml(recap.headline)}</h1>
      <p style="margin:0 0 16px;font-size:15px;line-height:24px;color:${INK};">${escapeHtml(text.standfirst)}</p>
    </td></tr>
    ${
      stats.length
        ? `<tr><td style="padding:0 20px 14px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${statCells}</tr></table></td></tr>`
        : ""
    }
    ${
      recap.rhythmLine
        ? `<tr><td style="padding:0 24px 12px;font-family:${FONT};font-size:14px;color:${INK};">${escapeHtml(recap.rhythmLine)}</td></tr>`
        : ""
    }
    ${
      plan.length
        ? `<tr><td style="padding:6px 24px 0;font-family:${FONT};">
        <div style="font-size:12px;font-weight:800;color:${TEAL};text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;">Your ${escapeHtml(target)} plan — built from your own habits</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${planRows}</table>
      </td></tr>`
        : ""
    }
    ${
      facts.length
        ? `<tr><td style="padding:2px 24px 14px;font-family:${FONT};font-size:14px;line-height:22px;color:${INK};">${facts.join(" ")}</td></tr>`
        : ""
    }
    <tr><td style="padding:6px 24px 28px;font-family:${FONT};">
      <a href="${escapeHtml(url)}" style="display:inline-block;background:${ORANGE};color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:14px 26px;border-radius:10px;">See my ${escapeHtml(target)} plan</a>
      <p style="margin:14px 0 0;font-size:12px;line-height:18px;color:${MUTED};">No coupon, no countdown — just the plan, the real price and the real opening day.</p>
    </td></tr>`,
  });

  const emailBody = [
    text.standfirst,
    ...stats.map((s) => `• ${s.value}${s.suffix ? ` ${s.suffix}` : ""} — ${s.label}`),
    ...(facts.length ? [facts.join(" ").replace(/<[^>]+>/g, "")] : []),
    `See your ${target} plan: ${url}`,
  ].join("\n\n");

  return { title: text.title, message: text.message, emailBody, html };
}
