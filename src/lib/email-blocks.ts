import { EMAIL_BRAND, absoluteUrl, emailShell, escapeHtml } from "@/lib/email-brand";

/**
 * The block model behind the composer, and the one function that turns it
 * into email HTML.
 *
 * WHY BLOCKS RATHER THAN A RICH-TEXT BOX. The composer used to be a bare
 * `<textarea>` labelled "HTML is allowed", which meant every send was one
 * unclosed `<div>` away from arriving broken, and nothing about it was
 * branded. Blocks invert that: an admin picks WHAT to say and the renderer
 * decides how it looks, so a campaign cannot be off-brand and cannot be
 * malformed. It is also what makes AI drafting useful — a model returning
 * six typed objects is far more reliable than one returning table markup.
 *
 * PURE, and the same code runs in the browser for the live preview. That is
 * the guarantee the preview is worth anything at all: not "something like
 * this", but the actual bytes the student receives.
 *
 * ESCAPING IS NOT OPTIONAL HERE. Every text field is author-supplied and ends
 * up in HTML sent to hundreds of people. An apostrophe in "the tutor's note"
 * is enough to break a template; a stray `<` is enough to break a layout. So
 * nothing reaches the output without going through escapeHtml, and the only
 * markup in an email is markup this file wrote.
 */

export type EmailBlock =
  | { id: string; type: "heading"; text: string }
  | { id: string; type: "text"; text: string }
  | { id: string; type: "button"; label: string; href: string }
  | { id: string; type: "image"; src: string; alt: string }
  | { id: string; type: "divider" }
  | { id: string; type: "callout"; text: string };

export type EmailBlockType = EmailBlock["type"];

/** What the editor offers, in the order it offers them. */
export const BLOCK_PALETTE: Array<{
  type: EmailBlockType;
  label: string;
  hint: string;
}> = [
  { type: "heading", label: "Heading", hint: "A section title" },
  { type: "text", label: "Paragraph", hint: "Ordinary prose" },
  { type: "callout", label: "Callout", hint: "The one thing they must not miss" },
  { type: "button", label: "Button", hint: "Send them into the portal" },
  { type: "image", label: "Image", hint: "A picture by URL" },
  { type: "divider", label: "Divider", hint: "A line between sections" },
];

/**
 * A new block of the given type, with placeholder copy already in it.
 *
 * Pre-filled rather than empty because an empty block renders as nothing, and
 * a block you cannot see is a block you cannot select or drag — the editor
 * would appear to have swallowed your click.
 */
export function newBlock(type: EmailBlockType): EmailBlock {
  const id = `b_${Math.random().toString(36).slice(2, 10)}`;
  switch (type) {
    case "heading":
      return { id, type, text: "A short, specific heading" };
    case "text":
      return { id, type, text: "Say the one thing that changed, and what they should do about it." };
    case "callout":
      return { id, type, text: "The detail they must not miss." };
    case "button":
      return { id, type, label: "Open my portal", href: "/dashboard" };
    case "image":
      return { id, type, src: "", alt: "" };
    case "divider":
      return { id, type };
  }
}

/**
 * Merge fields, resolved at send time per recipient.
 *
 * Runs over the ALREADY-RENDERED html, and escapes the value it substitutes.
 * The order is what makes it safe: `{{name}}` contains no HTML-special
 * characters so it survives block escaping intact, and the real name is
 * escaped on the way in. A student called `Ade <script>` therefore cannot
 * inject anything into the mail their classmates receive.
 */
export type MergeValues = { name?: string | null; level?: string | null };

export function applyMergeFields(html: string, values: MergeValues): string {
  return collapseSpaces(
    html
      .replace(/\{\{\s*name\s*\}\}/g, escapeHtml(values.name?.trim() || "there"))
      // Empty, NOT a phrase. `{{level}}` stands where a level like "A2" goes,
      // and it is almost always written as "your {{level}} class" — so a
      // fallback of "your class" renders "your your class class" for anyone
      // without a level, which is every tutor on a students-and-tutors send.
      // Dropping it leaves "your class", which reads exactly right.
      .replace(/\{\{\s*level\s*\}\}/g, escapeHtml(values.level?.trim() || "")),
  );
}

/**
 * Tidy the gap a removed merge field leaves behind.
 *
 * Only runs of plain spaces, and only between word characters — never
 * newlines, and never near a tag, so email markup and paragraph breaks are
 * left exactly as the renderer wrote them.
 */
function collapseSpaces(value: string): string {
  return value.replace(/(\w) {2,}(\w)/g, "$1 $2").replace(/ +([.,;:!?])/g, "$1");
}

const B = EMAIL_BRAND;

/** One block to one table row. */
function renderBlock(block: EmailBlock, baseUrl?: string): string {
  switch (block.type) {
    case "heading":
      return `<tr><td style="padding:20px 24px 4px;font-family:${B.font};">
        <h2 style="margin:0;font-size:19px;line-height:27px;color:${B.ink};font-weight:700;">${escapeHtml(block.text)}</h2>
      </td></tr>`;

    case "text": {
      // Blank lines become paragraphs; single newlines become <br>. Anything
      // else the author typed is text, not markup.
      const paragraphs = block.text
        .split(/\n{2,}/)
        .map((chunk) => escapeHtml(chunk.trim()).replace(/\n/g, "<br />"))
        .filter(Boolean)
        .map((chunk) => `<p style="margin:0 0 14px;font-size:15px;line-height:24px;color:${B.ink};">${chunk}</p>`)
        .join("");
      return `<tr><td style="padding:8px 24px 0;font-family:${B.font};">${paragraphs}</td></tr>`;
    }

    case "callout":
      // Left border rather than a background block: it survives dark-mode
      // inversion in Gmail, where a pale fill can end up unreadable.
      return `<tr><td style="padding:10px 24px;font-family:${B.font};">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr><td style="border-left:4px solid ${B.orange};background:#fff7f0;padding:12px 16px;">
            <p style="margin:0;font-size:15px;line-height:23px;color:${B.ink};font-weight:600;">${escapeHtml(block.text)}</p>
          </td></tr>
        </table>
      </td></tr>`;

    case "button": {
      const url = absoluteUrl(block.href || "/", baseUrl);
      return `<tr><td style="padding:14px 24px;font-family:${B.font};">
        <a href="${escapeHtml(url)}" style="display:inline-block;background:${B.orange};color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:12px 22px;border-radius:8px;">${escapeHtml(block.label)}</a>
      </td></tr>`;
    }

    case "image": {
      if (!block.src.trim()) return "";
      // width:100% with a max, and a height of auto — a fixed height is how
      // images end up squashed on a phone.
      return `<tr><td style="padding:12px 24px;font-family:${B.font};">
        <img src="${escapeHtml(absoluteUrl(block.src, baseUrl))}" alt="${escapeHtml(block.alt)}" width="${B.maxWidth - 48}" style="display:block;width:100%;max-width:${B.maxWidth - 48}px;height:auto;border:0;border-radius:8px;" />
      </td></tr>`;
    }

    case "divider":
      return `<tr><td style="padding:8px 24px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="border-top:1px solid ${B.line};font-size:0;line-height:0;">&nbsp;</td></tr></table>
      </td></tr>`;
  }
}

/**
 * Blocks to a complete, branded email.
 *
 * The greeting is rendered here rather than being a block an admin can delete,
 * because "Hallo Chidinma," is the difference between a message from a school
 * and a circular. The merge fields inside it are resolved by the caller.
 */
export function renderEmailBlocks({
  blocks,
  subject,
  senderName,
  footer,
  baseUrl,
  greetingName,
}: {
  blocks: EmailBlock[];
  subject: string;
  senderName: string;
  footer: string;
  baseUrl?: string;
  /** Omitted renders a plain "Hallo," — used by the preview. */
  greetingName?: string | null;
}): string {
  const first = greetingName?.trim().split(/\s+/)[0];
  const greeting = `<tr><td style="padding:26px 24px 0;font-family:${B.font};">
    <p style="margin:0;font-size:14px;color:${B.muted};">Hallo${first ? ` ${escapeHtml(first)}` : ""},</p>
  </td></tr>`;

  const body = blocks.map((block) => renderBlock(block, baseUrl)).join("");

  // The preheader is the first real sentence, trimmed — see emailShell.
  const firstText = blocks.find((b) => b.type === "text" || b.type === "heading" || b.type === "callout");
  const preheader =
    firstText && "text" in firstText ? firstText.text.replace(/\s+/g, " ").slice(0, 120) : undefined;

  return emailShell({
    title: subject,
    senderName,
    footer,
    preheader,
    content: `${greeting}${body}<tr><td style="padding:0 24px 22px;"></td></tr>`,
  });
}

/**
 * Plain text of a block set, for the in-app notification and the push.
 *
 * MERGE FIELDS ARE RESOLVED HERE TOO, and to generic words rather than to a
 * person. `notify()` writes ONE message string shared by every recipient's
 * bell row, so there is no individual to substitute — but leaving the raw
 * `{{name}}` in is worse than generic: it puts "Hallo {{name}}" on three
 * hundred phones and tells every reader the school sends form letters badly.
 *
 * Not escaped, deliberately. This is the plain-text channel; a bell row and a
 * push body are rendered as text, and `&amp;` would show up literally.
 */
export function blocksToPlainText(blocks: EmailBlock[]): string {
  const generic = (value: string) =>
    collapseSpaces(
      value.replace(/\{\{\s*name\s*\}\}/g, "there").replace(/\{\{\s*level\s*\}\}/g, ""),
    );

  return blocks
    .map((block) => {
      switch (block.type) {
        case "heading":
        case "text":
        case "callout":
          return generic(block.text.trim());
        case "button":
          return generic(block.label.trim());
        default:
          return "";
      }
    })
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

/**
 * Accept only what the editor could have produced.
 *
 * The blocks arrive as JSON from a browser, so every field is treated as
 * hostile: unknown types are dropped, strings are capped, and nothing is
 * trusted to be a string just because the type says so. Length caps matter
 * because Gmail clips a message over ~102KB and silently hides the rest,
 * including the unsubscribe link, which is how a sender ends up reported.
 */
export function parseBlocks(input: unknown): EmailBlock[] {
  if (!Array.isArray(input)) return [];
  const str = (value: unknown, max: number) =>
    typeof value === "string" ? value.slice(0, max) : "";

  return input.flatMap((raw, index): EmailBlock[] => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as Record<string, unknown>;
    const id = typeof item.id === "string" ? item.id.slice(0, 40) : `b_${index}`;

    switch (item.type) {
      case "heading":
        return [{ id, type: "heading", text: str(item.text, 200) }];
      case "text":
        return [{ id, type: "text", text: str(item.text, 5000) }];
      case "callout":
        return [{ id, type: "callout", text: str(item.text, 500) }];
      case "button":
        return [{ id, type: "button", label: str(item.label, 60) || "Open my portal", href: str(item.href, 500) || "/dashboard" }];
      case "image":
        return [{ id, type: "image", src: str(item.src, 1000), alt: str(item.alt, 200) }];
      case "divider":
        return [{ id, type: "divider" }];
      default:
        return [];
    }
  });
}
