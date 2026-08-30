import type { GoalId } from "@/lib/germany-goals";

/**
 * Content model for the personalized visual-novel story feature.
 *
 * Pure data types only — no DB or React imports, same discipline as
 * germany-goals.ts, because a `StoryChapter` is curated narrative content
 * checked into the repo, not something computed per request.
 */

export type CharacterId = string;
export type ExpressionKey = "neutral" | "warm" | "concerned" | "pleased" | "serious" | "tired";

export type StoryCharacter = {
  id: CharacterId;
  name: string;
  /** Shown under the name in the dialogue box, e.g. "Supervising nurse". */
  role: string;
  /** public/ paths, keyed by expression. Missing expressions fall back to defaultExpression's art. */
  portraits: Partial<Record<ExpressionKey, string>>;
  defaultExpression: ExpressionKey;
};

type BeatBase = {
  id: string;
  /** Next beat id in this scene, or null when this beat ends the scene. */
  next: string | null;
};

export type LineBeat = BeatBase & {
  type: "line";
  speakerId: CharacterId;
  expression: ExpressionKey;
  text: string;
  translation?: string;
  /** Higher-trust rewrites of this line, checked highest-first. See LineVariant. */
  variants?: LineVariant[];
};

export type YourLineBeat = BeatBase & {
  type: "yourLine";
  /** Who this line is addressed to — drives which portrait is highlighted. */
  speakerId: CharacterId;
  targetPhrase: string;
  translation?: string;
};

export type ChoiceOption = {
  id: string;
  text: string;
  translation?: string;
  /**
   * Both real, valid German responses — neither is "wrong". They may point at
   * the same next beat or genuinely diverge into a different short run of
   * beats before the scene reconverges; either is fine, this is not a
   * pass/fail fork.
   */
  next: string;
  /** One-line reaction shown before the next beat plays. */
  flavorNote?: string;
  /**
   * How this choice moves the needle with the character it was said to,
   * clamped to 0-100 on a 0-100 relationship scale that persists across the
   * whole series (not just this episode). Omit for choices that are pure
   * flavor with no relationship weight.
   */
  trustDelta?: number;
};

/**
 * A relationship-gated alternative reading of a `line` beat. The engine picks
 * the highest `minTrust` variant the player currently qualifies for against
 * `speakerId`'s trust score, falling back to the beat's own base text when no
 * variant qualifies (including for a first playthrough with no history at
 * all). This is how a character can visibly remember how you've treated them
 * without branching the scene graph itself.
 */
export type LineVariant = {
  minTrust: number;
  text: string;
  translation?: string;
  expression?: ExpressionKey;
};

export type ChoiceBeat = BeatBase & {
  type: "choice";
  speakerId: CharacterId;
  prompt?: string;
  /** Exactly two options — both may point at the same next beat (branch, then reconverge). */
  options: [ChoiceOption, ChoiceOption];
  next: null;
};

export type WriteBeat = BeatBase & {
  type: "write";
  prompt: string;
  promptGerman?: string;
  minWords: number;
  /** Grading-only reference answer — stripped before the beat is sent to the client. */
  exampleAnswer?: string;
};

export type StoryBeat = LineBeat | YourLineBeat | ChoiceBeat | WriteBeat;

export type StoryScene = {
  id: string;
  title: string;
  /** public/ path. */
  background: string;
  startBeatId: string;
  beats: Record<string, StoryBeat>;
};

/**
 * Picks what a `line` beat should actually render for this player: the
 * highest-`minTrust` variant they currently qualify for against the beat's
 * speaker (from the series-wide relationships map), or the beat's own base
 * text/expression when nothing qualifies — a first playthrough, or a beat
 * with no variants at all. Pure and side-effect-free so both the client
 * component and any future server-side use can call it the same way.
 */
export function pickLineVariant(
  relationships: Record<CharacterId, number>,
  beat: LineBeat,
): { text: string; translation?: string; expression: ExpressionKey } {
  const trust = relationships[beat.speakerId] ?? 50;
  const qualifying = (beat.variants ?? [])
    .filter((variant) => trust >= variant.minTrust)
    .sort((a, b) => b.minTrust - a.minTrust)[0];
  if (!qualifying) return { text: beat.text, translation: beat.translation, expression: beat.expression };
  return { text: qualifying.text, translation: qualifying.translation ?? beat.translation, expression: qualifying.expression ?? beat.expression };
}

export type StoryChapter = {
  id: string;
  goalId: GoalId;
  title: string;
  synopsis: string;
  characters: StoryCharacter[];
  sceneOrder: string[];
  scenes: Record<string, StoryScene>;
};
