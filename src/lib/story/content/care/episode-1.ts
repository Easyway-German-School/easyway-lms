import type { StoryChapter } from "@/lib/story/types";

/**
 * First episode of the "care" (nursing) Germany-goal track — see the `care`
 * entry in germany-goals.ts for the tone this should match: a hospital ward,
 * B2-level, "your ward" as the destination.
 *
 * Three scenes: a morning handover (introduces the mentor, one branching
 * choice), a patient round (the chapter's speaking-heavy beat plus its one
 * writing beat), and a break-room debrief that closes the chapter.
 */
export const careEpisode1: StoryChapter = {
  id: "care-first-shift",
  goalId: "care",
  title: "Your First Shift",
  synopsis: "A morning on the ward, from handover to your first patient round.",
  characters: [
    {
      id: "nurse",
      name: "Schwester Bettina",
      role: "Supervising nurse",
      defaultExpression: "neutral",
      portraits: {
        neutral: "/story/care/characters/nurse-neutral.png",
        warm: "/story/care/characters/nurse-warm.png",
        pleased: "/story/care/characters/nurse-pleased.png",
      },
    },
    {
      id: "patient",
      name: "Herr Voss",
      role: "Patient, room 12",
      defaultExpression: "tired",
      portraits: {
        tired: "/story/care/characters/patient-tired.png",
        concerned: "/story/care/characters/patient-concerned.png",
        neutral: "/story/care/characters/patient-neutral.png",
      },
    },
  ],
  sceneOrder: ["handover", "patient-round", "break-room"],
  scenes: {
    handover: {
      id: "handover",
      title: "Morning Handover",
      background: "/story/care/backgrounds/ward-corridor.png",
      startBeatId: "h1",
      beats: {
        h1: {
          id: "h1",
          type: "line",
          speakerId: "nurse",
          expression: "neutral",
          text: "Guten Morgen! Sind Sie bereit für die Übergabe?",
          translation: "Good morning! Ready for the handover?",
          next: "h2",
        },
        h2: {
          id: "h2",
          type: "yourLine",
          speakerId: "nurse",
          targetPhrase: "Guten Morgen, ja, ich bin bereit.",
          translation: "Good morning, yes, I'm ready.",
          next: "h3",
        },
        h3: {
          id: "h3",
          type: "choice",
          speakerId: "nurse",
          prompt: "Bevor wir anfangen — wie möchten Sie den Tag beginnen?",
          options: [
            {
              id: "prepared",
              text: "Ich habe die Akten schon gelesen.",
              translation: "I've already read the files.",
              next: "h4a",
              flavorNote: "Schwester Bettina nickt beeindruckt.",
              trustDelta: 8,
            },
            {
              id: "ask-help",
              text: "Können Sie mir kurz helfen, mich einzuarbeiten?",
              translation: "Could you help me get oriented first?",
              next: "h4b",
              flavorNote: "Schwester Bettina lächelt und nimmt sich einen Moment Zeit.",
              trustDelta: 4,
            },
          ],
          next: null,
        },
        // Real fork: "prepared" skips straight to the compliment; "ask-help"
        // detours through a short tip exchange (its own yourLine beat) before
        // both paths land back on h4. Neither is more "correct" — a different
        // shape of the same morning, not a right/wrong branch.
        h4a: {
          id: "h4a",
          type: "line",
          speakerId: "nurse",
          expression: "pleased",
          text: "Sehr gut vorbereitet — das sieht man nicht oft am ersten Tag.",
          translation: "Very well prepared — you don't see that often on a first day.",
          next: "h4",
        },
        h4b: {
          id: "h4b",
          type: "line",
          speakerId: "nurse",
          expression: "warm",
          text: "Kein Problem. Fangen wir langsam an, Schritt für Schritt.",
          translation: "No problem. Let's start slowly, step by step.",
          next: "h4c",
        },
        h4c: {
          id: "h4c",
          type: "yourLine",
          speakerId: "nurse",
          targetPhrase: "Danke, das hilft mir wirklich.",
          translation: "Thank you, that really helps me.",
          next: "h4",
        },
        h4: {
          id: "h4",
          type: "line",
          speakerId: "nurse",
          expression: "warm",
          text: "Gut. Wir haben heute drei Patienten auf dieser Station. Fangen wir mit Herrn Voss in Zimmer zwölf an.",
          translation: "Good. We have three patients on this ward today. Let's start with Herr Voss in room twelve.",
          next: null,
        },
      },
    },
    "patient-round": {
      id: "patient-round",
      title: "Patient Round",
      background: "/story/care/backgrounds/patient-room.png",
      startBeatId: "p1",
      beats: {
        p1: {
          id: "p1",
          type: "line",
          speakerId: "patient",
          expression: "tired",
          text: "Guten Tag... ich fühle mich heute nicht so gut.",
          translation: "Good day... I'm not feeling so well today.",
          next: "p2",
        },
        p2: {
          id: "p2",
          type: "yourLine",
          speakerId: "patient",
          targetPhrase: "Guten Tag, Herr Voss. Was fehlt Ihnen denn genau?",
          translation: "Good day, Herr Voss. What exactly is bothering you?",
          next: "p3",
        },
        p3: {
          id: "p3",
          type: "line",
          speakerId: "patient",
          expression: "concerned",
          text: "Mein Kopf tut weh, und ich habe seit gestern Abend leichtes Fieber.",
          translation: "My head hurts, and I've had a slight fever since yesterday evening.",
          next: "p4",
        },
        p4: {
          id: "p4",
          type: "write",
          prompt: "Write a short handover note (2–3 sentences) for the next shift, summarizing Herr Voss's condition.",
          promptGerman: "Schreiben Sie eine kurze Übergabenotiz (2–3 Sätze) für die nächste Schicht über den Zustand von Herrn Voss.",
          minWords: 12,
          exampleAnswer: "Herr Voss klagt seit gestern Abend über Kopfschmerzen und leichtes Fieber. Bitte Temperatur weiter kontrollieren und den Arzt informieren, falls sich der Zustand verschlechtert.",
          next: null,
        },
      },
    },
    "break-room": {
      id: "break-room",
      title: "Break-Room Debrief",
      background: "/story/care/backgrounds/break-room.png",
      startBeatId: "b1",
      beats: {
        b1: {
          id: "b1",
          type: "line",
          speakerId: "nurse",
          expression: "pleased",
          text: "Das haben Sie gut gemacht. Herr Voss hat sich bei Ihnen wohlgefühlt.",
          translation: "You did well there. Herr Voss felt at ease with you.",
          // Only reachable via the "prepared" choice earlier (+8 trust) —
          // Schwester Bettina remembers the whole morning, not just the round.
          variants: [
            {
              minTrust: 58,
              text: "Sie haben das heute wirklich beeindruckend gemacht. Herr Voss hat Ihnen komplett vertraut — und ehrlich gesagt, ich auch.",
              translation: "You did that impressively well today. Herr Voss trusted you completely — and honestly, so do I.",
            },
          ],
          next: "b2",
        },
        b2: {
          id: "b2",
          type: "yourLine",
          speakerId: "nurse",
          targetPhrase: "Vielen Dank, es war ein guter erster Tag.",
          translation: "Thank you, it was a good first day.",
          next: "b3",
        },
        b3: {
          id: "b3",
          type: "line",
          speakerId: "nurse",
          expression: "warm",
          text: "Morgen geht es weiter — und Sie machen das schon wie eine echte Kollegin.",
          translation: "Tomorrow we continue — and you're already carrying yourself like a real colleague.",
          next: null,
        },
      },
    },
  },
};
