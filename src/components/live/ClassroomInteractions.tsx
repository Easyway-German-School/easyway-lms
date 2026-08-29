"use client";

/**
 * The classroom's non-verbal channel, on screen.
 *
 * Everything here exists to take pressure off the audio channel. A student who
 * can tap "slower" does not interrupt to say it; a student who can see they are
 * third in the queue does not ask again; a student who can type does not need
 * the microphone at all. On a 400ms link that is the difference between a
 * conversation and a pile-up.
 *
 * State and the wire protocol live in `useRoomInteractions` and
 * `@/lib/live-room-protocol`. This file is only how it looks.
 */

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import {
  AlertIcon,
  CheckIcon,
  ClockIcon,
  CrossIcon,
  HandIcon,
  SendIcon,
  StarIcon,
  type IconProps,
} from "@/components/icons";
import {
  MAX_CHAT_LENGTH,
  REACTIONS,
  REACTION_LABEL,
  ROOM_MODES,
  ROOM_MODE_COPY,
  type ReactionKind,
  type RoomMode,
} from "@/lib/live-room-protocol";
import type { ChatLine, FloatingReaction, RaisedHand } from "./useRoomInteractions";
import type { RoomRole } from "@/lib/live-classroom";

/**
 * Icons, not emoji — this project renders emoji nowhere, because they arrive as
 * whatever the operating system feels like and read as stray beside a drawn
 * set. See components/icons.tsx.
 */
const REACTION_ICON: Record<ReactionKind, (props: IconProps) => React.ReactElement> = {
  yes: CheckIcon,
  no: CrossIcon,
  slower: ClockIcon,
  lost: AlertIcon,
  nice: StarIcon,
};

const REACTION_TONE: Record<ReactionKind, string> = {
  yes: "text-emerald-300",
  no: "text-rose-300",
  slower: "text-amber-300",
  lost: "text-amber-300",
  nice: "text-[var(--accent)]",
};

// ---------------------------------------------------------------------------

/**
 * Reactions drifting up over the stage.
 *
 * Deliberately over the video and not in a list: the point is that the tutor
 * catches them while still talking, without looking away from the person they
 * are talking to. A panel nobody glances at is the same as no feature.
 */
export function ReactionLayer({ reactions }: { reactions: FloatingReaction[] }) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <AnimatePresence>
        {reactions.map((reaction) => {
          const Icon = REACTION_ICON[reaction.kind];
          return (
            <motion.div
              key={reaction.id}
              initial={{ opacity: 0, y: 20, scale: 0.6 }}
              animate={{ opacity: 1, y: -110, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ duration: 3.2, ease: "easeOut" }}
              className="absolute bottom-10"
              style={{ left: `${reaction.offset}%` }}
            >
              <div className="flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1.5 backdrop-blur-sm">
                <Icon className={`h-4 w-4 ${REACTION_TONE[reaction.kind]}`} />
                <span className="text-[11px] font-medium text-white/90">{reaction.from}</span>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------

/** The five taps, plus the hand. */
export function ReactionBar({
  onReact,
  onToggleHand,
  handRaised,
  handPosition,
}: {
  onReact: (kind: ReactionKind) => void;
  onToggleHand: () => void;
  handRaised: boolean;
  /** 1-based place in the queue, when raised. */
  handPosition: number | null;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        onClick={onToggleHand}
        aria-pressed={handRaised}
        className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
          handRaised ? "bg-amber-400 text-slate-900" : "bg-white/10 text-white hover:bg-white/20"
        }`}
      >
        <HandIcon className="h-4 w-4" />
        {handRaised ? (handPosition ? `Hand up · #${handPosition}` : "Hand up") : "Raise hand"}
      </button>

      <div className="flex items-center gap-1 rounded-xl bg-white/5 p-1">
        {REACTIONS.map((kind) => {
          const Icon = REACTION_ICON[kind];
          return (
            <button
              key={kind}
              onClick={() => onReact(kind)}
              title={REACTION_LABEL[kind]}
              aria-label={REACTION_LABEL[kind]}
              className="rounded-lg px-2.5 py-2 text-white/70 transition hover:bg-white/15 hover:text-white"
            >
              <Icon className={`h-4 w-4 ${REACTION_TONE[kind]}`} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * Who is speaking, said loudly.
 *
 * This is the load-bearing element of the whole feature. It does not exist to
 * tell one student they may speak — it exists to tell the other thirty-nine
 * that they should not, which is what actually prevents the collision.
 */
export function FloorBanner({ name, isMe }: { name: string; isMe: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex items-center gap-3 rounded-2xl px-5 py-3 text-sm font-semibold ${
        isMe ? "bg-emerald-500 text-white" : "bg-white/10 text-white"
      }`}
    >
      <span className="relative flex h-2.5 w-2.5 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-60" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-current" />
      </span>
      {isMe ? "You have the floor — go ahead" : `${name} has the floor`}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------

export function HandQueue({
  hands,
  role,
  floor,
  onGrantFloor,
  onClearHands,
}: {
  hands: RaisedHand[];
  role: RoomRole;
  floor: string | null;
  onGrantFloor: (identity: string | null) => void;
  onClearHands: () => void;
}) {
  if (hands.length === 0) {
    return (
      <p className="px-1 py-6 text-center text-xs text-slate-400">
        {role === "tutor" ? "No hands up." : "No hands up. Raise yours whenever you want to speak."}
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      {role === "tutor" ? (
        <div className="flex items-center justify-between px-1 pb-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            {hands.length} waiting
          </span>
          <button onClick={onClearHands} className="text-[11px] font-medium text-slate-400 transition hover:text-white">
            Clear all
          </button>
        </div>
      ) : null}

      {hands.map((hand, index) => (
        <div
          key={hand.identity}
          className={`flex items-center gap-2.5 rounded-xl px-3 py-2 ${
            floor === hand.identity ? "bg-emerald-500/20" : hand.mine ? "bg-white/10" : "bg-white/5"
          }`}
        >
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white/10 text-[11px] font-semibold text-white">
            {index + 1}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm text-white">
            {hand.mine ? "You" : hand.name}
          </span>
          {role === "tutor" ? (
            <button
              onClick={() => onGrantFloor(floor === hand.identity ? null : hand.identity)}
              className={`shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-semibold transition ${
                floor === hand.identity
                  ? "bg-emerald-500 text-white"
                  : "bg-white/10 text-white hover:bg-white/20"
              }`}
            >
              {floor === hand.identity ? "Speaking" : "Call on"}
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------

export function ModeSwitch({ mode, onChange }: { mode: RoomMode; onChange: (mode: RoomMode) => void }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1 rounded-xl bg-white/5 p-1">
        {ROOM_MODES.map((value) => (
          <button
            key={value}
            onClick={() => onChange(value)}
            className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition ${
              mode === value ? "bg-[var(--accent)] text-white" : "text-slate-300 hover:bg-white/10"
            }`}
          >
            {ROOM_MODE_COPY[value].label}
          </button>
        ))}
      </div>
      <p className="px-1 text-[11px] leading-4 text-slate-400">{ROOM_MODE_COPY[mode].tutor}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * Chat is not persisted anywhere, deliberately.
 *
 * It is the pressure valve for a laggy voice channel, not a record. Storing it
 * would mean moderation, retention and a place for a student to say something
 * regrettable that outlives the lesson — a large amount of policy to buy a
 * feature nobody asked for. A late joiner sees the conversation from the moment
 * they arrive, which is the same deal as walking into a room.
 */
export function ChatPanel({
  chat,
  onSend,
}: {
  chat: ChatLine[];
  onSend: (text: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [chat]);

  function submit() {
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft("");
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {chat.length === 0 ? (
          <p className="px-1 py-6 text-center text-xs leading-5 text-slate-400">
            Nothing yet. Type here if you would rather not interrupt — your tutor sees it.
          </p>
        ) : (
          chat.map((line) => (
            <div key={line.id} className={`flex flex-col ${line.mine ? "items-end" : "items-start"}`}>
              <span className="px-1 text-[10px] font-medium text-slate-400">
                {line.mine ? "You" : line.from}
                {line.role === "tutor" && !line.mine ? " · Tutor" : ""}
              </span>
              <div
                className={`max-w-[85%] break-words rounded-2xl px-3 py-2 text-sm ${
                  line.mine ? "bg-[var(--accent)] text-white" : "bg-white/10 text-white"
                }`}
              >
                {line.text}
              </div>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>

      <div className="mt-2 flex items-end gap-2">
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value.slice(0, MAX_CHAT_LENGTH))}
          onKeyDown={(event) => {
            // Enter sends; Shift+Enter is a new line. On a phone the on-screen
            // keyboard's return key sends, which is what people expect.
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          rows={1}
          placeholder="Message the class…"
          className="max-h-24 min-h-[2.5rem] flex-1 resize-none rounded-xl bg-white/10 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
        />
        <button
          onClick={submit}
          disabled={!draft.trim()}
          aria-label="Send message"
          className="shrink-0 rounded-xl bg-[var(--accent)] p-2.5 text-white transition hover:brightness-110 disabled:opacity-40"
        >
          <SendIcon className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
