import { MAIL_IDENTITIES, type MailIdentityKey } from "@/lib/mail-identity";
import { EMAIL_BRAND, absoluteUrl, emailShell, escapeHtml } from "@/lib/email-brand";

/**
 * The emailed copy of a notification.
 *
 * The frame — canvas, card, teal masthead, orange rule, footer — now comes
 * from `emailShell` in email-brand.ts, which the admin's designed campaigns
 * also use. This file used to carry its own palette and its own header markup,
 * so an automated receipt and a message from the office looked like two
 * different institutions. They are one school; they get one letterhead.
 *
 * The footer still differs by identity: the support address invites a reply,
 * the automated one says plainly that it is automated and points at support
 * anyway. A student should never have to guess whether anyone is listening.
 */

const { ink: INK, muted: MUTED, orange: BRAND, font: FONT } = EMAIL_BRAND;

/** Relative links have to become absolute — an email has no origin. */
function absolute(link: string): string {
  return absoluteUrl(
    link,
    process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || "",
  );
}

export function renderNotificationEmail({
  name,
  title,
  body,
  link,
  identity,
  cta = "Open it in your portal",
}: {
  name?: string | null;
  title: string;
  body: string;
  link?: string;
  identity: MailIdentityKey;
  cta?: string;
}): string {
  const who = MAIL_IDENTITIES[identity];
  const greeting = name ? `Hallo ${escapeHtml(name.split(" ")[0])},` : "Hallo,";
  const url = link ? absolute(link) : null;

  // Paragraph breaks survive; everything else is escaped.
  const paragraphs = body
    .split(/\n{2,}/)
    .map((chunk) => escapeHtml(chunk.trim()).replace(/\n/g, "<br />"))
    .filter(Boolean)
    .map(
      (chunk) =>
        `<p style="margin:0 0 14px;font-size:15px;line-height:24px;color:${INK};">${chunk}</p>`,
    )
    .join("");

  return emailShell({
    title,
    senderName: who.name,
    footer: who.footer,
    // The body's opening line, so the inbox preview says something rather than
    // repeating "Hallo," for every message the school sends.
    preheader: body.replace(/\s+/g, " ").slice(0, 120),
    content: `
    <tr><td style="padding:26px 24px 8px;font-family:${FONT};">
      <p style="margin:0 0 6px;font-size:14px;color:${MUTED};">${greeting}</p>
      <h1 style="margin:0 0 16px;font-size:19px;line-height:27px;color:${INK};font-weight:700;">
        ${escapeHtml(title)}
      </h1>
      ${paragraphs}
    </td></tr>

    ${
      url
        ? `<tr><td style="padding:6px 24px 26px;font-family:${FONT};">
      <a href="${escapeHtml(url)}"
         style="display:inline-block;background:${BRAND};color:#ffffff;text-decoration:none;
                font-size:14px;font-weight:700;padding:12px 22px;border-radius:8px;">
        ${escapeHtml(cta)}
      </a>
    </td></tr>`
        : `<tr><td style="padding:0 24px 26px;"></td></tr>`
    }`,
  });
}
