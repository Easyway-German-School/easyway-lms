import type { StoryChapter } from "@/lib/story/types";

/**
 * Second episode of the "work" series — unlocks the day after episode 1
 * completes. Same cast and all three backgrounds reused from episode 1 — no
 * new art needed. A component the student personally inspected on day one
 * gets flagged in final inspection, raising the stakes directly on their own
 * work, and ends on an unresolved hook (a meeting with management, reason
 * not yet given) rather than a tidy wrap-up.
 */
export const workEpisode2: StoryChapter = {
  id: "work-second-day",
  goalId: "work",
  title: "The Second Day",
  synopsis: "Your second day — and one of yesterday's approved components has been flagged.",
  characters: [
    {
      id: "teamlead",
      name: "Frau Hoffmann",
      role: "Teamleiterin",
      defaultExpression: "neutral",
      portraits: {
        neutral: "/story/work/characters/teamlead-neutral.png",
        warm: "/story/work/characters/teamlead-warm.png",
        pleased: "/story/work/characters/teamlead-pleased.png",
      },
    },
    {
      id: "colleague",
      name: "Tom",
      role: "Kollege",
      defaultExpression: "neutral",
      portraits: {
        neutral: "/story/work/characters/colleague-neutral.png",
        warm: "/story/work/characters/colleague-warm.png",
        concerned: "/story/work/characters/colleague-concerned.png",
      },
    },
  ],
  sceneOrder: ["morning-check", "the-flag", "the-report"],
  scenes: {
    "morning-check": {
      id: "morning-check",
      title: "Morning Check-In",
      background: "/story/work/backgrounds/reception.png",
      startBeatId: "c1",
      beats: {
        c1: {
          id: "c1",
          type: "line",
          speakerId: "teamlead",
          expression: "neutral",
          text: "Guten Morgen! Bevor wir weitermachen — es gibt eine kleine Sache, die wir besprechen sollten.",
          translation: "Good morning! Before we continue — there's a small matter we should discuss.",
          next: "c2",
        },
        c2: {
          id: "c2",
          type: "yourLine",
          speakerId: "teamlead",
          targetPhrase: "Guten Morgen, Frau Hoffmann. Was ist passiert?",
          translation: "Good morning, Frau Hoffmann. What happened?",
          next: "c3",
        },
        c3: {
          id: "c3",
          type: "choice",
          speakerId: "teamlead",
          prompt: "Erinnern Sie sich noch an die Bauteile, die Sie gestern mit Tom geprüft haben?",
          options: [
            {
              id: "yes-remember",
              text: "Ja, natürlich. Wir haben alles genau dokumentiert.",
              translation: "Yes, of course. We documented everything carefully.",
              next: "c4",
              flavorNote: "Frau Hoffmann nickt — das beruhigt sie ein wenig.",
            },
            {
              id: "worried-already",
              text: "Ja... ist etwas nicht in Ordnung?",
              translation: "Yes... is something wrong?",
              next: "c4",
              flavorNote: "Frau Hoffmann bemerkt Ihre Sorge und bleibt ruhig.",
            },
          ],
          next: null,
        },
        c4: {
          id: "c4",
          type: "line",
          speakerId: "teamlead",
          expression: "neutral",
          text: "Eines der Bauteile wurde heute Morgen bei der Endkontrolle markiert. Das muss nichts bedeuten, aber wir sollten es uns gemeinsam ansehen.",
          translation: "One of the components was flagged this morning during final inspection. It might not mean anything, but we should take a look together.",
          next: null,
        },
      },
    },
    "the-flag": {
      id: "the-flag",
      title: "A Second Look",
      background: "/story/work/backgrounds/workshop-floor.png",
      startBeatId: "f1",
      beats: {
        f1: {
          id: "f1",
          type: "line",
          speakerId: "colleague",
          expression: "concerned",
          text: "Ich habe die Meldung auch gesehen. Ich verstehe nicht, wie uns das entgangen sein könnte.",
          translation: "I saw the report too. I don't understand how we could have missed that.",
          next: "f2",
        },
        f2: {
          id: "f2",
          type: "yourLine",
          speakerId: "colleague",
          targetPhrase: "Lass uns die Prüfliste noch einmal zusammen durchgehen.",
          translation: "Let's go through the inspection checklist together again.",
          next: "f3",
        },
        f3: {
          id: "f3",
          type: "line",
          speakerId: "colleague",
          expression: "concerned",
          text: "Gute Idee. Aber wenn wir wirklich etwas übersehen haben, könnte das für die ganze Abteilung ein Problem werden.",
          translation: "Good idea. But if we really did miss something, that could become a problem for the whole department.",
          next: "f4",
        },
        f4: {
          id: "f4",
          type: "write",
          prompt: "Write a short note (2–3 sentences) re-checking and describing what you find when reviewing yesterday's inspection.",
          promptGerman: "Schreiben Sie eine kurze Notiz (2–3 Sätze): Was stellen Sie bei der erneuten Prüfung des Bauteils fest?",
          minWords: 12,
          exampleAnswer:
            "Bei der erneuten Prüfung sieht das Bauteil auf den ersten Blick unauffällig aus. Es könnte sich um einen Messfehler oder ein neues Problem handeln. Wir sollten Frau Hoffmann sofort informieren.",
          next: null,
        },
      },
    },
    "the-report": {
      id: "the-report",
      title: "The Report",
      background: "/story/work/backgrounds/meeting-room.png",
      startBeatId: "r1",
      beats: {
        r1: {
          id: "r1",
          type: "line",
          speakerId: "teamlead",
          expression: "neutral",
          text: "Ich habe mit der Qualitätsabteilung gesprochen. Das Ergebnis ist... nicht eindeutig.",
          translation: "I spoke with the quality department. The result is... not clear-cut.",
          next: "r2",
        },
        r2: {
          id: "r2",
          type: "yourLine",
          speakerId: "teamlead",
          targetPhrase: "Was bedeutet das für uns?",
          translation: "What does that mean for us?",
          next: "r3",
        },
        r3: {
          id: "r3",
          type: "line",
          speakerId: "teamlead",
          expression: "neutral",
          text: "Das bedeutet, dass wir morgen früh alle drei zusammen mit der Geschäftsführung sprechen müssen. Es geht um mehr als nur dieses eine Bauteil—",
          translation: "It means the three of us need to speak with management first thing tomorrow. This is about more than just this one component—",
          next: null,
        },
      },
    },
  },
};
