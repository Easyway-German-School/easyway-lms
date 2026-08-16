"use client";

/**
 * One thing at a time.
 *
 * ---------------------------------------------------------------------------
 * THE PROBLEM THIS EXISTS TO FIX
 *
 * The student dashboard grew six independent interruptions, each of which was
 * written correctly on its own terms and each of which decided for itself when
 * to appear. On a first login after a payment, a student could meet: a payment
 * toast, the welcome tour, the level-advance celebration, the daily journey
 * moment and the level-poster reminder — all inside two seconds, stacked, with
 * whichever had the highest z-index on top. The one that won was decided by
 * fetch latency.
 *
 * Two of those interruptions are worth having. Five at once are worth nothing,
 * because a person who meets five modals learns, permanently and correctly,
 * that the first thing to do on this dashboard is close things without reading
 * them. That habit is not recoverable later, when the modal actually matters.
 *
 * ---------------------------------------------------------------------------
 * THE ORDER, AND WHY IT IS THAT ORDER
 *
 * Not by importance to the school. By what a person can actually receive, in
 * the order they can receive it:
 *
 *   100  CLOSURE.      "Your payment went through." An action someone just
 *                      took and has not yet been told the result of occupies
 *                      their whole attention. Nothing else lands until it is
 *                      answered, so it is answered first — and it is a toast,
 *                      not a modal, because closure does not need a decision.
 *
 *    90  ORIENTATION.  The welcome tour. Somebody who does not know where they
 *                      are cannot evaluate anything you show them. This is
 *                      also why it is the only interruption allowed to be
 *                      long: it is the one that makes the others legible.
 *
 *    80  IDENTITY.     "Why German?" Asked immediately after orientation and
 *                      before any request. A stated goal is the cheapest and
 *                      most durable commitment in the product, and everything
 *                      after it reads as personal rather than promotional.
 *                      Asking it before orientation makes it an interrogation;
 *                      asking it after a sales message makes it a sales
 *                      technique.
 *
 *    70  EARNED NEWS.  "Your level is complete." News about THEM, which beats
 *                      anything about us — but it must not preempt the tour,
 *                      because a celebration you cannot place is confusing
 *                      rather than pleasant.
 *
 *    50  MOTIVATION.   The daily journey moment. Recurring, so it can always
 *                      wait for a quieter day; that is precisely what makes it
 *                      safe to show every day.
 *
 *    30  DECORATION.   The level poster. Lovely. Never urgent.
 *
 *     —  COMMERCE goes LAST, always, and on this dashboard it is not in this
 *        queue at all: the tuition balance is a permanent inline band, not an
 *        interruption. Asking for money before acknowledging what somebody has
 *        already done is the single fastest way to teach them to dismiss you.
 *
 * ---------------------------------------------------------------------------
 * THE RULES
 *
 *   ONE AT A TIME. There is never a second overlay open behind the first.
 *
 *   A HANDOVER GAP. When one closes, the next waits ~600ms. Without the gap a
 *   modal closing and another opening in the same frame reads as a single
 *   modal changing its mind, and people tap the second one away with the
 *   muscle memory of the first. The gap is what makes two modals read as two
 *   deliberate things rather than a machine gun.
 *
 *   TWO MODALS A VISIT, MAXIMUM. The third good idea does not get to be an
 *   interruption. This is the rule that actually holds the line — an ordering
 *   with no cap is still six modals, politely queued.
 *
 *   NOTHING IS LOST, IT IS DEFERRED. Whatever does not get shown goes to a
 *   small dock the student can open when they choose. That is what makes the
 *   cap honest instead of a silent drop, and it turns an interruption into an
 *   invitation, which is the whole trade.
 *
 *   DISMISSING IS AN ANSWER. Once released, a moment does not come back this
 *   visit, whether it was read or closed. Each moment still owns its own
 *   longer-term memory (a server stamp, a localStorage key) — this queue is
 *   about one page-visit, not about whether a thing is due at all.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
/* eslint-disable react-hooks/exhaustive-deps -- the action callbacks are
   deliberately stable for the life of the provider; see the note on Actions. */

export type MomentId =
  | "payment-success"
  | "welcome-tour"
  | "goal"
  | "level-advance"
  | "notifications"
  | "journey"
  | "poster"
  | "game-turn";

type Kind = "toast" | "modal";

type Definition = {
  priority: number;
  kind: Kind;
  /** What the dock calls it if this one gets deferred. */
  dockLabel: string;
  dockBlurb: string;
};

const MOMENTS: Record<MomentId, Definition> = {
  "payment-success": {
    priority: 100,
    kind: "toast",
    dockLabel: "Payment confirmed",
    dockBlurb: "Your last payment went through.",
  },
  "welcome-tour": {
    priority: 90,
    kind: "modal",
    dockLabel: "Show me around",
    dockBlurb: "The forty-second walk through your portal.",
  },
  goal: {
    priority: 80,
    kind: "modal",
    dockLabel: "Why German?",
    dockBlurb: "One question, and your map redraws around the answer.",
  },
  "level-advance": {
    priority: 70,
    kind: "modal",
    dockLabel: "Your level is complete",
    dockBlurb: "What you finished, and what comes next.",
  },
  /**
   * Asking for notification permission, and where it sits.
   *
   * BELOW the tour and the goal question on purpose. A permission prompt is a
   * request; the tour and the map are gifts. Asking before giving is how an
   * app trains someone to say no on reflex, and the browser only lets you ask
   * once — a refusal is close to permanent and cannot be re-prompted.
   *
   * ABOVE the journey and poster because those two are pleasant rather than
   * load-bearing, and this one decides whether the student ever hears about
   * the next class at all.
   *
   * In practice the two-modal cap means a brand new student sees the tour and
   * the goal question on day one, and this waits in the dock until day two —
   * by which point they have used the thing and the ask makes sense. That is
   * the intended sequence, not an accident of the cap.
   */
  notifications: {
    priority: 60,
    kind: "modal",
    dockLabel: "Turn on reminders",
    dockBlurb: "So you hear about class and new material without opening the app.",
  },
  journey: {
    priority: 50,
    kind: "modal",
    dockLabel: "Today on your road",
    dockBlurb: "Where you are on the way to Germany.",
  },
  poster: {
    priority: 30,
    kind: "modal",
    dockLabel: "Your level map",
    dockBlurb: "The printed journey map for your level.",
  },
  /**
   * "Someone needs a sentence from you." Below the journey moment because it
   * is peer-driven rather than about the student's own progress, and above
   * the poster because a person is actually waiting, not just a picture.
   * `modal` rather than `toast`: unlike a payment confirmation this asks for
   * a decision (play now or later), so it counts against the visit's cap and
   * survives being deferred to the dock instead of vanishing on a timer.
   */
  "game-turn": {
    priority: 40,
    kind: "modal",
    dockLabel: "Your turn is waiting",
    dockBlurb: "Your class is writing a story and it's your turn to add a line.",
  },
};

/** Modals per page visit. The third good idea waits in the dock. */
const MAX_MODALS = 2;

/** The pause between one moment closing and the next opening. */
const HANDOVER_MS = 620;

/**
 * THE OPENING BELL — the quiet fix that makes the ordering real.
 *
 * Every moment learns it is due from its own fetch, and those land in whatever
 * order the network feels like. Granting the first turn to the first claim
 * means the priority table describes nothing at all: on the very first test of
 * this queue the goal question (80) opened ahead of the welcome tour (90),
 * purely because `/api/student/journey` came back before
 * `/api/student/onboarding`.
 *
 * So nobody gets a turn until the claims have stopped arriving for a beat. The
 * window RESTARTS on each new claim, up to a hard ceiling — a slow connection
 * where four requests trickle in over two seconds still gets them ranked,
 * while a broken endpoint that never answers cannot hold the whole queue shut.
 */
const SETTLE_MS = 450;
const SETTLE_CEILING_MS = 2600;

/**
 * Fired by anything that must own the screen outright — today, only an incoming
 * live class. `detail.active` true silences the queue; false hands it back.
 * An event rather than a context method so a component rendered ALONGSIDE the
 * provider (not inside it) can still say so.
 */
export const MOMENT_PREEMPT_EVENT = "easyway:moment-preempt";

/* -------------------------------------------------------------------------- */
/* The director                                                               */
/* -------------------------------------------------------------------------- */

/**
 * TWO CONTEXTS, NOT ONE, and the split is load-bearing.
 *
 * `Actions` never changes identity for the life of the provider; `State`
 * changes on every grant and release. Handing components a single object
 * containing both means every `close` callback they build is rebuilt whenever
 * anything in the queue moves — which silently restarted the payment toast's
 * five-second dismissal timer on each change, so a toast could sit on screen
 * indefinitely and hold the next moment behind it.
 */
type Actions = {
  /** "I am due." Called when a component learns it has something to show. */
  claim: (id: MomentId) => void;
  /** "I am no longer due." Withdraws a claim without counting as shown. */
  withdraw: (id: MomentId) => void;
  /** "I am finished." Counts against the cap and starts the handover. */
  release: (id: MomentId) => void;
  /** Open a deferred moment on demand. Never counts against the cap. */
  summon: (id: MomentId) => void;
};

type State = {
  active: MomentId | null;
  /** Everything that was due and did not get a turn. */
  deferred: Array<{ id: MomentId } & Definition>;
};

const ActionsContext = createContext<Actions | null>(null);
const StateContext = createContext<State>({ active: null, deferred: [] });

export function MomentQueueProvider({ children }: { children: ReactNode }) {
  const [claimed, setClaimed] = useState<Set<MomentId>>(() => new Set());
  const [done, setDone] = useState<Set<MomentId>>(() => new Set());
  const [active, setActive] = useState<MomentId | null>(null);
  const [modalsShown, setModalsShown] = useState(0);
  const [holding, setHolding] = useState(false);
  /** A moment the student asked for. Ignores the cap and jumps the queue. */
  const [summoned, setSummoned] = useState<MomentId | null>(null);

  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  /** Bumped by every new claim; restarts the settle window. */
  const [claimTick, setClaimTick] = useState(0);
  const [settled, setSettled] = useState(false);

  const claim = useCallback((id: MomentId) => {
    setClaimed((current) => {
      if (current.has(id)) return current;
      setClaimTick((tick) => tick + 1);
      return new Set(current).add(id);
    });
  }, []);

  // Restarts on every claim — see SETTLE_MS.
  useEffect(() => {
    setSettled(false);
    const timer = window.setTimeout(() => setSettled(true), SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [claimTick]);

  // …but never waits forever. An endpoint that hangs must not hold the queue
  // shut for the moments that did answer.
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(true), SETTLE_CEILING_MS);
    return () => window.clearTimeout(timer);
  }, []);

  const withdraw = useCallback((id: MomentId) => {
    setClaimed((current) => {
      if (!current.has(id)) return current;
      const next = new Set(current);
      next.delete(id);
      return next;
    });
    setActive((current) => (current === id ? null : current));
  }, []);

  /**
   * Read outside the updater.
   *
   * `release` used to decide whether it owned the turn from INSIDE
   * `setActive(current => …)`, and start the handover timer in there too.
   * State updaters must be pure — React calls them twice in development and
   * may call them during another component's render — so the handover fired
   * twice and the turn counter could move without a turn having happened.
   */
  const activeRef = useRef<MomentId | null>(null);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  const release = useCallback((id: MomentId) => {
    setDone((current) => (current.has(id) ? current : new Set(current).add(id)));
    setSummoned((current) => (current === id ? null : current));

    if (activeRef.current !== id) return;
    activeRef.current = null;
    setActive(null);

    // Only a turn that actually happened counts against the cap, and only a
    // modal — a toast asks for no decision and does not spend the student's
    // patience the way a modal does.
    if (MOMENTS[id].kind === "modal") setModalsShown((shown) => shown + 1);

    setHolding(true);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setHolding(false), HANDOVER_MS);
  }, []);

  const summon = useCallback((id: MomentId) => {
    // Summoning re-opens something already dismissed, so its "done" mark has
    // to be lifted or the selector will skip it forever.
    setDone((current) => {
      if (!current.has(id)) return current;
      const next = new Set(current);
      next.delete(id);
      return next;
    });
    setSummoned(id);
  }, []);

  /**
   * A RINGING CLASS OUTRANKS THE WHOLE TABLE, and it is not in the table.
   *
   * Everything the queue orders is something that can wait — a tour, a
   * celebration, a poster. An incoming live class cannot: it is happening now,
   * it stops happening, and it is the one interruption where being ten minutes
   * late is the same as never seeing it. Giving it priority 200 would still be
   * wrong, because the cap, the settle window and the handover gap are all
   * built for things that keep. So it sits outside the queue entirely and
   * simply tells the queue to stand down while it is on screen.
   *
   * Not `holding`: holding is the handover gap and expires on a timer. This one
   * clears only when the call does.
   */
  const [preempted, setPreempted] = useState(false);
  useEffect(() => {
    const onPreempt = (event: Event) => {
      setPreempted(Boolean((event as CustomEvent<{ active?: boolean }>).detail?.active));
    };
    window.addEventListener(MOMENT_PREEMPT_EVENT, onPreempt);
    return () => window.removeEventListener(MOMENT_PREEMPT_EVENT, onPreempt);
  }, []);

  /** Whose turn it is. */
  useEffect(() => {
    if (active || holding || preempted) return;
    // Nothing is granted until the claims have stopped arriving — otherwise
    // the priority table ranks nothing but fetch latency.
    if (!settled) return;

    const waiting = [...claimed]
      .filter((id) => !done.has(id))
      .sort((a, b) => MOMENTS[b].priority - MOMENTS[a].priority);

    if (summoned && waiting.includes(summoned)) {
      setActive(summoned);
      return;
    }

    const next = waiting[0];
    if (!next) return;

    // Toasts are free. They do not block, they do not ask anything, and they
    // are the answer to something the student did — holding one back behind a
    // cap designed for interruptions would be applying the rule to the one
    // case it was not written for.
    if (MOMENTS[next].kind === "toast" || modalsShown < MAX_MODALS) {
      setActive(next);
    }
  }, [active, holding, preempted, settled, claimed, done, modalsShown, summoned]);

  const deferred = useMemo(
    () =>
      [...claimed]
        .filter((id) => !done.has(id) && id !== active)
        .sort((a, b) => MOMENTS[b].priority - MOMENTS[a].priority)
        .map((id) => ({ id, ...MOMENTS[id] })),
    [claimed, done, active],
  );

  // Stable for the life of the provider — see the note on Actions.
  const actions = useMemo<Actions>(
    () => ({ claim, withdraw, release, summon }),
    [claim, withdraw, release, summon],
  );
  const state = useMemo<State>(() => ({ active, deferred }), [active, deferred]);

  return (
    <ActionsContext.Provider value={actions}>
      <StateContext.Provider value={state}>{children}</StateContext.Provider>
    </ActionsContext.Provider>
  );
}

/* -------------------------------------------------------------------------- */
/* The hook every interruption uses                                           */
/* -------------------------------------------------------------------------- */

/**
 * Ask for a turn.
 *
 * `due` is the component's own answer to "do I have anything to show?" — it
 * keeps every existing rule about when a thing is due (the server stamp on the
 * journey moment, the per-level localStorage key on the poster) exactly where
 * it already lives. This hook only decides WHEN, among the others, and never
 * WHETHER.
 *
 * Outside a provider it returns `open: due` and a no-op release, so a
 * component that ends up on a page without the provider still works on its own
 * terms rather than silently never showing. An interruption that vanishes
 * because of missing plumbing is worse than one that is badly timed.
 */
export function useMoment(id: MomentId, due: boolean): { open: boolean; close: () => void } {
  const actions = useContext(ActionsContext);
  const { active } = useContext(StateContext);

  useEffect(() => {
    if (!actions) return;
    if (due) actions.claim(id);
    else actions.withdraw(id);
  }, [actions, id, due]);

  /**
   * A claim never outlives its claimant.
   *
   * Separate from the effect above so it fires on UNMOUNT only — folding it
   * into that one would withdraw and re-claim on every change of `due`,
   * churning the settle window. Without it, a component that goes away while
   * holding a turn (the payment toast lives inside a branch of the dashboard
   * that swaps out when loading finishes) leaves a claim nothing will ever
   * render or release, and everything behind it waits forever.
   */
  useEffect(() => () => actions?.withdraw(id), [actions, id]);

  const close = useCallback(() => {
    actions?.release(id);
  }, [actions, id]);

  if (!actions) return { open: due, close: () => {} };
  return { open: due && active === id, close };
}

/** For the dock, and for anything that needs to hand over to a named moment. */
export function useMomentQueue(): (Actions & State) | null {
  const actions = useContext(ActionsContext);
  const state = useContext(StateContext);
  return actions ? { ...actions, ...state } : null;
}
