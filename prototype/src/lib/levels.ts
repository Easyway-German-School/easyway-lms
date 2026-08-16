/**
 * Every level that can EXIST on a record.
 *
 * Deliberately still six. Students have sat C1 and C2, certificates have been
 * issued for them, and results rows point at them — so dropping either from
 * this list would not stop the school offering them, it would orphan the
 * history of the ones who already did. What the school currently SELLS and
 * what it DRAWS are narrower, and are their own lists below.
 */
export const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
export type Level = (typeof LEVELS)[number];

/**
 * Levels a student can be enrolled into today.
 *
 * C2 is not taught, so it must not appear on the sign-up form, in the sittings
 * editor, or as a community room — an empty room for a class that does not run
 * is a room students ask about. Existing C2 records keep working because
 * `LEVELS` above still knows the level.
 */
export const OFFERED_LEVELS = ["A1", "A2", "B1", "B2", "C1"] as const;

/**
 * Levels drawn on the journey maps — the poster, the Germany road, the
 * gamified ladder.
 *
 * Stops at B2 on purpose. The maps are the story of the course the school
 * runs for essentially everybody, and ending them on a level almost nobody
 * reaches made the road look longer than the one a student actually signed up
 * for. Note this is a DRAWING decision, not a teaching one: C1 is still sold
 * and still taught, and a goal whose text says a German-taught degree needs C1
 * still says so.
 */
export const JOURNEY_LEVELS = ["A1", "A2", "B1", "B2"] as const;

/** The last level any journey map draws. */
export const JOURNEY_TOP_LEVEL = JOURNEY_LEVELS[JOURNEY_LEVELS.length - 1];

/**
 * A level as the journey maps should treat it.
 *
 * Anything above the drawn range clamps to the top rather than falling off.
 * That case is real and not hypothetical: students are sitting C1 right now,
 * and an index lookup against the shortened ladder returns -1 for them — which
 * would have quietly drawn their road as though they were back at A1 and left
 * them off their own map. Clamping puts them on the final node instead.
 */
export function journeyLevelFor(level: string | null | undefined): string {
  const wanted = String(level ?? "A1").trim().toUpperCase();
  const drawn = JOURNEY_LEVELS as readonly string[];
  if (drawn.includes(wanted)) return wanted;

  const all = LEVELS as readonly string[];
  // Above the drawn range (C1, C2) clamps to the top; anything unrecognised
  // starts at the bottom, which is where an unknown level was already treated
  // as being.
  return all.indexOf(wanted) > all.indexOf(JOURNEY_TOP_LEVEL) ? JOURNEY_TOP_LEVEL : drawn[0];
}

/**
 * How long one level runs. Lives here rather than in `promotion.ts` because
 * client code needs it too (the checkout spreads the fee over the teaching
 * weeks) and `promotion.ts` imports prisma, which cannot cross into the browser.
 */
export const SESSION_MONTHS = 2;

/** Weeks of teaching in one level, used to express tuition per week. */
export const WEEKS_OF_TEACHING = SESSION_MONTHS * 4;

/** The level a student moves up to after this one. C2 is the end of the ladder. */
export function nextLevelAfter(level: string): string | null {
  const i = (LEVELS as readonly string[]).indexOf((level || "A1").toUpperCase());
  if (i === -1 || i === LEVELS.length - 1) return null;
  return LEVELS[i + 1];
}
