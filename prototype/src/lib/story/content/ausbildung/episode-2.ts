import type { StoryChapter } from "@/lib/story/types";

/**
 * Second episode of the "ausbildung" series — unlocks the day after episode 1
 * completes. Same cast and art as episode 1 (Herr Brandt, Jonas), both
 * backgrounds reused (workshop-floor, tool-bench) — no new art needed.
 *
 * A missing tool turns into a workplace mystery — Herr Brandt reveals it's
 * the second one missing this week and asks the student to his office,
 * ending on an unresolved hook rather than a tidy wrap-up.
 */
export const ausbildungEpisode2: StoryChapter = {
  id: "ausbildung-second-day",
  goalId: "ausbildung",
  title: "The Missing Tool",
  synopsis: "Your second day at the workshop — and something's gone wrong before lunch.",
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
  sceneOrder: ["arrival", "the-mistake", "the-meeting"],
  scenes: {
    arrival: {
      id: "arrival",
      title: "Day Two",
      background: "/story/ausbildung/backgrounds/workshop-floor.png",
      startBeatId: "a1",
      beats: {
        a1: {
          id: "a1",
          type: "line",
          speakerId: "meister",
          expression: "neutral",
          text: "Guten Morgen! Na, wie fühlen Sie sich nach dem ersten Tag?",
          translation: "Good morning! So, how are you feeling after the first day?",
          // Callback to episode 1: only shows if the student left Herr Brandt
          // genuinely impressed last time. Trust is CARRIED ACROSS episodes —
          // see story-progress.ts's relationships map.
          variants: [
            {
              minTrust: 58,
              expression: "warm",
              text: "Guten Morgen — und schön, dass Sie wieder da sind! Ich hab mich schon auf den heutigen Tag mit Ihnen gefreut. Na, wie fühlen Sie sich nach dem ersten Tag?",
              translation: "Good morning — and good to have you back! I was actually looking forward to today with you. So, how are you feeling after the first day?",
            },
          ],
          next: "a2",
        },
        a2: {
          id: "a2",
          type: "yourLine",
          speakerId: "meister",
          targetPhrase: "Guten Morgen, Herr Brandt. Ich habe gut geschlafen und bin bereit.",
          translation: "Good morning, Herr Brandt. I slept well and I'm ready.",
          next: "a3",
        },
        a3: {
          id: "a3",
          type: "choice",
          speakerId: "meister",
          prompt: "Gut. Möchten Sie heute wieder mit Jonas arbeiten, oder probieren wir etwas Neues?",
          options: [
            {
              id: "with-jonas",
              text: "Ich arbeite gerne wieder mit Jonas.",
              translation: "I'd like to work with Jonas again.",
              next: "a4",
              flavorNote: "Herr Brandt lächelt — Jonas wird sich freuen.",
              trustDelta: 4,
            },
            {
              id: "something-new",
              text: "Ich probiere gerne etwas Neues aus.",
              translation: "I'd like to try something new.",
              next: "a4",
              flavorNote: "Herr Brandt nickt — neugierig zu sein ist eine gute Eigenschaft.",
              trustDelta: 6,
            },
          ],
          next: null,
        },
        a4: {
          id: "a4",
          type: "line",
          speakerId: "meister",
          expression: "warm",
          text: "Also gut — Jonas wartet schon an der Werkbank. Er hat heute eine größere Aufgabe für Sie beide.",
          translation: "Alright then — Jonas is already waiting at the workbench. He's got a bigger task for you both today.",
          next: null,
        },
      },
    },
    "the-mistake": {
      id: "the-mistake",
      title: "Something's Missing",
      background: "/story/ausbildung/backgrounds/tool-bench.png",
      startBeatId: "m1",
      beats: {
        m1: {
          id: "m1",
          type: "line",
          speakerId: "azubi",
          expression: "neutral",
          text: "Komisch... der Drehmomentschlüssel müsste hier liegen. Hast du ihn gesehen?",
          translation: "Weird... the torque wrench should be right here. Have you seen it?",
          next: "m2",
        },
        m2: {
          id: "m2",
          type: "yourLine",
          speakerId: "azubi",
          targetPhrase: "Nein, ich habe ihn nicht benutzt. Sollen wir zusammen suchen?",
          translation: "No, I haven't used it. Should we look for it together?",
          next: "m3",
        },
        m3: {
          id: "m3",
          type: "line",
          speakerId: "azubi",
          expression: "concerned",
          text: "Ja, bitte. Herr Brandt zählt jedes Werkzeug — das wird nicht gut aussehen, wenn wir es nicht finden.",
          translation: "Yes, please. Herr Brandt counts every tool — this won't look good if we can't find it.",
          next: "m4",
        },
        m4: {
          id: "m4",
          type: "write",
          prompt: "Write a short note (2–3 sentences) for the tool log, explaining that the torque wrench is missing and when you last saw the toolboard.",
          promptGerman:
            "Schreiben Sie eine kurze Notiz (2–3 Sätze) für das Werkzeugbuch: Der Drehmomentschlüssel fehlt — wann haben Sie das Werkzeugbrett zuletzt vollständig gesehen?",
          minWords: 12,
          exampleAnswer:
            "Der Drehmomentschlüssel fehlt seit heute Morgen. Ich habe das Werkzeugbrett gestern Nachmittag zuletzt vollständig gesehen. Wir haben bereits in der ganzen Werkstatt gesucht.",
          next: null,
        },
      },
    },
    "the-meeting": {
      id: "the-meeting",
      title: "Called to the Office",
      background: "/story/ausbildung/backgrounds/workshop-floor.png",
      startBeatId: "g1",
      beats: {
        g1: {
          id: "g1",
          type: "line",
          speakerId: "meister",
          expression: "neutral",
          text: "Jonas hat mir gerade erzählt, dass ein Werkzeug fehlt. Das ist mir sehr wichtig.",
          translation: "Jonas just told me a tool is missing. This matters a great deal to me.",
          next: "g2",
        },
        g2: {
          id: "g2",
          type: "yourLine",
          speakerId: "meister",
          targetPhrase: "Es tut uns leid, Herr Brandt. Wir haben überall gesucht.",
          translation: "We're sorry, Herr Brandt. We've looked everywhere.",
          next: "g3",
        },
        g3: {
          id: "g3",
          type: "line",
          speakerId: "meister",
          expression: "neutral",
          text: "Das glaube ich Ihnen sofort. Ehrlich gesagt, ist das heute schon das zweite fehlende Werkzeug diese Woche.",
          translation: "I believe you immediately. Honestly, this is already the second missing tool this week.",
          next: "g4",
        },
        g4: {
          id: "g4",
          type: "yourLine",
          speakerId: "meister",
          targetPhrase: "Das zweite? Was ist da los?",
          translation: "The second one? What's going on?",
          next: "g5",
        },
        g5: {
          id: "g5",
          type: "line",
          speakerId: "meister",
          expression: "neutral",
          text: "Das wollte ich mit Ihnen besprechen. Kommen Sie bitte kurz mit in mein Büro — es gibt da etwas, das ich Ihnen zeigen muss.",
          translation: "That's exactly what I wanted to discuss with you. Please come with me to my office for a moment — there's something I need to show you.",
          next: null,
        },
      },
    },
  },
};
