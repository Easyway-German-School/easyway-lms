import { MAIL_IDENTITIES, type MailIdentityKey } from "@/lib/mail-identity";

/**
 * The emailed copy of a notification.
 *
 * TABLE LAYOUT AND INLINE STYLES, on purpose. Outlook renders with Word's
 * engine, which has no flexbox, no grid and drops a `<style>` block often
 * enough to matter — this is the one place in the codebase where 2005 markup
 * is the correct answer. Gmail's clipping is why it stays under 102KB, which a
 * notification comfortably is.
 *
 * The footer differs by identity: the support address invites a reply, the
 * automated one says plainly that it is automated and points at support
 * anyway. A student should never have to guess whether anyone is listening.
 */

const BRAND = "#FF6600";
const INK = "#0f172a";
const MUTED = "#64748b";
const LINE = "#e2e8f0";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Relative links have to become absolute — an email has no origin. */
function absolute(link: string): string {
  if (/^https?:\/\//i.test(link)) return link;
  const base = (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || "").replace(/\/$/, "");
  return base ? `${base}${link.startsWith("/") ? "" : "/"}${link}` : link;
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

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:#f6f7f9;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7f9;padding:24px 12px;">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid ${LINE};border-radius:14px;overflow:hidden;">

    <tr><td style="background:${BRAND};padding:18px 24px;">
      <span style="font:700 15px/1.2 Arial,Helvetica,sans-serif;color:#ffffff;letter-spacing:.4px;">
        ${escapeHtml(who.name)}
      </span>
    </td></tr>

    <tr><td style="padding:26px 24px 8px;font-family:Arial,Helvetica,sans-serif;">
      <p style="margin:0 0 6px;font-size:14px;color:${MUTED};">${greeting}</p>
      <h1 style="margin:0 0 16px;font-size:19px;line-height:27px;color:${INK};font-weight:700;">
        ${escapeHtml(title)}
      </h1>
      ${paragraphs}
    </td></tr>

    ${
      url
        ? `<tr><td style="padding:6px 24px 26px;font-family:Arial,Helvetica,sans-serif;">
      <a href="${escapeHtml(url)}"
         style="display:inline-block;background:${BRAND};color:#ffffff;text-decoration:none;
                font-size:14px;font-weight:700;padding:12px 22px;border-radius:8px;">
        ${escapeHtml(cta)}
      </a>
    </td></tr>`
        : `<tr><td style="padding:0 24px 26px;"></td></tr>`
    }

    <tr><td style="border-top:1px solid ${LINE};padding:16px 24px;font-family:Arial,Helvetica,sans-serif;">
      <p style="margin:0;font-size:12px;line-height:18px;color:${MUTED};">
        ${escapeHtml(who.footer)}
      </p>
    </td></tr>

  </table>
</td></tr>
</table>
</body></html>`;
}
