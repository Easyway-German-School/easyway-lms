import type { MascotMood } from "@/components/Mascot";

/**
 * Replayable, narrated walkthroughs for the student portal — reachable any
 * time from /tutorials. This is also what plays a brand-new student's first
 * onboarding walkthrough now (the `"welcome"` tutorial, built by
 * `buildWelcomeTutorial` below) — it replaces the old, single-page WelcomeTour,
 * which only pointed at sidebar buttons from the dashboard rather than
 * actually visiting them. Reuses the same real-DOM spotlight approach that
 * WelcomeTour pioneered (`data-tour="nav:<href>"` selectors, never a picture
 * of the sidebar), so a step can never drift out of date with the nav it
 * describes.
 *
 * Steps can each ask to be on a specific `route`. TutorialRuntime persists
 * progress in sessionStorage and navigates between routes as steps advance,
 * so a tutorial can genuinely "open the pages" as it narrates rather than
 * staying inside one modal — see the run-state helpers below.
 */

export type TutorialStep = {
  id: string;
  /** Page this step plays on. Omitted = stays on whatever page it started. */
  route?: string;
  /** CSS selector to spotlight, e.g. `[data-tour="nav:/materials"]`. Omitted = centre-stage card. */
  target?: string;
  /** Target lives in the mobile sidebar drawer — ask the shell to open it. */
  inSidebar?: boolean;
  /** Read aloud via browser text-to-speech. */
  narration: string;
  /** Short on-screen line — has to stand alone if the student is muted. */
  caption: string;
  mood?: MascotMood;
  /** true = advance after narration; omitted means wait for the student's tap. */
  autoAdvance?: boolean;
  /** Fallback delay if speech is unavailable/blocked/muted. */
  autoAdvanceMs?: number;
};

export type Tutorial = {
  id: string;
  title: string;
  blurb: string;
  estMinutes: number;
  steps: TutorialStep[];
  /** Fires once, whenever this tutorial ends — Done or Exit alike, matching
   *  WelcomeTour's own "skipping counts as seeing it" rule. Used by the
   *  `welcome` tutorial to mark onboarding seen server-side. */
  onFinish?: () => void;
};

export type TutorialAccessHint = {
  deliveryMode?: string;
  classType?: string;
};

/** What `/api/student/onboarding` returns — enough to personalise the welcome tutorial. */
export type OnboardingProfile = {
  firstName: string | null;
  level: string;
  branchName: string | null;
  isOnlineBranch: boolean;
  deliveryMode?: string;
  classType?: string;
  sessionSlot: string;
  tourSeen: boolean;
};

/**
 * A brand-new student's first walkthrough — the direct replacement for
 * WelcomeTour.tsx. Same copy and mode-branching (online/hybrid/physical,
 * `canDownload`) as the original `buildSteps()`, reshaped so each topic
 * actually navigates to its real page instead of only spotlighting from the
 * dashboard. `onFinish` posts the same completion the original tour did.
 */
export function buildWelcomeTutorial(onboarding: OnboardingProfile): Tutorial {
  const mode = onboarding.deliveryMode ?? (onboarding.isOnlineBranch ? "online" : "physical");
  const isOnline = mode === "online";
  const isHybrid = mode === "hybrid";
  const canDownload = isOnline || isHybrid || onboarding.classType === "private";

  const where = isOnline
    ? "You study online, so your classroom travels with you."
    : isHybrid && onboarding.branchName
      ? `You are at our ${onboarding.branchName} campus, and you can join the same class live over video when you cannot get in.`
      : onboarding.branchName
        ? `You are at our ${onboarding.branchName} campus.`
        : "";

  return {
    id: "welcome",
    title: "Welcome to EasyWay",
    blurb: "Your very first tour — everything you'll actually use, from Becca.",
    estMinutes: 3,
    onFinish: () => {
      void fetch("/api/student/onboarding", { method: "POST" }).catch(() => {});
    },
    steps: [
      {
        id: "welcome-hello",
        route: "/dashboard",
        caption: onboarding.firstName ? `Hallo, ${onboarding.firstName}.` : "Hallo.",
        narration: `You are starting at ${onboarding.level}. ${where} Give me a minute and I will show you what you will actually use — then you never have to see me again.`,
        mood: "greeting",
      },
      {
        id: "welcome-classes",
        route: isOnline ? "/live" : "/calendar",
        target: isOnline ? '[data-tour="nav:/live"]' : '[data-tour="nav:/calendar"]',
        inSidebar: true,
        caption: isOnline ? "Your class opens here" : "Your timetable lives here",
        narration: isOnline
          ? `Your ${onboarding.sessionSlot} session runs live over video. Pick your video quality before you join — on mobile data, Data saver keeps the lesson steady instead of frozen.`
          : isHybrid
            ? `Your ${onboarding.sessionSlot} session, the topic for each day, and anything your tutor attaches are all on this calendar. Live class, just below, is the same lesson over video.`
            : `Your ${onboarding.sessionSlot} session, the topic for each day, and anything your tutor attaches are all on this calendar. If a class is moved it shows on its new day, marked with where it moved from.`,
        mood: "presenting",
      },
      {
        id: "welcome-catchup",
        route: "/materials",
        target: '[data-tour="nav:/materials"]',
        inSidebar: true,
        caption: "Every class is recorded",
        narration: canDownload
          ? "Recordings land in the Watch tab the same day and pick up exactly where your connection dropped. Install the app and you can download a class to watch later with no signal at all. A written recap of every class waits in My Notes, one tab down."
          : "Recordings land in the Watch tab the same day and pick up exactly where your connection dropped. A written recap of every class — the new words, what to practise — waits in My Notes, one tab down.",
        mood: "happy",
      },
      {
        id: "welcome-coach",
        route: "/games",
        target: '[data-tour="nav:/games"]',
        inSidebar: true,
        caption: "Your AI coach and games",
        narration:
          "Talk to the AI coach to drill your speaking out loud, or play a quick round to keep your streak alive. This is what the students who actually finish do on the days there is no class.",
        mood: "presenting",
      },
      {
        id: "welcome-community",
        route: "/community",
        target: '[data-tour="nav:/community"]',
        inSidebar: true,
        caption: "Your class is in here",
        narration:
          "Your branch and level have their own space. Ask questions between classes and practise with the people sitting the same exam as you.",
        mood: "happy",
      },
      {
        id: "welcome-payments",
        route: "/payments",
        target: '[data-tour="nav:/payments"]',
        inSidebar: true,
        caption: "Tuition lives here",
        narration:
          "Your balance, what is due and every receipt. Classes and certificates unlock once tuition is settled, and you can pay in parts — no surprises.",
        mood: "presenting",
      },
      {
        id: "welcome-done",
        route: "/dashboard",
        caption: "You are ready.",
        narration: "Viel Erfolg. If you forget where something is, everything I showed you is in the menu on the left.",
        mood: "celebrating",
        autoAdvance: false,
      },
    ],
  };
}

function buildJoiningClassTutorial(hint: TutorialAccessHint): Tutorial {
  const mode = hint.deliveryMode ?? "physical";
  const isOnline = mode === "online";
  const isHybrid = mode === "hybrid";
  const canDownload = isOnline || isHybrid || hint.classType === "private";

  const intro: TutorialStep = isOnline
    ? {
        id: "class-intro",
        route: "/live",
        caption: "Your classroom, wherever you are",
        narration:
          "Hi, it's Becca! You study online, so your classroom travels with you. Let me show you how it works.",
        mood: "greeting",
      }
    : isHybrid
      ? {
          id: "class-intro",
          route: "/calendar",
          caption: "On campus, or over video",
          narration:
            "Hi, it's Becca! You're at a campus, but you can also join the exact same class live over video whenever you can't make it in. Let me show you both.",
          mood: "greeting",
        }
      : {
          id: "class-intro",
          route: "/calendar",
          caption: "Your timetable lives here",
          narration: "Hi, it's Becca! Let me show you where your classes actually are.",
          mood: "greeting",
        };

  const findClass: TutorialStep = isOnline
    ? {
        id: "class-find",
        route: "/live",
        target: '[data-tour="nav:/live"]',
        inSidebar: true,
        caption: "Right here when it's time",
        narration:
          "Your class opens here, right on schedule. Pick your video quality before you join — on mobile data, Data saver keeps things steady instead of frozen.",
        mood: "presenting",
      }
    : {
        id: "class-find",
        route: "/calendar",
        target: '[data-tour="nav:/calendar"]',
        inSidebar: true,
        caption: "Every session, one place",
        narration:
          "Your sessions, the topic for each day, and anything your tutor attaches — all on this calendar. If a class is moved, it shows on its new day, marked with where it moved from.",
        mood: "presenting",
      };

  return {
    id: "joining-class",
    title: "Joining your class",
    blurb: "Where your timetable lives, and what happens when you can't make it in.",
    estMinutes: 3,
    steps: [
      intro,
      findClass,
      {
        id: "class-materials",
        route: "/materials",
        target: '[data-tour="nav:/materials"]',
        inSidebar: true,
        caption: "Miss one? Minutes, not the lesson",
        narration: canDownload
          ? "Every class gets recorded and lands in your Watch tab the same day. Install the app and you can even download a class to watch later with no signal at all."
          : "Every class gets recorded and lands in your Watch tab the same day — pick up exactly where you left off.",
        mood: "happy",
      },
      {
        id: "class-notes",
        route: "/notes",
        target: '[data-tour="nav:/notes"]',
        inSidebar: true,
        caption: "Your recap waits here",
        narration:
          "And a written recap of every class — new words, what to practise — waits in My Notes, right below it. That's how you get to class. Go take a look at your timetable!",
        mood: "celebrating",
        autoAdvance: false,
      },
    ],
  };
}

export function buildTutorials(hint: TutorialAccessHint = {}): Tutorial[] {
  return [
    {
      id: "dashboard-tour",
      title: "Your dashboard",
      blurb: "A two-minute walk through your home screen — what everything on it is for.",
      estMinutes: 2,
      steps: [
        {
          id: "dash-hello",
          route: "/dashboard",
          caption: "Welcome home",
          narration:
            "Hey, it's Becca! This is your dashboard — the first thing you see every time you log in. Let me show you around.",
          mood: "greeting",
        },
        {
          id: "dash-classes",
          route: "/dashboard",
          target: '[data-tour="nav:/calendar"]',
          inSidebar: true,
          caption: "Your timetable, always one tap away",
          narration:
            "Everything about your classes lives under Classes, right here in your sidebar — your timetable, today's topic, and anything your tutor attaches.",
          mood: "presenting",
        },
        {
          id: "dash-notifications",
          route: "/dashboard",
          target: '[data-tour="nav:/notifications"]',
          inSidebar: true,
          caption: "Nothing sneaks past you",
          narration:
            "And anything new — a message, a payment reminder, a schedule change — shows up right here with a little red badge. That's home base. Go take a look around!",
          mood: "happy",
          autoAdvance: false,
        },
      ],
    },
    buildJoiningClassTutorial(hint),
    {
      id: "materials-notes",
      title: "Materials, recordings & My Notes",
      blurb: "Where every class recording, download and written recap ends up.",
      estMinutes: 3,
      steps: [
        {
          id: "materials-intro",
          route: "/materials",
          caption: "Never really miss a class",
          narration:
            "Hi again! Every class you take gets recorded and lands right here in Materials, the same day — you can pick up exactly where your connection dropped.",
          mood: "greeting",
        },
        {
          id: "materials-nav",
          route: "/materials",
          target: '[data-tour="nav:/materials"]',
          inSidebar: true,
          caption: "The Watch tab is your rewind button",
          narration: "This is the sidebar entry — the moment a class finishes, this is the first place to check.",
          mood: "presenting",
        },
        {
          id: "materials-notes-nav",
          route: "/notes",
          target: '[data-tour="nav:/notes"]',
          inSidebar: true,
          caption: "A recap you can actually use",
          narration:
            "Right underneath it is My Notes — a written recap of every lesson: new words, what to practise. Perfect for revising in five minutes before your next class.",
          mood: "happy",
        },
        {
          id: "materials-offline",
          route: "/notes",
          caption: "Take it offline",
          narration:
            "One more thing — install the app from your phone's browser menu, and your notes stay with you even with zero signal. That's everything. Go catch up on something!",
          mood: "celebrating",
          autoAdvance: false,
        },
      ],
    },
    {
      id: "community-tour",
      title: "Community",
      blurb: "Where your class actually talks to each other.",
      estMinutes: 2,
      steps: [
        {
          id: "community-intro",
          route: "/community",
          caption: "You're not doing this alone",
          narration:
            "Hey, it's Becca. Your branch and level have their own space right here in Community — ask questions, share wins, practise with people sitting the exact same exam as you.",
          mood: "greeting",
        },
        {
          id: "community-nav",
          route: "/community",
          target: '[data-tour="nav:/community"]',
          inSidebar: true,
          caption: "One tap away from anywhere",
          narration:
            "It's right here in your sidebar, wherever you are in the portal — and students who post in their first week finish at nearly twice the rate. Just saying.",
          mood: "presenting",
        },
        {
          id: "community-badge",
          route: "/community",
          caption: "The badge means someone's waiting",
          narration:
            "That little number next to Community is unread messages — clear it whenever you get a chance. That's the whole tour. Go say hello!",
          mood: "happy",
          autoAdvance: false,
        },
      ],
    },
    {
      id: "payments-tour",
      title: "Payments & tuition",
      blurb: "Your balance, receipts, and how part-payments work.",
      estMinutes: 2,
      steps: [
        {
          id: "payments-intro",
          route: "/payments",
          caption: "No surprises, ever",
          narration:
            "Hi! This page always shows exactly what you owe, what's already paid, and every receipt — nothing hidden, nothing to guess at.",
          mood: "greeting",
        },
        {
          id: "payments-nav",
          route: "/payments",
          target: '[data-tour="nav:/payments"]',
          inSidebar: true,
          caption: "You don't have to pay it all at once",
          narration:
            "It's right here in the sidebar, and you can pay in parts if that's easier — classes, assignments and certificates unlock the moment your balance clears.",
          mood: "presenting",
        },
        {
          id: "payments-anytime",
          route: "/payments",
          caption: "Any time, any amount",
          narration: "Come back whenever you're ready to pay more. That's tuition, sorted.",
          mood: "happy",
          autoAdvance: false,
        },
      ],
    },
    {
      id: "coach-games-tour",
      title: "AI Coach & games",
      blurb: "What to do on the days there's no class.",
      estMinutes: 3,
      steps: [
        {
          id: "coach-intro",
          route: "/games",
          caption: "For the days between classes",
          narration:
            "Hey, it's Becca! This is what the students who actually finish the course do on the days there's no class — talk to your AI coach, or play something quick.",
          mood: "greeting",
        },
        {
          id: "coach-nav",
          route: "/games",
          target: '[data-tour="nav:/games"]',
          inSidebar: true,
          caption: "Practise speaking out loud",
          narration:
            "Right here — talk to your AI coach to drill your speaking. It listens, it corrects you, and it never gets tired of you.",
          mood: "presenting",
        },
        {
          id: "coach-quiz",
          route: "/play",
          target: '[data-tour="nav:/play"]',
          inSidebar: true,
          caption: "Keep your streak alive",
          narration: "And just below it, Quiz game — a quick round keeps your streak going, even on your busiest day.",
          mood: "happy",
        },
        {
          id: "coach-done",
          route: "/play",
          caption: "Five minutes a day is enough",
          narration: "That's it — five minutes here and there adds up more than you'd think. Go keep that streak alive!",
          mood: "celebrating",
          autoAdvance: false,
        },
      ],
    },
  ];
}

/* ------------------------------------------------------------- run state */

/**
 * Which tutorial is playing, and where — persisted in sessionStorage rather
 * than React state, because every student page tears down and remounts
 * StudentShell (and everything in it) on each client-side navigation. This
 * is the one thing that survives a `router.push` between one step and the
 * next. `expectedRoute` is the page TutorialRuntime itself navigated to for
 * the current step: on the next mount, if `location.pathname` still matches
 * it, the tutorial resumes normally; if it doesn't, the student navigated
 * away on their own (a real nav click, back/forward, a typed URL) and the
 * runtime backs off to a small "resume?" chip instead of fighting them.
 */
export type TutorialRunState = {
  tutorialId: string;
  stepIndex: number;
  muted: boolean;
  expectedRoute: string;
  updatedAt: number;
};

const RUN_KEY = "easyway:tutorial-run";
const RUN_MAX_AGE_MS = 30 * 60 * 1000;
const RUN_CHANGED_EVENT = "easyway:tutorial-run-changed";

export function readTutorialRun(): TutorialRunState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(RUN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TutorialRunState;
    if (!parsed || Date.now() - parsed.updatedAt > RUN_MAX_AGE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Dispatches a change event so a TutorialRuntime already mounted on the
 * current page (not about to be replaced by a navigation) picks up the new
 * run immediately, rather than only on its next remount.
 */
export function writeTutorialRun(state: Omit<TutorialRunState, "updatedAt">) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(RUN_KEY, JSON.stringify({ ...state, updatedAt: Date.now() }));
  } catch {
    /* Storage full or blocked — the tutorial just won't survive a navigation this time. */
  }
  window.dispatchEvent(new CustomEvent(RUN_CHANGED_EVENT));
}

export function clearTutorialRun() {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(RUN_KEY);
  window.dispatchEvent(new CustomEvent(RUN_CHANGED_EVENT));
}

export function onTutorialRunChanged(listener: () => void): () => void {
  window.addEventListener(RUN_CHANGED_EVENT, listener);
  return () => window.removeEventListener(RUN_CHANGED_EVENT, listener);
}
