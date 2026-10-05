/**
 * THE AVATAR — what a student's classmates see instead of a passport photo.
 *
 * The record photo (taken live in the profile, see PhotoCapture) stays exactly
 * what it was: identity, for the office and the tutor. It is the thing that
 * unlocks the portal and it is never shown to other students. The avatar is the
 * separate, playful face for chat, leaderboards and the profile.
 *
 * It is drawn in code from a handful of choices — no image upload, no storage,
 * nothing to moderate — and saved as a few dozen bytes of JSON. Every choice is
 * an index into a list below (or a style name), so a stored config can never
 * carry anything but a value this file already approved: `sanitizeAvatar` snaps
 * whatever it is handed back onto the lists.
 *
 * Pure and client-safe (no I/O), unit-tested without a database.
 */

export const SKIN_TONES = [
  "#F8DDC4",
  "#EDC39B",
  "#D9A072",
  "#BF8153",
  "#9A5F35",
  "#774425",
  "#5A301B",
  "#3E2013",
] as const;

export const HAIR_COLORS = [
  "#17110E",
  "#33200F",
  "#5C3A1E",
  "#8A4B22",
  "#C79A42",
  "#8E959C",
  "#E0508C",
  "#3F73F0",
  "#8B5CF6",
  "#FF7A1A",
] as const;

/** Backdrops are the school's teal and orange first, then the louder colours. */
export const BACKGROUNDS = [
  "#0D7C7E",
  "#FF7A1A",
  "#7C5CFF",
  "#E8556D",
  "#2BB673",
  "#F5B82E",
  "#3B82F6",
  "#1F2A37",
] as const;

export const TOP_COLORS = [
  "#FFFFFF",
  "#1F2937",
  "#0D7C7E",
  "#FF6600",
  "#7C5CFF",
  "#E8556D",
  "#2BB673",
  "#F5B82E",
  "#3B82F6",
  "#9CA3AF",
] as const;

export const HAIR_STYLES = [
  "buzz",
  "fade",
  "afro",
  "puffs",
  "twists",
  "braids",
  "long",
  "bun",
  "headwrap",
  "cap",
  "bald",
] as const;

export const TOP_STYLES = ["tee", "hoodie", "collar", "jersey", "tank", "ankara"] as const;

export const EYE_STYLES = ["round", "happy", "sleepy", "wink", "wide"] as const;
export const BROW_STYLES = ["soft", "straight", "raised", "none"] as const;
export const MOUTH_STYLES = ["smile", "grin", "smirk", "neutral", "tongue"] as const;
export const EXTRAS = ["none", "glasses", "round", "shades", "headphones", "earrings"] as const;

export type HairStyle = (typeof HAIR_STYLES)[number];
export type TopStyle = (typeof TOP_STYLES)[number];
export type EyeStyle = (typeof EYE_STYLES)[number];
export type BrowStyle = (typeof BROW_STYLES)[number];
export type MouthStyle = (typeof MOUTH_STYLES)[number];
export type Extra = (typeof EXTRAS)[number];

export type AvatarConfig = {
  /** Shape version, so the drawing can change one day without orphaning saved avatars. */
  v: 1;
  bg: number;
  skin: number;
  hair: HairStyle;
  hairColor: number;
  eyes: EyeStyle;
  brows: BrowStyle;
  mouth: MouthStyle;
  top: TopStyle;
  topColor: number;
  extra: Extra;
};

const pick = <T,>(list: readonly T[], value: unknown, fallback: T): T =>
  list.includes(value as T) ? (value as T) : fallback;

const index = (length: number, value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value < length ? value : fallback;

/**
 * Turns anything — a request body, an old row, garbage — into a valid avatar.
 * Returns null only when there is nothing avatar-shaped to read at all, so a
 * caller can tell "no avatar yet" from "a slightly broken one".
 */
export function sanitizeAvatar(raw: unknown): AvatarConfig | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const base = hashAvatar("sanitize-fallback");

  return {
    v: 1,
    bg: index(BACKGROUNDS.length, value.bg, base.bg),
    skin: index(SKIN_TONES.length, value.skin, base.skin),
    hair: pick(HAIR_STYLES, value.hair, base.hair),
    hairColor: index(HAIR_COLORS.length, value.hairColor, base.hairColor),
    eyes: pick(EYE_STYLES, value.eyes, base.eyes),
    brows: pick(BROW_STYLES, value.brows, base.brows),
    mouth: pick(MOUTH_STYLES, value.mouth, base.mouth),
    top: pick(TOP_STYLES, value.top, base.top),
    topColor: index(TOP_COLORS.length, value.topColor, base.topColor),
    extra: pick(EXTRAS, value.extra, base.extra),
  };
}

/** FNV-1a — small, stable, no dependencies. The same name always gives the same number. */
function fnv(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** A small deterministic stream of numbers from one seed. */
function stream(seed: string) {
  let state = fnv(seed) || 1;
  return (max: number) => {
    // xorshift32
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state % max;
  };
}

function build(next: (max: number) => number): AvatarConfig {
  return {
    v: 1,
    bg: next(BACKGROUNDS.length),
    skin: next(SKIN_TONES.length),
    hair: HAIR_STYLES[next(HAIR_STYLES.length)],
    // Natural colours are four times likelier than the loud ones: most random
    // avatars should look like a person, with a pink wig as the happy accident.
    hairColor: next(5) === 0 ? 5 + next(5) : next(5),
    eyes: EYE_STYLES[next(EYE_STYLES.length)],
    brows: BROW_STYLES[next(BROW_STYLES.length)],
    mouth: MOUTH_STYLES[next(MOUTH_STYLES.length - 1)],
    top: TOP_STYLES[next(TOP_STYLES.length)],
    topColor: next(TOP_COLORS.length),
    // Half of all avatars wear nothing extra — accessories should feel chosen.
    extra: next(2) === 0 ? "none" : EXTRAS[1 + next(EXTRAS.length - 1)],
  };
}

/**
 * The avatar a student has before they make one: stable per name, so a
 * classmate with no avatar yet still has a face in the chat instead of a grey
 * circle — and it does not change between visits.
 */
export function hashAvatar(seed: string): AvatarConfig {
  return build(stream(seed || "easyway"));
}

/** The shuffle button. */
export function randomAvatar(): AvatarConfig {
  return build(stream(`${Date.now()}-${Math.random()}`));
}

/** Stored avatar, or the stable default for this person. */
export function avatarOrDefault(config: unknown, seed: string): AvatarConfig {
  return sanitizeAvatar(config) ?? hashAvatar(seed);
}
