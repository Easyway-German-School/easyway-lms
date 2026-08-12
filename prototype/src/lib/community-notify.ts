import { prisma } from "@/lib/prisma";
import { notifyInBackground, KIND } from "@/lib/notify";

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
 *   Ordinary chat — everything else. No rows at all. The popup layer polls
 *   `/api/community/live`, which derives what is new from the read markers that
 *   already exist for the unread badge. That endpoint carries the real message
 *   text, which is what makes the popup a message rather than a notice that a
 *   message happened.
 *
 * The result is that a student sees every message pop up while they are in the
 * portal, and finds only the things that actually needed keeping in the bell.
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

export function announceChatMessage(input: ChatAnnouncement): void {
  void (async () => {
    try {
      const channel = await prisma.channel.findUnique({
        where: { id: input.channelId },
        select: { kind: true, space: { select: { branchId: true, level: true, sessionSlot: true } } },
      });

      // Conversation, not event. The polling endpoint handles it; nothing to do.
      if (!channel || channel.kind !== "announcement") return;

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
