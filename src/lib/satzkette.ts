import { germanNormalise } from "@/lib/assignments";

/**
 * Satzkette — the story a class writes one sentence at a time.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS FOR
 * ---------------------------------------------------------------------------
 * Everything else in this portal tests whether a student can *recognise* the
 * right German: pick the option, tick the box, beat the countdown. None of it
 * asks them to produce a sentence of their own, which is the thing they are
 * actually here to learn and the thing that is hardest to practise alone.
 *
 * A Satzkette asks for exactly one sentence, from one student, under one rule —
 * and then hands the story to the next person. It is small enough to do on a
 * phone between classes and public enough that the sentence gets read by people
 * whose opinion the writer cares about, which raises effort in a way a mark out
 * of ten does not.
 *
 * ---------------------------------------------------------------------------
 * THE TWO RULES THAT SHAPE EVERYTHING
 * ---------------------------------------------------------------------------
 * 1. A TURN IS OFFERED, NOT OWNED. It is aimed at one named student, because a
 *    turn owed to nobody is a turn nobody feels. But once the deadline passes
 *    it opens to the whole cohort rather than skipping, so one student who is
 *    ill cannot end the story. See `model GameTurn` in schema.prisma.
 *
 * 2. A CONSTRAINT IS ONLY ENFORCED IF IT CAN HONESTLY BE CHECKED. This file
 *    can verify that a sentence contains a word; it cannot verify that a
 *    sentence uses the dative, because that needs a parser this project does
 *    not have and will not pretend to. Unverifiable constraints are shown as
 *    guidance and marked for the tutor. The alternative — a regex that is right
 *    most of the time — would reject correct German in front of the writer's
 *    whole class, which is the single fastest way to kill the feature.
 */

/* -------------------------------------------------------------------------- */
/* Timing                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * How long a turn stays exclusive to the student it was offered to.
 *
 * A day, because these students are in class for part of it and on a phone for
 * the rest, and a shorter window would hand most turns to whoever happens to be
 * online rather than to whoever was asked. Long enough to be fair; short enough
 * that a story still moves several times a week.
 */
export const TURN_EXCLUSIVE_MS = 24 * 60 * 60_000;

/**
 * How long a story waits on an OPEN turn before the whole thing is called done.
 *
 * A chain nobody has picked up in three days is finished whatever its row says,
 * and leaving it "active" forever means the Games tab slowly fills with corpses
 * that each still claim to be waiting for somebody.
 */
export const MATCH_ABANDONED_AFTER_MS = 3 * 24 * 60 * 60_000;

/* -------------------------------------------------------------------------- */
/* Shape of a sentence                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The floor is deliberately low and the ceiling deliberately near.
 *
 * One sentence is the unit. A student who writes a paragraph has taken the next
 * three people's turns as well as their own, and a student who writes "Ja."
 * has not practised anything. Neither is worth a hard argument, so the limits
 * sit just outside what a real attempt looks like rather than policing style.
 */
export const MIN_SENTENCE_CHARS = 8;
export const MAX_SENTENCE_CHARS = 240;

/* -------------------------------------------------------------------------- */
/* Constraints                                                                */
/* -------------------------------------------------------------------------- */

/** Must contain every one of these words. Checkable. */
export type VocabConstraint = {
  rule: "vocab";
  words: string[];
};

/** Must contain this literal fragment — `weil`, `obwohl`, `zu Hause`. Checkable. */
export type PatternConstraint = {
  rule: "pattern";
  pattern: string;
  label: string;
};

/** Must be at least this many words. Checkable. */
export type LengthConstraint = {
  rule: "length";
  minWords: number;
};

/**
 * A grammatical instruction — "use the dative", "put it in the perfect tense".
 *
 * NOT checkable, and typed separately so that is impossible to forget. The
 * `label` is shown to the student as the rule for their turn and travels with
 * the turn to the tutor's review screen; nothing in this file decides whether
 * it was obeyed.
 */
export type GrammarConstraint = {
  rule: "grammar";
  label: string;
};

export type Constraint =
  | VocabConstraint
  | PatternConstraint
  | LengthConstraint
  | GrammarConstraint;

/** True when this project can actually verify the rule it states. */
export function isCheckable(constraint: Constraint): boolean {
  return constraint.rule !== "grammar";
}

/** The line a student reads above the box, in their own language. */
export function constraintLabel(constraint: Constraint): string {
  switch (constraint.rule) {
    case "vocab":
      return constraint.words.length === 1
        ? `Use the word "${constraint.words[0]}"`
        : `Use these words: ${constraint.words.join(", ")}`;
    case "pattern":
      return constraint.label;
    case "length":
      return `Write at least ${constraint.minWords} words`;
    case "grammar":
      return constraint.label;
  }
}

export function parseConstraint(value: unknown): Constraint | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;

  switch (raw.rule) {
    case "vocab": {
      const words = Array.isArray(raw.words)
        ? raw.words.filter((word): word is string => typeof word === "string" && word.trim() !== "")
        : [];
      return words.length > 0 ? { rule: "vocab", words } : null;
    }
    case "pattern": {
      if (typeof raw.pattern !== "string" || raw.pattern.trim() === "") return null;
      return {
        rule: "pattern",
        pattern: raw.pattern,
        label: typeof raw.label === "string" ? raw.label : `Use "${raw.pattern}"`,
      };
    }
    case "length": {
      const minWords = typeof raw.minWords === "number" ? Math.floor(raw.minWords) : 0;
      return minWords > 0 ? { rule: "length", minWords } : null;
    }
    case "grammar": {
      if (typeof raw.label !== "string" || raw.label.trim() === "") return null;
      return { rule: "grammar", label: raw.label };
    }
    default:
      return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Checking a sentence                                                        */
/* -------------------------------------------------------------------------- */

export type CheckResult = {
  ok: boolean;
  /** Shown to the writer when `ok` is false. Empty otherwise. */
  problem: string;
  /**
   * True when the turn carried a rule nothing here could verify, so the tutor's
   * review screen knows to look rather than assume.
   */
  needsReview: boolean;
};

function words(sentence: string): string[] {
  return sentence.trim().split(/\s+/).filter(Boolean);
}

/**
 * Does the sentence contain this word as a word, rather than inside another?
 *
 * Normalised through `germanNormalise` on both sides, so a student who typed
 * `Schloss` satisfies a constraint written `Schloß`, and one who typed `gruen`
 * satisfies `grün`. That is the same standard the marker uses everywhere else
 * in this codebase, which matters: a word that counts as correct on Friday's
 * quiz must count here too.
 *
 * The boundary check is deliberately not `\b`. German compounds mean `Haus`
 * genuinely appears inside `Hausaufgabe`, and a student who wrote the compound
 * has used a different word than the one they were asked for.
 */
function containsWord(sentence: string, word: string): boolean {
  const haystack = germanNormalise(sentence, false);
  const needle = germanNormalise(word, false);
  if (!needle) return false;

  return haystack
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .includes(needle);
}

/**
 * Is this sentence an acceptable turn?
 *
 * Refusals are written as instructions rather than verdicts — "this needs the
 * word X" rather than "invalid" — because the student reading them is being
 * corrected in a game their classmates can see, and the tone of that moment
 * decides whether they take another turn.
 */
export function checkSentence(sentence: string, constraint: Constraint | null): CheckResult {
  const trimmed = sentence.trim();

  if (trimmed.length < MIN_SENTENCE_CHARS) {
    return {
      ok: false,
      problem: "That is a little short — write a full sentence.",
      needsReview: false,
    };
  }

  if (trimmed.length > MAX_SENTENCE_CHARS) {
    return {
      ok: false,
      problem: "One sentence per turn — this is long enough to be two.",
      needsReview: false,
    };
  }

  if (!constraint) return { ok: true, problem: "", needsReview: false };

  switch (constraint.rule) {
    case "vocab": {
      const missing = constraint.words.filter((word) => !containsWord(trimmed, word));
      if (missing.length > 0) {
        return {
          ok: false,
          problem:
            missing.length === 1
              ? `Your turn needs the word "${missing[0]}".`
              : `Your turn still needs: ${missing.join(", ")}.`,
          needsReview: false,
        };
      }
      return { ok: true, problem: "", needsReview: false };
    }

    case "pattern": {
      const has = germanNormalise(trimmed, false).includes(
        germanNormalise(constraint.pattern, false),
      );
      return has
        ? { ok: true, problem: "", needsReview: false }
        : { ok: false, problem: `Your turn needs "${constraint.pattern}".`, needsReview: false };
    }

    case "length": {
      const count = words(trimmed).length;
      return count >= constraint.minWords
        ? { ok: true, problem: "", needsReview: false }
        : {
            ok: false,
            problem: `A few more words — this turn asks for at least ${constraint.minWords}.`,
            needsReview: false,
          };
    }

    // Accepted without inspection, and flagged. See the header: guessing at
    // grammar with a regex would reject correct German publicly, which costs
    // far more than an unchecked turn does.
    case "grammar":
      return { ok: true, problem: "", needsReview: true };
  }
}

/* -------------------------------------------------------------------------- */
/* Whose turn                                                                 */
/* -------------------------------------------------------------------------- */

export type TurnState = "pending" | "open" | "submitted";

/**
 * What a turn's state should be right now.
 *
 * The stored `status` is what the app reads, but it only changes when something
 * writes to it, and nothing writes to a row at the moment its deadline passes.
 * So every read runs it past this: a turn whose deadline has gone is open,
 * whether or not any job has got round to saying so yet.
 */
export function effectiveState(
  turn: { status: string; deadline: Date; submittedAt: Date | null },
  now: Date = new Date(),
): TurnState {
  if (turn.submittedAt) return "submitted";
  return turn.deadline.getTime() <= now.getTime() ? "open" : "pending";
}

/** May this person write this turn? */
export function canPlay(
  turn: { status: string; deadline: Date; submittedAt: Date | null; assignedToId: string },
  userId: string,
  now: Date = new Date(),
): boolean {
  const state = effectiveState(turn, now);
  if (state === "submitted") return false;
  if (state === "open") return true;
  return turn.assignedToId === userId;
}

/**
 * Who to offer the next turn to.
 *
 * Whoever in the cohort has gone longest without one, with a stable tiebreak so
 * the same order does not depend on how the rows came back. Least-recent rather
 * than round-robin because a roster is not stable — students join a class mid
 * level and others stop coming, and a fixed rotation built at match creation
 * would keep offering turns to somebody who left in week two.
 */
export function nextAssignee(
  roster: Array<{ userId: string; lastTurnAt: Date | null }>,
  excludeUserId?: string,
): string | null {
  const eligible = roster.filter((member) => member.userId !== excludeUserId);
  if (eligible.length === 0) return null;

  const sorted = [...eligible].sort((a, b) => {
    const aTime = a.lastTurnAt?.getTime() ?? 0;
    const bTime = b.lastTurnAt?.getTime() ?? 0;
    if (aTime !== bTime) return aTime - bTime;
    return a.userId.localeCompare(b.userId);
  });

  return sorted[0].userId;
}

/* -------------------------------------------------------------------------- */
/* Reading the story                                                          */
/* -------------------------------------------------------------------------- */

export type StorySentence = {
  position: number;
  sentence: string;
  authorId: string;
  authorName: string;
  constraintLabel: string | null;
};

/** The story so far, in order, ready to render. */
export function assembleStory(
  turns: Array<{
    position: number;
    sentence: string | null;
    playerId: string | null;
    player: { name: string | null } | null;
    constraint: unknown;
  }>,
): StorySentence[] {
  return turns
    .filter((turn) => turn.sentence && turn.playerId)
    .sort((a, b) => a.position - b.position)
    .map((turn) => {
      const constraint = parseConstraint(turn.constraint);
      return {
        position: turn.position,
        sentence: turn.sentence as string,
        authorId: turn.playerId as string,
        authorName: turn.player?.name ?? "A classmate",
        constraintLabel: constraint ? constraintLabel(constraint) : null,
      };
    });
}
