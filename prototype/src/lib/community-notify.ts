import { prisma } from "@/lib/prisma";
import { notifyInBackground, KIND } from "@/lib/notify";
import { sendPushToUsers, spaceMemberIds } from "@/lib/push";

/**
 * Telling the room something was said — and the one decision this file exists
 * to make: WHICH messages deserve a permanent record.
 *
 * The obvious implementation writes a Notification row per recipient per
 * message. It is also wrong. `notify()` fans out, so one message in a class of
 * forty writes forty rows; a normally chatty term writes hundreds of thousands,
 * every one of them landing in the bell that is supposed to be reserved for
 * "your payment failed" and "your class is live". The bell would become useless
 * within a week, which is the same as switching it off.
 *
 * So there are two paths, split by whether the message is an EVENT or a
 * CONVERSATION:
 *
 *   Announcements — staff-only channels, the things a student must not miss.
 *   These get a real Notification row: they belong in the bell, they survive a
 *   closed tab, and they are rare enough to be worth the fan-out.
 *
 *   Ordinary chat — everything else. NO ROWS, BUT STILL A PUSH. The two are
 *   separable and it took a moment to notice: `sendPushToUsers` talks to the
 *   Web Push endpoints directly and never touches the Notification table. So a
 *   student gets their messages on the lock screen exactly as they would from
 *   WhatsApp, and the bell stays reserved for things worth keeping. Inside the
 *   portal the popup layer polls `/api/portal/updates`, which derives what is
 *   new from the read markers that already exist for the unread badge and
 *   carries the real message text.
 *
 * The result is that a student is reached wherever they are — on the page, in
 * another tab, or with the phone in their pocket — and still finds only the
 * things that actually needed keeping when they open the bell.
 */

export type ChatAnnouncement = {
  channelId: string;
  channelName: string;
  spaceId: string;
  messageId: string;
  authorId: string;
  authorName: string;
  body: string;
  hasAttachment: boolean;
};

/** A picture with no caption still has to say something in a one-line preview. */
export function previewOf(body: string, hasAttachment: boolean): string {
  const text = body.trim();
  if (text) return text.length > 140 ? `${text.slice(0, 139)}…` : text;
  return hasAttachment ? "📷 Photo" : "";
}

/**
 * How long a room waits before it may buzz a phone again.
 *
 * Chat DOES reach the lock screen — it has to, or it loses to WhatsApp, which
 * is the app it is competing with for the same attention. But a class of forty
 * mid-conversation produces a message every few seconds, and forty buzzes a
 * minute is how a student turns notifications off for good and never turns them
 * back on.
 *
 * So a room may buzz at most once in this window, carrying the newest message.
 * Combined with a `tag` keyed on the channel — which makes the operating system
 * REPLACE the previous notification rather than stack a new one — the phone
 * shows one live entry per class group that keeps updating. That is exactly the
 * behaviour of every messaging app anybody here already uses.
 *
 * The counter lives in one server instance's memory, so on serverless the real
 * rate is somewhat higher than this suggests. That is acceptable: the failure
 * mode is a second buzz, not a hundred, and the alternative is a round trip to
 * the database on the hot path of every message sent.
 */
const PUSH_QUIET_MS = 45_000;
const lastPushByChannel = new Map<string, number>();

function mayPush(channelId: string): boolean {
  const now = Date.now();
  const last = lastPushByChannel.get(channelId) ?? 0;
  if (now - last < PUSH_QUIET_MS) return false;
  lastPushByChannel.set(channelId, now);

  // Cheap sweep so a long-lived instance does not accumulate one entry per
  // channel forever.
  if (lastPushByChannel.size > 500) {
    for (const [id, at] of lastPushByChannel) {
      if (now - at > PUSH_QUIET_MS * 4) lastPushByChannel.delete(id);
    }
  }
  return true;
}

export function announceChatMessage(input: ChatAnnouncement): void {
  void (async () => {
    try {
      const channel = await prisma.channel.findUnique({
        where: { id: input.channelId },
        select: { kind: true, space: { select: { branchId: true, level: true, sessionSlot: true } } },
      });
      if (!channel) return;

      /**
       * ORDINARY CHAT: a push, and no database row.
       *
       * This is the split the whole file exists for. The phone still buzzes —
       * `sendPushToUsers` talks to the Web Push endpoints directly and does not
       * touch the Notification table — so students get their messages on the
       * lock screen without the bell filling up with them.
       *
       * `spaceMemberIds` resolves the cohort by branch, level AND sitting, so
       * the buzz reaches exactly the people who can open the room it points at.
       */
      if (channel.kind !== "announcement") {
        if (!mayPush(input.channelId)) return;

        const recipients = await spaceMemberIds(input.spaceId, input.authorId);
        if (recipients.length === 0) return;

        await sendPushToUsers(recipients, {
          title: `${input.authorName} · ${input.channelName}`,
          body: previewOf(input.body, input.hasAttachment),
          url: `/community?channel=${input.channelId}&message=${input.messageId}`,
          // One live entry per class group, replaced rather than stacked.
          tag: `community:${input.channelId}`,
        });
        return;
      }

      const space = channel.space;

      notifyInBackground({
        /**
         * Pinned to the sitting as well as the branch and level, which is the
         * whole point of the session work: an announcement in the morning A1
         * room must not reach the evening A1 class, who have a different tutor
         * and a different lesson.
         */
        to: {
          students: {
            branchId: space.branchId,
            level: space.level,
            sessionSlot: space.sessionSlot,
          },
        },
        kind: KIND.announcement,
        severity: "info",
        title: `${input.authorName} in ${input.channelName}`,
        // The message itself, not "you have a new announcement". A notification
        // a student has to open to discover whether it mattered is one they
        // learn to ignore.
        message: previewOf(input.body, input.hasAttachment),
        link: `/community?channel=${input.channelId}&message=${input.messageId}`,
        senderId: input.authorId,
        // Once per message, however many times this runs.
        dedupeKey: `chat-announcement:${input.messageId}`,
        push: true,
        emailBody: input.body,
      });
    } catch (error) {
      // A classroom announcement that failed to ring is a bad afternoon. A
      // send that throws and loses the message itself is not survivable, and
      // this is called fire-and-forget from the send path.
      console.error("Could not announce community message:", error);
    }
  })();
}
