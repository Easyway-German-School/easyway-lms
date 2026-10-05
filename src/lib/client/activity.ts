/**
 * Is a human actually at this tab?
 *
 * A tab can be visible and abandoned: the laptop lid is up, the phone sits on a
 * desk with the screen on, the portal was left open all afternoon. Every
 * background poll keeps running for it, and each one is a billed serverless
 * request. `visibilityState` cannot tell that tab from a busy one, so this
 * watches for real input instead.
 *
 * Only the BACKGROUND chatter should back off (badges, typing dots, popups).
 * Anything where the person is legitimately watching without touching the
 * screen, such as a live class, must not use these scales.
 */

/** No input for this long: poll a third as often. */
export const IDLE_SLOW_AFTER_MS = 5 * 60_000;
/** No input for this long: stop polling until the person touches the screen. */
export const IDLE_PAUSE_AFTER_MS = 20 * 60_000;
/** How much slower a lightly idle tab polls. */
export const IDLE_SLOW_FACTOR = 3;

const INPUT_EVENTS = ["pointerdown", "pointermove", "keydown", "scroll", "touchstart", "wheel"] as const;

let lastInputAt = Date.now();
let bound = false;
const wakeListeners = new Set<() => void>();

function onInput() {
  const wasPaused = Date.now() - lastInputAt >= IDLE_PAUSE_AFTER_MS;
  lastInputAt = Date.now();
  if (wasPaused) wakeListeners.forEach((listener) => listener());
}

function bind() {
  if (bound || typeof window === "undefined") return;
  bound = true;
  for (const name of INPUT_EVENTS) window.addEventListener(name, onInput, { passive: true, capture: true });
}

/** Milliseconds since the last click, tap, key press or scroll in this tab. */
export function idleForMs(now = Date.now()): number {
  bind();
  return now - lastInputAt;
}

/**
 * What a poll's delay should be multiplied by right now: 1 for an active tab,
 * 3 for one nobody has touched in five minutes, and `null` (do not poll) after
 * twenty. Pure so it can be tested without a browser.
 */
export function idleScale(idleMs: number): number | null {
  if (idleMs >= IDLE_PAUSE_AFTER_MS) return null;
  if (idleMs >= IDLE_SLOW_AFTER_MS) return IDLE_SLOW_FACTOR;
  return 1;
}

/** Runs `listener` the moment a person returns to a tab that had been paused. */
export function onWake(listener: () => void): () => void {
  bind();
  wakeListeners.add(listener);
  return () => {
    wakeListeners.delete(listener);
  };
}
