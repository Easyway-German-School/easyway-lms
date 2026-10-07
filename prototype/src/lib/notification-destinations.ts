/**
 * Where a notification should take the reader.
 *
 * Stored `link` values go stale: pages get renamed, `/classes` was never a
 * student route, `/next-level` never existed. The bell, the full feed, the
 * in-app toast and the write path all have to agree, or a tap that "does
 * nothing" is a different bug in each place.
 */

export type NotificationHop = {
  href: string | null;
  clickable: boolean;
  hint: string | null;
  cta: string | null;
};

/** The whole message is already on the card. Opening "somewhere" would be a lie. */
const NOTE_KINDS = new Set(["general", "lecturer.message", "announcement"]);

const KIND_HREF: Array<[string, string]> = [
  ["assignment", "/assignment"],
  ["material", "/materials"],
  ["study_notes", "/materials"],
  ["recording", "/materials"],
  ["quests", "/materials"],
  ["result", "/results"],
  ["exam", "/exam-centre"],
  ["announcement.exam", "/exams/osd"],
  ["certificate", "/certificates"],
  ["payment", "/payments"],
  ["tuition", "/payments"],
  ["refund", "/payments"],
  ["class", "/calendar"],
  ["attendance", "/calendar"],
  ["live_class", "/calendar"],
  ["private_class", "/calendar"],
  ["tutor.assigned", "/calendar"],
  ["level.advance", "/programs?forNextLevel=1"],
  ["game", "/games"],
  ["support", "/dashboard"],
  ["profile", "/profile"],
  ["streak", "/dashboard"],
  ["live_quiz", "/play"],
  ["community", "/community"],
];

const NOTE_HINT =
  "This is just a note. There's no extra page to open — if you can read this, you've already got the whole message.";

function hrefForKind(kind: string): string | null {
  const match = KIND_HREF.find(([prefix]) => kind === prefix || kind.startsWith(`${prefix}.`));
  return match?.[1] ?? null;
}

/** Rewrite links that 404 or dump a student on a staff page. */
export function rewriteNotificationLink(link: string | null | undefined): string | null {
  const trimmed = String(link ?? "").trim();
  if (!trimmed) return null;
  const path = trimmed.split("?")[0];
  if (path === "/next-level") return "/programs?forNextLevel=1";
  if (path === "/classes") return "/calendar";
  return trimmed;
}

/**
 * What to persist on a new row. An explicit link still wins, after rewrite.
 * Note-kinds stay link-less unless the sender actually named a page.
 */
export function storedNotificationLink(kind: string, link?: string | null): string | null {
  const rewritten = rewriteNotificationLink(link);
  if (rewritten) return rewritten;
  if (NOTE_KINDS.has(kind)) return null;
  return hrefForKind(kind);
}

function isSamePage(href: string, currentPath: string): boolean {
  if (!currentPath) return false;
  const dest = href.split("?")[0];
  const here = currentPath.split("?")[0];
  return dest === here;
}

export function resolveNotificationHop(input: {
  kind: string;
  link: string | null;
  currentPath?: string;
}): NotificationHop {
  let href = rewriteNotificationLink(input.link);
  if (!href) href = hrefForKind(input.kind);

  const here = input.currentPath ?? "";
  if (href && isSamePage(href, here)) href = null;

  if (!href) {
    return { href: null, clickable: false, hint: NOTE_HINT, cta: null };
  }

  return { href, clickable: true, hint: null, cta: "Open this" };
}
