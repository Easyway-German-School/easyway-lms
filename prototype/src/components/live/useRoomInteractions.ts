"use client";

/**
 * Everything in the classroom that is not audio or video.
 *
 * Hand-raise, reactions, chat, the floor and the room mode — wired to one
 * LiveKit Room and handed back as plain React state. Kept out of
 * `LiveKitClassroom` because that component already has a full job managing
 * media, and mixing the two produced a file nobody could hold in their head.
 *
 * The protocol, and the reasoning behind splitting durable state from
 * ephemeral, lives in `@/lib/live-room-protocol`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RoomEvent, type Participant, type RemoteParticipant, type Room } from "livekit-client";
import {
  ATTR_HAND_RAISED_AT,
  MAX_CHAT_LENGTH,
  MAX_VISIBLE_REACTIONS,
  REACTION_COOLDOWN_MS,
  REACTION_TTL_MS,
  decodeMessage,
  encodeMessage,
  handRaisedAt,
  roleOfMetadata,
  type LiveMessage,
  type ReactionKind,
  type RoomMode,
} from "@/lib/live-room-protocol";
import type { RoomRole } from "@/lib/live-classroom";

export type FloatingReaction = {
  id: string;
  kind: ReactionKind;
  from: string;
  /** Horizontal drift, so twenty at once do not stack in one column. */
  offset: number;
};

export type ChatLine = {
  id: string;
  from: string;
  role: RoomRole;
  text: string;
  at: number;
  mine: boolean;
};

export type RaisedHand = {
  identity: string;
  name: string;
  at: number;
  mine: boolean;
};

export type RoomInteractions = {
  mode: RoomMode;
  floor: string | null;
  floorName: string | null;
  hands: RaisedHand[];
  myHandRaised: boolean;
  reactions: FloatingReaction[];
  chat: ChatLine[];
  unreadChat: number;
  react: (kind: ReactionKind) => void;
  toggleHand: () => void;
  sendChat: (text: string) => void;
  markChatRead: () => void;
  /** Tutor only — the UI hides these, the sender ignores them, receivers drop them. */
  setMode: (mode: RoomMode) => void;
  grantFloor: (identity: string | null) => void;
  clearHands: () => void;
};

function displayName(participant: Participant): string {
  return participant.name || participant.identity;
}

export function useRoomInteractions(room: Room | null, role: RoomRole, revision: number): RoomInteractions {
  const [mode, setModeState] = useState<RoomMode>("open");
  const [floor, setFloorState] = useState<string | null>(null);
  const [reactions, setReactions] = useState<FloatingReaction[]>([]);
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [unreadChat, setUnreadChat] = useState(0);
  const lastReactionRef = useRef(0);

  // Mirrors for the announce-to-late-joiners path, which fires from an event
  // handler and must not re-subscribe every time either value changes.
  const modeRef = useRef<RoomMode>("open");
  const floorRef = useRef<string | null>(null);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);
  useEffect(() => {
    floorRef.current = floor;
  }, [floor]);

  const publish = useCallback(
    (message: LiveMessage) => {
      if (!room) return;
      // `reliable: true` — these are all events where being dropped is worse
      // than being late. A lost hand-raise is a student who never gets called.
      room.localParticipant.publishData(encodeMessage(message), { reliable: true }).catch(() => {
        // A classroom must not break because a side-channel message failed.
      });
    },
    [room],
  );

  /**
   * Hands, derived from participant attributes rather than stored.
   *
   * `revision` is bumped by every room event, so this recomputes whenever
   * anything changes — including a participant leaving with their hand still
   * up, which is the case a hand list held in state would get wrong and keep
   * getting wrong for the rest of the lesson.
   */
  const hands = useMemo<RaisedHand[]>(() => {
    if (!room) return [];
    void revision;

    const everyone: Participant[] = [room.localParticipant, ...Array.from(room.remoteParticipants.values())];

    return everyone
      .map((participant) => {
        const at = handRaisedAt(participant.attributes);
        if (at === null) return null;
        return {
          identity: participant.identity,
          name: displayName(participant),
          at,
          mine: participant.identity === room.localParticipant.identity,
        };
      })
      .filter((hand): hand is RaisedHand => hand !== null)
      .sort((a, b) => a.at - b.at); // First hand up is first called.
  }, [room, revision]);

  const myHandRaised = hands.some((hand) => hand.mine);

  const floorName = useMemo(() => {
    if (!room || !floor) return null;
    if (floor === room.localParticipant.identity) return "You";
    const participant = room.remoteParticipants.get(floor);
    return participant ? displayName(participant) : null;
  }, [room, floor, /* eslint-disable-line react-hooks/exhaustive-deps */ revision]);

  // --- receiving ----------------------------------------------------------
  useEffect(() => {
    if (!room) return;

    function onData(payload: Uint8Array, participant?: RemoteParticipant) {
      // No participant means it came from the server, which we never do.
      if (!participant) return;
      const senderRole = roleOfMetadata(participant.metadata);
      const message = decodeMessage(payload, senderRole);
      if (!message) return;

      switch (message.t) {
        case "reaction":
          setReactions((current) =>
            [
              ...current,
              {
                id: `${participant.identity}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                kind: message.kind,
                from: displayName(participant),
                offset: Math.random() * 70 + 5,
              },
            ].slice(-MAX_VISIBLE_REACTIONS),
          );
          break;

        case "chat":
          setChat((current) =>
            [
              ...current,
              {
                id: `${participant.identity}-${Date.now()}`,
                from: displayName(participant),
                role: senderRole,
                text: message.text,
                at: Date.now(),
                mine: false,
              },
            ].slice(-200),
          );
          setUnreadChat((n) => n + 1);
          break;

        case "mode":
          setModeState(message.mode);
          break;

        case "floor":
          setFloorState(message.identity);
          break;

        case "handsCleared":
          // Only my own hand is mine to lower; everyone does the same and the
          // queue empties. A student cannot write another student's attributes.
          if (room && handRaisedAt(room.localParticipant.attributes) !== null) {
            room.localParticipant.setAttributes({ [ATTR_HAND_RAISED_AT]: "" }).catch(() => {});
          }
          break;

        case "state":
          setModeState(message.mode);
          setFloorState(message.floor);
          break;
      }
    }

    room.on(RoomEvent.DataReceived, onData);
    return () => {
      room.off(RoomEvent.DataReceived, onData);
    };
  }, [room]);

  /**
   * Tell newcomers how the room currently is.
   *
   * Only the tutor answers — forty students all announcing at once on every
   * arrival would be a broadcast storm, and their copies could disagree. The
   * small delay lets the newcomer finish subscribing before we speak, since a
   * message sent to somebody still negotiating is simply lost.
   */
  useEffect(() => {
    if (!room || role !== "tutor") return;

    function onJoin() {
      window.setTimeout(() => {
        publish({ t: "state", mode: modeRef.current, floor: floorRef.current });
      }, 1200);
    }

    room.on(RoomEvent.ParticipantConnected, onJoin);
    return () => {
      room.off(RoomEvent.ParticipantConnected, onJoin);
    };
  }, [room, role, publish]);

  /**
   * A participant holding the floor who leaves must not hold it forever.
   *
   * Hung off the departure event rather than checked on every re-render: the
   * event says exactly who left, so there is nothing to scan and no chance of
   * the check firing mid-render. Only the tutor acts, and the resulting
   * broadcast is what clears it for everyone else.
   */
  useEffect(() => {
    if (!room || role !== "tutor") return;

    function onLeft(participant: RemoteParticipant) {
      if (floorRef.current !== participant.identity) return;
      setFloorState(null);
      publish({ t: "floor", identity: null });
    }

    room.on(RoomEvent.ParticipantDisconnected, onLeft);
    return () => {
      room.off(RoomEvent.ParticipantDisconnected, onLeft);
    };
  }, [room, role, publish]);

  // Reactions expire on their own; without this they accumulate for the whole
  // lesson and the last one never leaves the screen.
  useEffect(() => {
    if (reactions.length === 0) return;
    const timer = window.setTimeout(() => setReactions((current) => current.slice(1)), REACTION_TTL_MS);
    return () => window.clearTimeout(timer);
  }, [reactions]);

  // --- sending ------------------------------------------------------------

  const react = useCallback(
    (kind: ReactionKind) => {
      const now = Date.now();
      if (now - lastReactionRef.current < REACTION_COOLDOWN_MS) return;
      lastReactionRef.current = now;

      publish({ t: "reaction", kind });
      // Shown locally too — a button that does nothing you can see reads as
      // broken, and the round trip is long enough here to notice.
      setReactions((current) =>
        [
          ...current,
          { id: `me-${now}`, kind, from: "You", offset: Math.random() * 70 + 5 },
        ].slice(-MAX_VISIBLE_REACTIONS),
      );
    },
    [publish],
  );

  const toggleHand = useCallback(() => {
    if (!room) return;
    const raised = handRaisedAt(room.localParticipant.attributes) !== null;
    room.localParticipant
      .setAttributes({ [ATTR_HAND_RAISED_AT]: raised ? "" : String(Date.now()) })
      .catch(() => {});
  }, [room]);

  const sendChat = useCallback(
    (text: string) => {
      const trimmed = text.trim().slice(0, MAX_CHAT_LENGTH);
      if (!trimmed || !room) return;
      publish({ t: "chat", text: trimmed });
      setChat((current) =>
        [
          ...current,
          {
            id: `me-${Date.now()}`,
            from: "You",
            role,
            text: trimmed,
            at: Date.now(),
            mine: true,
          },
        ].slice(-200),
      );
    },
    [publish, room, role],
  );

  const markChatRead = useCallback(() => setUnreadChat(0), []);

  const setMode = useCallback(
    (next: RoomMode) => {
      if (role !== "tutor") return;
      setModeState(next);
      publish({ t: "mode", mode: next });
    },
    [role, publish],
  );

  const grantFloor = useCallback(
    (identity: string | null) => {
      if (role !== "tutor") return;
      setFloorState(identity);
      publish({ t: "floor", identity });
    },
    [role, publish],
  );

  const clearHands = useCallback(() => {
    if (role !== "tutor" || !room) return;
    publish({ t: "handsCleared" });
    if (handRaisedAt(room.localParticipant.attributes) !== null) {
      room.localParticipant.setAttributes({ [ATTR_HAND_RAISED_AT]: "" }).catch(() => {});
    }
  }, [role, room, publish]);

  return {
    mode,
    floor,
    floorName,
    hands,
    myHandRaised,
    reactions,
    chat,
    unreadChat,
    react,
    toggleHand,
    sendChat,
    markChatRead,
    setMode,
    grantFloor,
    clearHands,
  };
}
