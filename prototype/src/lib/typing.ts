/**
 * "Somebody is typing" — the rules both sides of the wire agree on.
 *
 * Import-free on purpose (same reason as support-copy.ts): the browser needs
 * the wording and the timings, the server needs the timings, and neither should
 * drag prisma into the other's bundle.
 *
 * THE MODEL, for anyone learning how this works. There is no socket. A typing
 * signal is a tiny row that says "this person touched the box a moment ago":
 *
 *   sender:   while the draft is non-empty, re-stamp the row at most every
 *             {@link TYPING_PING_EVERY_MS}; when the draft is emptied or sent,
 *             delete it.
 *   reader:   ask for rows stamped within the last {@link TYPING_LIVE_MS}.
 *
 * Nothing needs to "expire" a typing state — a row that stops being re-stamped
 * simply ages out of the reader's window. That is why a closed tab, a dead
 * phone battery or a lost signal all resolve themselves in seconds without a
 * cron job or a disconnect handler. The window is deliberately longer than the
 * stamp interval (7s vs 2.8s) so one dropped request does not make the dots
 * flicker off mid-sentence.
 */

/** A ping counts as "typing" for this long after its last stamp. */
export const TYPING_LIVE_MS = 7_000;
/** Older than this and the row is garbage, swept by whoever stamps next. */
export const TYPING_STALE_MS = 60_000;
/** How often a sender may re-stamp while they keep typing. */
export const TYPING_PING_EVERY_MS = 2_800;

export type Typer = {
  id: string;
  /** First name only — the same name every bubble in the room shows. */
  name: string;
  role?: string;
};

/** "Anna Okafor" → "Anna". Never empty: a nameless account is still somebody. */
export function firstName(name: string | null | undefined): string {
  return (name ?? "").trim().split(/\s+/)[0] || "Someone";
}

export function typerInitials(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

/**
 * The sentence for however many people are typing.
 *
 *   1  Anna is typing
 *   2  Anna and Ben are typing
 *   3  Anna, Ben and Chi are typing
 *   5  Anna, Ben and 3 others are typing
 *
 * Capped at two names before "N others": a class of forty can put a dozen
 * people on the keyboard at once and a sentence naming all of them is a
 * paragraph. The count is what carries the "the room is alive" feeling anyway.
 */
export function describeTypers(names: string[]): string {
  const list = names.filter(Boolean);
  if (list.length === 0) return "";
  if (list.length === 1) return `${list[0]} is typing`;
  if (list.length === 2) return `${list[0]} and ${list[1]} are typing`;
  if (list.length === 3) return `${list[0]}, ${list[1]} and ${list[2]} are typing`;
  return `${list[0]}, ${list[1]} and ${list.length - 2} others are typing`;
}

/** The short form for a chat-list row, where there is room for one line only. */
export function describeTypersShort(names: string[]): string {
  const list = names.filter(Boolean);
  if (list.length === 0) return "";
  if (list.length === 1) return `${list[0]} is typing`;
  if (list.length === 2) return `${list[0]} and ${list[1]} are typing`;
  return `${list[0]} and ${list.length - 1} others are typing`;
}
