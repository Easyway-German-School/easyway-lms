/**
 * What an EasyWay email looks like. One file, used by every one of them.
 *
 * WHY THIS IS SEPARATE FROM THE TEMPLATES. Before this, `notification-email.ts`
 * held its own copy of the palette and its own header markup, the seven
 * templates in `email-templates.ts` each had their own, and the admin composer
 * sent whatever raw HTML somebody typed into a textarea. Three different
 * schools, depending on which message you happened to receive. Branding that
 * lives in three places is branding that drifts.
 *
 * PURE ON PURPOSE — no prisma, no next, no node builtins. The composer renders
 * a live preview in the BROWSER using the very same functions the server sends
 * with, so what an admin previews is what a student receives. That guarantee
 * only holds while this module can run in both places.
 *
 * TABLE LAYOUT AND INLINE STYLES, also on purpose. Outlook renders with Word's
 * engine: no flexbox, no grid, and a dropped `<style>` block often enough to
 * matter. This is the one corner of the codebase where 2005 markup is correct.
 */

export const EMAIL_BRAND = {
  /** The anchor colour. Headers, and the frame around everything. */
  teal: "#0D7C7E",
  /** The accent. Buttons and rules — loud, and used sparingly for that reason. */
  orange: "#FF6600",
  ink: "#0f172a",
  muted: "#64748b",
  line: "#e2e8f0",
  canvas: "#f6f7f9",
  paper: "#ffffff",
  /** Arial rather than a webfont: Outlook ignores @font-face entirely. */
  font: "Arial,Helvetica,sans-serif",
  maxWidth: 560,
} as const;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Relative links have to become absolute — an email has no origin.
 *
 * `baseUrl` is passed in rather than read from the environment so this module
 * stays pure and usable in the browser preview. Server callers hand it
 * NEXT_PUBLIC_APP_URL; the preview hands it window.location.origin.
 */
export function absoluteUrl(link: string, baseUrl?: string): string {
  if (/^https?:\/\//i.test(link)) return link;
  const base = (baseUrl ?? "").replace(/\/$/, "");
  return base ? `${base}${link.startsWith("/") ? "" : "/"}${link}` : link;
}

/**
 * The frame every email sits in: canvas, card, teal masthead, footer rule.
 *
 * Callers supply only the middle. That is what makes a designed campaign and
 * an automated receipt read as the same institution — the parts a sender can
 * change are deliberately the parts that should differ.
 */
export function emailShell({
  title,
  senderName,
  footer,
  content,
  preheader,
}: {
  title: string;
  senderName: string;
  footer: string;
  /** Already-safe HTML for the body rows. */
  content: string;
  /**
   * The grey line an inbox shows after the subject. Left unset, clients scrape
   * whatever text comes first — usually "Hallo," or an image alt — which
   * wastes the one piece of copy that decides whether a mail is opened.
   */
  preheader?: string;
}): string {
  const B = EMAIL_BRAND;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:${B.canvas};">
${
  preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>`
    : ""
}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${B.canvas};padding:24px 12px;">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:${B.maxWidth}px;background:${B.paper};border:1px solid ${B.line};border-radius:14px;overflow:hidden;">

    <tr><td style="background:${B.teal};padding:18px 24px;">
      <span style="font:700 15px/1.2 ${B.font};color:#ffffff;letter-spacing:.4px;">
        ${escapeHtml(senderName)}
      </span>
    </td></tr>
    <!-- A 3px orange rule under the teal. The two brand colours together are
         recognisable at a glance in a crowded inbox; teal alone is not.
         An HTML comment, not a JSX one: this is a template literal, so
         {/* ... */} would be printed into the email as visible text. -->
    <tr><td style="background:${B.orange};font-size:0;line-height:0;height:3px;">&nbsp;</td></tr>

    ${content}

    <tr><td style="border-top:1px solid ${B.line};padding:16px 24px;font-family:${B.font};">
      <p style="margin:0;font-size:12px;line-height:18px;color:${B.muted};">
        ${escapeHtml(footer)}
      </p>
    </td></tr>

  </table>
</td></tr>
</table>
</body></html>`;
}
