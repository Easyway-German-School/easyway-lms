/**
 * The reaction set, shared by the picker and the route that validates it.
 *
 * Deliberately small and fixed. Two reasons, and neither is laziness:
 *
 *   A reaction is a user-supplied string rendered into everybody else's chat,
 *   so an open field is a way to put arbitrary text in front of a whole cohort.
 *   A closed set makes that impossible rather than filtered.
 *
 *   And a picker with two thousand emoji is a search box. The gesture that
 *   makes reactions feel alive is one tap on a row that is already on screen —
 *   which only works if the row is short enough to be a row.
 *
 * Chosen for a language classroom rather than a group chat: the first four are
 * the usual social ones, and the last three are the ones a student actually
 * wants — "that helped", "I had this question too", "correct".
 */
export const ALLOWED_REACTIONS = ["👍", "❤️", "😂", "🔥", "🙏", "🤔", "✅"] as const;

export type Reaction = (typeof ALLOWED_REACTIONS)[number];

/** One reaction as the bubble renders it. */
export type ReactionSummary = {
  emoji: string;
  count: number;
  /** Whether the reader is one of the people in `count`. Drives the toggle. */
  mine: boolean;
};
