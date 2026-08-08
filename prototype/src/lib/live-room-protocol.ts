/**
 * What people say to each other in a classroom that is not their voice.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * A 400ms link does not stop a lecture. It stops a *conversation* — and only at
 * one moment, the handover. Two students both think it is their turn, both
 * start, neither hears the other for 400ms, both stop, both apologise, both
 * restart. What is broken there is not the delay. It is that nobody knows whose
 * turn it is; the delay merely makes the ambiguity last long enough to hurt.
 *
 * So this does not try to make the network faster. It removes the ambiguity —
 * the same answer air traffic control and radio nets reached, for the same
 * reason. And it gives a student a way to be heard that does not require
 * interrupting a tutor by voice, which on a bad line they will simply never do.
 * A silent student is not a content student; they are a student who gave up,
 * and a class where nobody interrupts reads as "that went fine".
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS SPLIT IN TWO
 * ---------------------------------------------------------------------------
 * There are two kinds of state here and conflating them is the classic bug.
 *
 *   EPHEMERAL — reactions, chat lines. They happen, they are seen, they are
 *   gone. These ride LiveKit's data channel, which is fire-and-forget: anyone
 *   not in the room at that instant never sees them, and that is correct.
 *
 *   DURABLE — is my hand up, what mode is the room in, who holds the floor.
 *   A student joining ten minutes late must see the hand queue as it actually
 *   is. Sending these as data messages produces a classroom that looks
 *   different to every person in it. So a raised hand lives in the
 *   participant's own ATTRIBUTES, which LiveKit syncs to everyone including
 *   late joiners, and room-wide state is re-announced by the tutor whenever
 *   somebody new arrives.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS NOT TRUSTED
 * ---------------------------------------------------------------------------
 * Every message here arrives from another browser, so every message is a claim
 * rather than a fact. `role` comes from the token metadata the server minted —
 * not from the message body — and floor and mode changes are ignored unless the
 * sender's token says tutor. A student can forge the bytes; they cannot forge
 * the token, which is the whole reason the role lives there.
 *
 * This module is shared between server and browser, so it imports neither
 * `livekit-client` nor `livekit-server-sdk`.
 */

import type { RoomRole } from "@/lib/live-classroom";

// ---------------------------------------------------------------------------
// Reactions
//
// NOT emoji. This project renders emoji nowhere — they arrive as whatever the
// operating system feels like, flat on Windows and glossy on a Mac, and read as
// stray next to a drawn icon set. See components/icons.tsx.
//
// Five, chosen for what a language student actually needs to say while somebody
// else is talking. "Slower" and "lost" are the two that matter most and the two
// every other product leaves out: they are precisely the things a student would
// otherwise have to interrupt to say, and precisely the things a tutor most
// needs to hear.
// ---------------------------------------------------------------------------

export const REACTIONS = ["yes", "no", "slower", "lost", "nice"] as const;
export type ReactionKind = (typeof REACTIONS)[number];

export const REACTION_LABEL: Record<ReactionKind, string> = {
  yes: "Yes",
  no: "No",
  slower: "Slower please",
  lost: "I'm lost",
  nice: "Nice!",
};

/** How a reaction reads in the tutor's live tally. */
export const REACTION_URGENCY: Record<ReactionKind, "calm" | "attention"> = {
  yes: "calm",
  no: "calm",
  slower: "attention",
  lost: "attention",
  nice: "calm",
};

export function isReactionKind(value: unknown): value is ReactionKind {
  return typeof value === "string" && (REACTIONS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Room modes
// ---------------------------------------------------------------------------

/**
 * `open` is the default and it is not a compromise.
 *
 * This is a language school; the product is students speaking. A permanent
 * queue would make the lesson orderly and useless. So hand-raise is an EXTRA
 * channel in open mode, never a gate — everyone stays unmuted and simply talks,
 * exactly as before, and the hand is there for whoever wants it.
 *
 * `handup` is the tutor's tool for the moments that actually need it: forty
 * people, a Q&A, or a room that has become noise. It is a mode, not a policy,
 * because a drill and a grammar clinic want opposite things and only the person
 * teaching knows which one is happening.
 */
export const ROOM_MODES = ["open", "handup"] as const;
export type RoomMode = (typeof ROOM_MODES)[number];

export const ROOM_MODE_COPY: Record<RoomMode, { label: string; student: string; tutor: string }> = {
  open: {
    label: "Open floor",
    student: "Speak freely. Raise your hand if you would rather be called on.",
    tutor: "Everyone can speak. Best for drills and pair practice.",
  },
  handup: {
    label: "Hands up",
    student: "Raise your hand and your tutor will call on you.",
    tutor: "Students queue to speak. Best for a big class or a Q&A.",
  },
};

export function isRoomMode(value: unknown): value is RoomMode {
  return typeof value === "string" && (ROOM_MODES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Durable per-participant state, carried in LiveKit attributes
// ---------------------------------------------------------------------------

/** Attribute key for "my hand is up, since this millisecond". */
export const ATTR_HAND_RAISED_AT = "handRaisedAt";

/**
 * Read a participant's hand state out of their attributes.
 *
 * The timestamp is the ordering key for the queue, so first hand up is first
 * called — the fairness property that makes a queue worth having at all. A
 * blank or unparseable value means no hand, because a corrupt attribute must
 * not put somebody at the front of the line forever.
 */
export function handRaisedAt(attributes: Record<string, string> | undefined): number | null {
  const raw = attributes?.[ATTR_HAND_RAISED_AT];
  if (!raw) return null;
  const at = Number(raw);
  return Number.isFinite(at) && at > 0 ? at : null;
}

// ---------------------------------------------------------------------------
// Ephemeral messages, carried on the data channel
// ---------------------------------------------------------------------------

export const MAX_CHAT_LENGTH = 500;

export type LiveMessage =
  | { t: "reaction"; kind: ReactionKind }
  | { t: "chat"; text: string }
  /** Tutor only. `identity` is who may speak, or null for nobody in particular. */
  | { t: "floor"; identity: string | null }
  /** Tutor only. */
  | { t: "mode"; mode: RoomMode }
  /** Tutor only: put every hand down at once. */
  | { t: "handsCleared" }
  /**
   * Tutor only, and the fix for late joiners. Room-wide state is not durable
   * anywhere, so whenever somebody arrives the tutor simply says how things
   * currently are. Cheap, and it converges even if a message is dropped,
   * because the next arrival triggers another one.
   */
  | { t: "state"; mode: RoomMode; floor: string | null };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Copied into an array backed by a plain ArrayBuffer, which is what
 * `publishData` asks for. `TextEncoder.encode` returns the wider
 * `ArrayBufferLike` form — assignable at runtime, rejected at compile time.
 */
export function encodeMessage(message: LiveMessage): Uint8Array<ArrayBuffer> {
  const encoded = encoder.encode(JSON.stringify(message));
  const payload = new Uint8Array(new ArrayBuffer(encoded.byteLength));
  payload.set(encoded);
  return payload;
}

/**
 * Parse a payload from another browser.
 *
 * `senderRole` is the role from the SERVER-MINTED token, never from the
 * payload. Anything only a tutor may say is dropped when it does not come from
 * one — which is what stops a student granting themselves the floor by opening
 * the console and sending four bytes of JSON.
 *
 * Returns null for anything malformed rather than throwing: one bad frame from
 * one flaky client must not take down everybody else's classroom.
 */
export function decodeMessage(payload: Uint8Array, senderRole: RoomRole): LiveMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(payload));
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object") return null;
  const message = parsed as Record<string, unknown>;
  const tutorOnly = senderRole === "tutor";

  switch (message.t) {
    case "reaction":
      return isReactionKind(message.kind) ? { t: "reaction", kind: message.kind } : null;

    case "chat": {
      if (typeof message.text !== "string") return null;
      const text = message.text.trim().slice(0, MAX_CHAT_LENGTH);
      return text ? { t: "chat", text } : null;
    }

    case "floor":
      if (!tutorOnly) return null;
      if (message.identity !== null && typeof message.identity !== "string") return null;
      return { t: "floor", identity: message.identity };

    case "mode":
      return tutorOnly && isRoomMode(message.mode) ? { t: "mode", mode: message.mode } : null;

    case "handsCleared":
      return tutorOnly ? { t: "handsCleared" } : null;

    case "state":
      if (!tutorOnly || !isRoomMode(message.mode)) return null;
      if (message.floor !== null && typeof message.floor !== "string") return null;
      return { t: "state", mode: message.mode, floor: message.floor };

    default:
      return null;
  }
}

/**
 * The role a participant's token claims.
 *
 * Minted server-side in `/api/live/session` and attached as participant
 * metadata, so it is the one field in the room that a client cannot rewrite.
 */
export function roleOfMetadata(metadata: string | undefined): RoomRole {
  try {
    return JSON.parse(metadata || "{}")?.role === "tutor" ? "tutor" : "student";
  } catch {
    return "student";
  }
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

/** Nobody needs to react more than this, and a stuck finger should not spam. */
export const REACTION_COOLDOWN_MS = 1200;
/** How long a reaction floats before it fades. */
export const REACTION_TTL_MS = 4000;
/** Beyond this many on screen at once it is confetti, not information. */
export const MAX_VISIBLE_REACTIONS = 18;
