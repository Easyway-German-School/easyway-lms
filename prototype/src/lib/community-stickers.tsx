import type { ReactNode } from "react";

/**
 * EASYWAY'S OWN STICKER SET.
 *
 * Drawn in code rather than uploaded, and that is a deliberate trade rather
 * than a shortcut:
 *
 *   - A message stores a STICKER ID, so redrawing the set updates every
 *     sticker ever sent. An image URL would freeze today's artwork into the
 *     transcript forever and eventually 404 when the bucket is reorganised.
 *   - Nothing to upload, nothing to store, nothing to pay for, and no cold
 *     first-load while a sprite sheet downloads over Nigerian mobile data.
 *   - It scales. These are vectors, so they are crisp on a cheap 480p phone
 *     and on a projector in the classroom.
 *
 * The set is small and in GERMAN on purpose. A sticker pack of generic smileys
 * is what every other app already has; these are the seven things a learner
 * actually says in class, said in the language they are here to learn. Tapping
 * "Ich verstehe!" is a tiny bit of practice disguised as a reaction, and it is
 * the kind of thing a nervous student will send when they would not type a
 * sentence.
 *
 * An unknown id renders nothing rather than a broken tile — a sticker retired
 * from the set must not leave a torn-image icon sitting in an old conversation.
 */

export type Sticker = {
  id: string;
  /** The German line on the sticker. */
  caption: string;
  /** What it means, for the picker's tooltip and for screen readers. */
  meaning: string;
  /** Sticker background. */
  background: string;
  /** Caption colour, chosen against the background. */
  ink: string;
  art: ReactNode;
};

/* -------------------------------------------------------------------------- */
/* The drawings. Deliberately bold and simple: these render at ~112px in a     */
/* bubble and ~64px in the tray, where fine detail is mud.                     */
/* -------------------------------------------------------------------------- */

const Bulb = (
  <g>
    <circle cx="32" cy="27" r="15" fill="#FFD400" stroke="#2B2B2B" strokeWidth="3" />
    <path d="M26 43h12v4a6 6 0 0 1-12 0z" fill="#C9C9C9" stroke="#2B2B2B" strokeWidth="3" />
    <path d="M32 20v10M27 25l5 5 5-7" fill="none" stroke="#2B2B2B" strokeWidth="2.5" strokeLinecap="round" />
  </g>
);

const Hand = (
  <g>
    <path
      d="M24 46V25a4 4 0 0 1 8 0v-4a4 4 0 0 1 8 0v4a4 4 0 0 1 8 0v14c0 7-5 12-12 12h-3c-6 0-9-3-9-5z"
      fill="#FFC38B"
      stroke="#2B2B2B"
      strokeWidth="3"
      strokeLinejoin="round"
    />
  </g>
);

const Star = (
  <path
    d="M32 12l6 13 14 2-10 9.5 2.5 14L32 44l-12.5 6.5L22 36.5 12 27l14-2z"
    fill="#FFD400"
    stroke="#2B2B2B"
    strokeWidth="3"
    strokeLinejoin="round"
  />
);

const Tick = (
  <g>
    <circle cx="32" cy="32" r="19" fill="#2FBF71" stroke="#2B2B2B" strokeWidth="3" />
    <path d="M23 33l6.5 7L42 26" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
  </g>
);

const Question = (
  <g>
    <circle cx="32" cy="32" r="19" fill="#7C5CFF" stroke="#2B2B2B" strokeWidth="3" />
    <path
      d="M26 26a6 6 0 1 1 8 5.6c-1.4.6-2 1.7-2 3.1v1.3"
      fill="none"
      stroke="#fff"
      strokeWidth="4"
      strokeLinecap="round"
    />
    <circle cx="32" cy="42" r="2.6" fill="#fff" />
  </g>
);

const Heart = (
  <path
    d="M32 49S14 38 14 27a9 9 0 0 1 18-3 9 9 0 0 1 18 3c0 11-18 22-18 22z"
    fill="#FF4D6D"
    stroke="#2B2B2B"
    strokeWidth="3"
    strokeLinejoin="round"
  />
);

const Book = (
  <g>
    <path d="M14 18h15a5 5 0 0 1 3 1.6A5 5 0 0 1 35 18h15v28H35a4 4 0 0 0-3 1.4A4 4 0 0 0 29 46H14z"
      fill="#F5F0E4" stroke="#2B2B2B" strokeWidth="3" strokeLinejoin="round" />
    <path d="M32 20v27" fill="none" stroke="#2B2B2B" strokeWidth="3" />
    <path d="M19 26h8M19 32h8M37 26h8M37 32h8" stroke="#8A8375" strokeWidth="2.5" strokeLinecap="round" />
  </g>
);

/* -------------------------------------------------------------------------- */

export const STICKERS: Sticker[] = [
  { id: "verstehe", caption: "Ich verstehe!", meaning: "I understand", background: "#FFF4CC", ink: "#7A5A06", art: Bulb },
  { id: "hilfe", caption: "Hilfe!", meaning: "I need help", background: "#FFE3E8", ink: "#A8203A", art: Hand },
  { id: "sehr-gut", caption: "Sehr gut!", meaning: "Very good", background: "#FFF7D6", ink: "#7A5A06", art: Star },
  { id: "genau", caption: "Genau!", meaning: "Exactly", background: "#E2F7EC", ink: "#136F45", art: Tick },
  { id: "was", caption: "Wie bitte?", meaning: "Sorry, what?", background: "#ECE7FF", ink: "#4B32B3", art: Question },
  { id: "danke", caption: "Danke!", meaning: "Thank you", background: "#FFE7EC", ink: "#A8203A", art: Heart },
  { id: "pruefung", caption: "Prüfung!", meaning: "Exam time", background: "#EAF2FF", ink: "#1D4E89", art: Book },
];

const byId = new Map(STICKERS.map((sticker) => [sticker.id, sticker]));

export function stickerById(id: string | null | undefined): Sticker | null {
  return id ? byId.get(id) ?? null : null;
}

export function isStickerId(id: unknown): boolean {
  return typeof id === "string" && byId.has(id);
}

/**
 * One sticker, drawn.
 *
 * `size` is the whole tile; the art and the caption scale from it, so the tray
 * and the bubble use the same component at two sizes rather than two layouts
 * that drift apart.
 */
export function StickerArt({
  sticker,
  size = 112,
  className = "",
}: {
  sticker: Sticker;
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex flex-col items-center justify-center rounded-2xl ${className}`}
      style={{
        width: size,
        height: size,
        background: sticker.background,
        // A hairline edge so a pale sticker still reads as an object on a pale
        // bubble, in either theme.
        boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.12)",
      }}
      role="img"
      aria-label={`${sticker.caption} — ${sticker.meaning}`}
    >
      <svg viewBox="0 0 64 64" width={size * 0.56} height={size * 0.56} aria-hidden="true">
        {sticker.art}
      </svg>
      <span
        className="mt-0.5 px-1 text-center font-extrabold leading-none"
        style={{ color: sticker.ink, fontSize: Math.max(9, size * 0.115) }}
      >
        {sticker.caption}
      </span>
    </span>
  );
}
