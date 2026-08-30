import type { StoryChapter } from "@/lib/story/types";

/**
 * First episode of the "ausbildung" Germany-goal track. Mirrors care's
 * episode-1 shape exactly: 3 scenes, one early choice beat, one write beat
 * as the substantive task. Tone/level pulled from the `ausbildung` entry in
 * germany-goals.ts — B1, a workshop, "your first day of training".
 */
export const ausbildungEpisode1: StoryChapter = {
  id: "ausbildung-first-day",
  goalId: "ausbildung",
  title: "Your First Day",
  synopsis: "A first day at the workshop, from the morning welcome to your first job on the floor.",
  characters: [
    {
      id: "meister",
      name: "Herr Brandt",
      role: "Ausbildungsleiter",
      defaultExpression: "neutral",
      portraits: {
        neutral: "/story/ausbildung/characters/meister-neutral.png",
        warm: "/story/ausbildung/characters/meister-warm.png",
        pleased: "/story/ausbildung/characters/meister-pleased.png",
      },
    },
    {
      id: "azubi",
      name: "Jonas",
      role: "Azubi, 2. Jahr",
      defaultExpression: "neutral",
      portraits: {
        neutral: "/story/ausbildung/characters/azubi-neutral.png",
        warm: "/story/ausbildung/characters/azubi-warm.png",
        concerned: "/story/ausbildung/characters/azubi-concerned.png",
      },
    },
  ],
  sceneOrder: ["orientation", "workshop-task", "debrief"],
  scenes: {
    orientation: {
      id: "orientation",
      title: "Orientation",
      background: "/story/ausbildung/backgrounds/workshop-floor.png",
      startBeatId: "o1",
      beats: {
        o1: {
          id: "o1",
          type: "line",
          speakerId: "meister",
          expression: "neutral",
          text: "Willkommen in der Werkstatt! Schön, dass Sie da sind.",
          translation: "Welcome to the workshop! Good to have you here.",
          next: "o2",
        },
        o2: {
          id: "o2",
          type: "yourLine",
          speakerId: "meister",
          targetPhrase: "Vielen Dank, ich freue mich sehr auf meine Ausbildung hier.",
          translation: "Thank you very much, I'm really looking forward to my training here.",
          next: "o3",
        },
        o3: {
          id: "o3",
          type: "choice",
          speakerId: "meister",
          prompt: "Haben Sie schon einmal in einer Werkstatt gearbeitet?",
          options: [
            {
              id: "some-experience",
              text: "Ja, ich habe ein Praktikum in einer Werkstatt gemacht.",
              translation: "Yes, I did an internship in a workshop.",
              next: "o4a",
              flavorNote: "Herr Brandt nickt zufrieden.",
              trustDelta: 8,
            },
            {
              id: "no-experience",
              text: "Nein, aber ich lerne sehr gerne etwas Neues.",
              translation: "No, but I really enjoy learning something new.",
              next: "o4b",
              flavorNote: "Herr Brandt lächelt — genau die richtige Einstellung.",
              trustDelta: 4,
            },
          ],
          next: null,
        },
        // Real fork: "some-experience" skips to the compliment; "no-experience"
        // detours through a short reassurance exchange before both land on o4.
        o4a: {
          id: "o4a",
          type: "line",
          speakerId: "meister",
          expression: "pleased",
          text: "Praktische Erfahrung ist Gold wert — das sieht man nicht oft am ersten Tag.",
          translation: "Practical experience is worth gold — you don't see that often on a first day.",
          next: "o4",
        },
        o4b: {
          id: "o4b",
          type: "line",
          speakerId: "meister",
          expression: "warm",
          text: "Kein Problem, jeder fängt mal klein an. Ich zeige Ihnen gerne die Grundlagen.",
          translation: "No problem, everyone starts small. I'm happy to show you the basics.",
          next: "o4c",
        },
        o4c: {
          id: "o4c",
          type: "yourLine",
          speakerId: "meister",
          targetPhrase: "Danke, das hilft mir wirklich weiter.",
          translation: "Thanks, that really helps me.",
          next: "o4",
        },
        o4: {
          id: "o4",
          type: "line",
          speakerId: "meister",
          expression: "warm",
          text: "Gut. Jonas zeigt Ihnen die Werkstatt und Sie beginnen heute mit einer kleinen Aufgabe.",
          translation: "Good. Jonas will show you around and you'll start with a small task today.",
          next: null,
        },
      },
    },
    "workshop-task": {
      id: "workshop-task",
      title: "First Task",
      background: "/story/ausbildung/backgrounds/tool-bench.png",
      startBeatId: "w1",
      beats: {
        w1: {
          id: "w1",
          type: "line",
          speakerId: "azubi",
          expression: "neutral",
          text: "Hier ist dein Arbeitsplatz. Kannst du mir den 13er Schraubenschlüssel reichen?",
          translation: "Here's your workstation. Can you hand me the 13mm wrench?",
          next: "w2",
        },
        w2: {
          id: "w2",
          type: "yourLine",
          speakerId: "azubi",
          targetPhrase: "Klar, einen Moment — ist das hier der richtige?",
          translation: "Sure, one moment — is this the right one?",
          next: "w3",
        },
        w3: {
          id: "w3",
          type: "line",
          speakerId: "azubi",
          expression: "warm",
          text: "Genau der. Du lernst schnell. Schreib nachher kurz auf, was wir heute gemacht haben — das machen wir hier immer für die Übergabe.",
          translation: "Exactly that one. You learn fast. Write down afterwards what we did today — we always do that here for the handover.",
          next: "w4",
        },
        w4: {
          id: "w4",
          type: "write",
          prompt: "Write a short shift note (2–3 sentences) about the task you helped with today.",
          promptGerman: "Schreiben Sie eine kurze Notiz (2–3 Sätze) über die Aufgabe, bei der Sie heute geholfen haben.",
          minWords: 12,
          exampleAnswer: "Heute habe ich Jonas beim Werkzeugwechsel geholfen und den 13er Schraubenschlüssel gereicht. Ich habe gelernt, wie man die Werkzeuge in der Werkstatt findet und benennt.",
          next: null,
        },
      },
    },
    debrief: {
      id: "debrief",
      title: "End of Day",
      background: "/story/ausbildung/backgrounds/workshop-floor.png",
      startBeatId: "d1",
      beats: {
        d1: {
          id: "d1",
          type: "line",
          speakerId: "meister",
          expression: "neutral",
          text: "Und, wie war Ihr erster Tag?",
          translation: "So, how was your first day?",
          next: "d2",
        },
        d2: {
          id: "d2",
          type: "yourLine",
          speakerId: "meister",
          targetPhrase: "Sehr gut, danke — ich habe heute schon viel gelernt.",
          translation: "Very good, thank you — I already learned a lot today.",
          next: "d3",
        },
        d3: {
          id: "d3",
          type: "line",
          speakerId: "meister",
          expression: "pleased",
          text: "Das freut mich zu hören. Morgen geht es weiter — Sie machen das schon wie ein echter Azubi.",
          translation: "Glad to hear it. We continue tomorrow — you're already carrying yourself like a real apprentice.",
          // Only reachable via the "some-experience" choice earlier (+8 trust).
          variants: [
            {
              minTrust: 58,
              text: "Das freut mich wirklich zu hören. Ehrlich gesagt, ich hatte selten einen so vielversprechenden ersten Tag wie Ihren.",
              translation: "That genuinely makes me happy to hear. Honestly, I've rarely seen such a promising first day as yours.",
            },
          ],
          next: null,
        },
      },
    },
  },
};
