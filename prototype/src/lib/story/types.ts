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
  /** Both real, valid German responses — this is flavor branching, not a right/wrong fork. */
  next: string;
  /** One-line reaction shown before the next beat plays. */
  flavorNote?: string;
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

export type StoryChapter = {
  id: string;
  goalId: GoalId;
  title: string;
  synopsis: string;
  characters: StoryCharacter[];
  sceneOrder: string[];
  scenes: Record<string, StoryScene>;
};
