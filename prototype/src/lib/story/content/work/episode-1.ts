import type { StoryChapter } from "@/lib/story/types";

/**
 * Pilot chapter for the "work" (skilled-worker) Germany-goal track — see the
 * `work` entry in germany-goals.ts for the tone this should match: B2-level,
 * "your first day at work" as the destination, hue 200 / scenery
 * tower+turbines+houses on the journey map — industrial, working Germany.
 * The employer is accordingly a wind-turbine component manufacturer.
 *
 * Three scenes: a welcome from the team lead (one branching choice), the
 * first inspection task with a colleague (the chapter's writing beat), and
 * an end-of-day check-in that closes the chapter.
 */
export const workEpisode1: StoryChapter = {
  id: "work-first-day",
  goalId: "work",
  title: "First Day at Work",
  synopsis: "Your first day at Nordwind Technik — from the morning welcome to your first real task.",
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
  sceneOrder: ["welcome", "the-task", "end-of-day"],
  scenes: {
    welcome: {
      id: "welcome",
      title: "Welcome to the Team",
      background: "/story/work/backgrounds/reception.png",
      startBeatId: "w1",
      beats: {
        w1: {
          id: "w1",
          type: "line",
          speakerId: "teamlead",
          expression: "neutral",
          text: "Guten Morgen und herzlich willkommen im Team! Ich bin Frau Hoffmann, Ihre Teamleiterin.",
          translation: "Good morning and welcome to the team! I'm Frau Hoffmann, your team lead.",
          next: "w2",
        },
        w2: {
          id: "w2",
          type: "yourLine",
          speakerId: "teamlead",
          targetPhrase: "Guten Morgen, Frau Hoffmann. Ich freue mich sehr, hier zu sein.",
          translation: "Good morning, Frau Hoffmann. I'm very glad to be here.",
          next: "w3",
        },
        w3: {
          id: "w3",
          type: "choice",
          speakerId: "teamlead",
          prompt: "Bevor wir anfangen — haben Sie schon Erfahrung mit unseren Anlagen, oder ist das für Sie komplett neu?",
          options: [
            {
              id: "some-experience",
              text: "Ich habe schon mit ähnlichen Anlagen gearbeitet.",
              translation: "I've already worked with similar equipment.",
              next: "w4a",
              flavorNote: "Frau Hoffmann nickt anerkennend.",
              trustDelta: 8,
            },
            {
              id: "new-to-this",
              text: "Das ist neu für mich, aber ich lerne schnell.",
              translation: "This is new to me, but I learn quickly.",
              next: "w4b",
              flavorNote: "Frau Hoffmann lächelt — Offenheit ist ihr wichtig.",
              trustDelta: 4,
            },
          ],
          next: null,
        },
        // Real fork: "some-experience" skips to the compliment; "new-to-this"
        // detours through a short reassurance exchange before both land on w4.
        w4a: {
          id: "w4a",
          type: "line",
          speakerId: "teamlead",
          expression: "pleased",
          text: "Erfahrung wie Ihre ist hier sehr willkommen — das gibt mir gleich ein gutes Gefühl.",
          translation: "Experience like yours is very welcome here — that gives me a good feeling right away.",
          next: "w4",
        },
        w4b: {
          id: "w4b",
          type: "line",
          speakerId: "teamlead",
          expression: "warm",
          text: "Kein Problem, wir zeigen Ihnen alles in Ruhe. Offenheit zum Lernen zählt hier genauso viel.",
          translation: "No problem, we'll show you everything at a comfortable pace. Openness to learning counts just as much here.",
          next: "w4c",
        },
        w4c: {
          id: "w4c",
          type: "yourLine",
          speakerId: "teamlead",
          targetPhrase: "Danke, das beruhigt mich sehr.",
          translation: "Thank you, that reassures me a lot.",
          next: "w4",
        },
        w4: {
          id: "w4",
          type: "line",
          speakerId: "teamlead",
          expression: "warm",
          text: "Gut zu wissen. Tom zeigt Ihnen gleich die Werkshalle, und dann fangen wir mit einer ersten Aufgabe an.",
          translation: "Good to know. Tom will show you around the workshop floor, and then we'll start with a first task.",
          next: null,
        },
      },
    },
    "the-task": {
      id: "the-task",
      title: "First Inspection",
      background: "/story/work/backgrounds/workshop-floor.png",
      startBeatId: "t1",
      beats: {
        t1: {
          id: "t1",
          type: "line",
          speakerId: "colleague",
          expression: "neutral",
          text: "Willkommen! Ich bin Tom. Wir prüfen heute ein paar Bauteile für die neue Turbine.",
          translation: "Welcome! I'm Tom. Today we're checking a few components for the new turbine.",
          next: "t2",
        },
        t2: {
          id: "t2",
          type: "yourLine",
          speakerId: "colleague",
          targetPhrase: "Klar, zeig mir, wie das funktioniert.",
          translation: "Sure, show me how that works.",
          next: "t3",
        },
        t3: {
          id: "t3",
          type: "line",
          speakerId: "colleague",
          expression: "warm",
          text: "Kein Problem. Am Ende notierst du kurz, was wir geprüft haben — das machen wir hier immer für die Dokumentation.",
          translation: "No problem. At the end you'll jot down what we checked — we always do that here for the documentation.",
          next: "t4",
        },
        t4: {
          id: "t4",
          type: "write",
          prompt: "Write a short inspection note (2–3 sentences) about the turbine components you checked today.",
          promptGerman: "Schreiben Sie eine kurze Prüfnotiz (2–3 Sätze) über die Turbinenbauteile, die Sie heute geprüft haben.",
          minWords: 12,
          exampleAnswer:
            "Heute habe ich zusammen mit Tom mehrere Bauteile für die neue Turbine geprüft. Alle Teile waren in gutem Zustand und wurden für den nächsten Schritt freigegeben.",
          next: null,
        },
      },
    },
    "end-of-day": {
      id: "end-of-day",
      title: "End of Day",
      background: "/story/work/backgrounds/meeting-room.png",
      startBeatId: "e1",
      beats: {
        e1: {
          id: "e1",
          type: "line",
          speakerId: "teamlead",
          expression: "neutral",
          text: "Und, wie war Ihr erster Tag?",
          translation: "So, how was your first day?",
          next: "e2",
        },
        e2: {
          id: "e2",
          type: "yourLine",
          speakerId: "teamlead",
          targetPhrase: "Sehr gut, danke. Ich habe heute schon viel gelernt.",
          translation: "Very good, thank you. I already learned a lot today.",
          next: "e3",
        },
        e3: {
          id: "e3",
          type: "line",
          speakerId: "teamlead",
          expression: "pleased",
          text: "Das freut mich zu hören. Morgen geht es weiter — Sie machen das schon wie ein echtes Teammitglied.",
          translation: "Glad to hear it. We continue tomorrow — you're already carrying yourself like a real team member.",
          // Only reachable via the "some-experience" choice earlier (+8 trust).
          variants: [
            {
              minTrust: 58,
              text: "Das freut mich wirklich sehr zu hören. Ich muss sagen, so einen starken ersten Tag erlebt man hier nicht oft.",
              translation: "That genuinely makes me very happy to hear. I have to say, you don't often see such a strong first day here.",
            },
          ],
          next: null,
        },
      },
    },
  },
};
