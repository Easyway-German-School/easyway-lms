/**
 * @-mentions in community chat: tagging a person, an assignment, a material
 * or a video so tapping it goes straight there, instead of a student asking
 * in the room "where did the tutor post that" every single time.
 *
 * Deliberately plain text, not a rich editor. A mention is written straight
 * into the message body as `@[Label](type:id)` — the same trick Slack/Discord
 * use for their own raw `<@U123>` markup — so no change was needed to how a
 * message is sent or stored (see POST /api/community/messages). Only the
 * composer (to insert the token) and the bubble (to render it as a tappable
 * chip instead of literal brackets) know this format exists.
 *
 * Browser-safe: no prisma import, so both the composer and the message
 * renderer can use it.
 */

export type MentionType = "person" | "assignment" | "material" | "video";

export const MENTION_TYPES: MentionType[] = ["person", "assignment", "material", "video"];

/** `@[Herr Gerald](person:ckx123)` — label, type, id. */
export const MENTION_TOKEN_RE = /@\[([^\]]+)\]\((person|assignment|material|video):([a-zA-Z0-9_-]+)\)/g;

/**
 * The partial token right before the cursor while typing, e.g. typing
 * "...ask @Ger" after an "@" with no space since returns `{ start, query: "Ger" }`.
 * Null once a space, newline or another "@" breaks the run, or there is no "@"
 * at all — that is what lets a stray "@" in an email address stay inert.
 */
export function activeMentionQuery(value: string, cursor: number): { start: number; query: string } | null {
  const upToCursor = value.slice(0, cursor);
  const at = upToCursor.lastIndexOf("@");
  if (at === -1) return null;
  const between = upToCursor.slice(at + 1);
  if (/[\s@]/.test(between)) return null;
  return { start: at, query: between };
}

/** Build the token to insert, with a trailing space so typing continues naturally. */
export function mentionToken(type: MentionType, id: string, label: string): string {
  return `@[${label.replace(/[[\]()]/g, "")}](${type}:${id}) `;
}

/** Replace the "@query" the user was typing with a finished mention token. */
export function insertMentionToken(
  value: string,
  start: number,
  query: string,
  type: MentionType,
  id: string,
  label: string,
): { value: string; cursor: number } {
  const before = value.slice(0, start);
  const after = value.slice(start + 1 + query.length);
  const token = mentionToken(type, id, label);
  return { value: before + token + after, cursor: (before + token).length };
}

export type MentionSegment =
  | { kind: "text"; text: string }
  | { kind: "mention"; type: MentionType; id: string; label: string };

/** Split a message body into plain-text runs and mention tokens, in order. */
export function splitMentions(body: string): MentionSegment[] {
  const segments: MentionSegment[] = [];
  let lastIndex = 0;
  MENTION_TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MENTION_TOKEN_RE.exec(body))) {
    if (match.index > lastIndex) segments.push({ kind: "text", text: body.slice(lastIndex, match.index) });
    segments.push({ kind: "mention", type: match[2] as MentionType, id: match[3], label: match[1] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < body.length) segments.push({ kind: "text", text: body.slice(lastIndex) });
  return segments;
}

/**
 * Where tapping a mention of this type should take you — null for a person,
 * who is tagged (highlighted, pinged) rather than linked anywhere. There is
 * no public profile page to send a tap to, and WhatsApp's own @mention does
 * not navigate either; it just calls the person out in the room.
 */
export function mentionHref(type: MentionType, id: string): string | null {
  switch (type) {
    case "assignment":
      return `/assignment?id=${id}`;
    case "video":
      return `/materials/watch/${id}`;
    case "material":
      return `/materials?open=${id}`;
    case "person":
      return null;
  }
}

export const MENTION_TYPE_LABEL: Record<MentionType, string> = {
  person: "People",
  assignment: "Assignments",
  material: "Materials",
  video: "Videos",
};
