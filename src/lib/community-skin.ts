/**
 * HOW THE COMMUNITY LOOKS TO EACH KIND OF STUDENT.
 *
 * The new look (lib/youth-look.ts) already has its community: the room with
 * classmates' cartoon avatars, inside the phone tab bar. That stays as it is.
 * What the classic look never had was a community built for the people who use
 * it, so that is the one thing that changes here:
 *
 *   chat   The CLASSIC look. Built for the adult learner whose chat app is
 *          WhatsApp and whose feed is Facebook. Nothing to learn: a green
 *          chat list with big round avatars and a green unread badge, soft
 *          green bubbles with a pointed corner and a tick, a paper wallpaper,
 *          "Today" chips between days, bigger type, and "Like · Reply" under
 *          every message the way a Facebook post has it. Familiar beats clever
 *          for this reader: every control is where their thumb already expects
 *          it, and the text is large enough to read without a squint.
 *
 *   plain  The new look's room, and staff. A tutor or the office is moderating
 *          a room, not hanging out in it, so they get the neutral original.
 *
 * Pure, so the rule is tested without a browser.
 */

import type { Look } from "@/lib/youth-look";

export type CommunitySkin = "plain" | "chat";

export function communitySkin(input: { look: Look; ready: boolean; isStaff: boolean }): CommunitySkin {
  // Staff, the new look, and anyone we have not yet heard an answer for, get the room as it was.
  if (input.isStaff || !input.ready || input.look === "youth") return "plain";
  return "chat";
}

/** The chat theme a skin starts on, until the student picks one themselves. */
export const SKIN_DEFAULT_THEME: Record<CommunitySkin, string> = {
  plain: "classic",
  chat: "whatsapp",
};

/** WhatsApp's green, used for the avatar, the unread badge and the send button. */
export const CHAT_GREEN = "#00A884";
export const CHAT_GREEN_AVATAR = "linear-gradient(135deg, #25D366, #128C7E)";
