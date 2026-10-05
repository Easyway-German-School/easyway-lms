import { idleForMs, idleScale, onWake } from "@/lib/client/activity";

/**
 * A polling loop that behaves itself.
 *
 * The community chat, the help desk and the typing feed all need "ask the
 * server again in a few seconds" and all had the same three rules hand-written:
 *
 *   1. Reschedule AFTER the response, never on a fixed interval. On a bad
 *      mobile connection a slow response would otherwise stack requests, which
 *      is exactly when stacking hurts most.
 *   2. Do nothing while the tab is hidden, and catch up the instant it is
 *      visible again — nobody is watching, and a phone in a pocket should not
 *      keep the radio busy.
 *   3. Back off when the server is unhappy, and return to normal when it is not.
 *   4. Back off when nobody is touching the tab (lib/client/activity.ts): a third
 *      as often after five idle minutes, and not at all after twenty until the
 *      person returns. Pass `idle: false` where watching IS the job (the office
 *      queue).
 *
 * `task` should throw (or reject) on a failed request so rule 3 can see it.
 * Returns a function that stops the loop.
 */
export function startPolling(
  task: () => Promise<unknown>,
  opts: { intervalMs: number | (() => number); immediate?: boolean; idle?: boolean },
): () => void {
  let cancelled = false;
  let timer: number | undefined;
  let failures = 0;
  let parked = false;

  const nextDelay = () => {
    const configured = typeof opts.intervalMs === "function" ? opts.intervalMs() : opts.intervalMs;
    const base = configured * (opts.idle === false ? 1 : (idleScale(idleForMs()) ?? 1));
    return failures ? Math.min(base * 2 ** Math.min(failures, 4), 30_000) : base;
  };

  const schedule = () => {
    if (cancelled) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(run, nextDelay());
  };

  async function run() {
    if (cancelled) return;
    // Hidden: stop scheduling. `onVisible` restarts the loop.
    if (document.visibilityState !== "visible") return;
    // Abandoned tab: park until a person touches it, then catch up at once.
    if (opts.idle !== false && idleScale(idleForMs()) === null) {
      parked = true;
      return;
    }
    try {
      await task();
      failures = 0;
    } catch {
      failures += 1;
    }
    schedule();
  }

  const onVisible = () => {
    if (cancelled || document.visibilityState !== "visible") return;
    window.clearTimeout(timer);
    void run();
  };
  document.addEventListener("visibilitychange", onVisible);
  const stopWake = onWake(() => {
    if (cancelled || !parked) return;
    parked = false;
    window.clearTimeout(timer);
    void run();
  });

  if (opts.immediate === false) schedule();
  else void run();

  return () => {
    cancelled = true;
    window.clearTimeout(timer);
    document.removeEventListener("visibilitychange", onVisible);
    stopWake();
  };
}
