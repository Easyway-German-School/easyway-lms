import type { StoryChapter } from "@/lib/story/types";

/**
 * Second episode of the "care" (nursing) series — unlocks the day after
 * episode 1 completes (see story-progress.ts's resolveAccess). Same cast and
 * art as episode 1 (Schwester Bettina, Herr Voss), all three scenes reuse
 * episode 1's three backgrounds — no new art needed for this episode.
 *
 * Opens with a direct callback to episode 1 (Herr Voss, the patient the
 * student met on their first shift) and ends mid-sentence on a real
 * cliffhanger — a second patient's condition just changed, unresolved,
 * carrying into whatever episode 3 becomes.
 */
export const careEpisode2: StoryChapter = {
  id: "care-second-shift",
  goalId: "care",
  title: "The Second Shift",
  synopsis: "Your second morning on the ward — and Herr Voss's condition has taken a turn.",
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
  sceneOrder: ["morning-briefing", "sudden-change", "the-call"],
  scenes: {
    "morning-briefing": {
      id: "morning-briefing",
      title: "Morning Briefing",
      background: "/story/care/backgrounds/ward-corridor.png",
      startBeatId: "m1",
      beats: {
        m1: {
          id: "m1",
          type: "line",
          speakerId: "nurse",
          expression: "neutral",
          text: "Guten Morgen, willkommen zurück! Herr Voss hatte heute Nacht leider keine gute Nacht.",
          translation: "Good morning, welcome back! Herr Voss unfortunately didn't have a good night.",
          next: "m2",
        },
        m2: {
          id: "m2",
          type: "yourLine",
          speakerId: "nurse",
          targetPhrase: "Oh nein. Was ist passiert?",
          translation: "Oh no. What happened?",
          next: "m3",
        },
        m3: {
          id: "m3",
          type: "line",
          speakerId: "nurse",
          expression: "neutral",
          text: "Sein Fieber ist gestiegen, und er hat kaum geschlafen. Der Arzt kommt später vorbei.",
          translation: "His fever went up, and he barely slept. The doctor will come by later.",
          next: "m4",
        },
        m4: {
          id: "m4",
          type: "choice",
          speakerId: "nurse",
          prompt: "Möchten Sie zuerst zu Herrn Voss gehen, oder sollen wir wie geplant mit der Übergabe beginnen?",
          options: [
            {
              id: "check-first",
              text: "Ich möchte zuerst nach Herrn Voss sehen.",
              translation: "I'd like to check on Herr Voss first.",
              next: "m5",
              flavorNote: "Schwester Bettina nickt und führt Sie direkt zu ihm.",
            },
            {
              id: "as-planned",
              text: "Fangen wir wie geplant mit der Übergabe an.",
              translation: "Let's start with the handover as planned.",
              next: "m5",
              flavorNote: "Schwester Bettina stimmt zu — Herr Voss kann noch ein paar Minuten warten.",
            },
          ],
          next: null,
        },
        m5: {
          id: "m5",
          type: "line",
          speakerId: "nurse",
          expression: "neutral",
          text: "Gut, dann sehen wir jetzt nach ihm. Sein Zustand hat sich seit gestern verändert.",
          translation: "Good, let's go check on him now. His condition has changed since yesterday.",
          next: null,
        },
      },
    },
    "sudden-change": {
      id: "sudden-change",
      title: "A Change in Herr Voss",
      background: "/story/care/backgrounds/patient-room.png",
      startBeatId: "s1",
      beats: {
        s1: {
          id: "s1",
          type: "line",
          speakerId: "patient",
          expression: "tired",
          text: "Schwester... es geht mir heute schlechter. Ich kann kaum atmen.",
          translation: "Nurse... I'm doing worse today. I can barely breathe.",
          next: "s2",
        },
        s2: {
          id: "s2",
          type: "yourLine",
          speakerId: "patient",
          targetPhrase: "Herr Voss, bleiben Sie ruhig. Ich hole sofort Hilfe.",
          translation: "Herr Voss, stay calm. I'll get help right away.",
          next: "s3",
        },
        s3: {
          id: "s3",
          type: "line",
          speakerId: "patient",
          expression: "concerned",
          text: "Meine Brust... es fühlt sich eng an. Bitte, rufen Sie den Arzt.",
          translation: "My chest... it feels tight. Please, call the doctor.",
          next: "s4",
        },
        s4: {
          id: "s4",
          type: "write",
          prompt: "Write a short urgent note (2–3 sentences) for the doctor, describing Herr Voss's new symptoms.",
          promptGerman: "Schreiben Sie eine kurze dringende Notiz (2–3 Sätze) für den Arzt über die neuen Symptome von Herrn Voss.",
          minWords: 12,
          exampleAnswer:
            "Herr Voss klagt plötzlich über Atemnot und ein Engegefühl in der Brust. Sein Fieber ist weiter gestiegen. Bitte kommen Sie so schnell wie möglich vorbei.",
          next: null,
        },
      },
    },
    "the-call": {
      id: "the-call",
      title: "Waiting for the Doctor",
      background: "/story/care/backgrounds/ward-corridor.png",
      startBeatId: "t1",
      beats: {
        t1: {
          id: "t1",
          type: "line",
          speakerId: "nurse",
          expression: "warm",
          text: "Der Arzt ist unterwegs. Sie haben schnell und richtig reagiert.",
          translation: "The doctor's on the way. You reacted quickly and correctly.",
          next: "t2",
        },
        t2: {
          id: "t2",
          type: "yourLine",
          speakerId: "nurse",
          targetPhrase: "Danke. Ich mache mir Sorgen um ihn.",
          translation: "Thank you. I'm worried about him.",
          next: "t3",
        },
        t3: {
          id: "t3",
          type: "line",
          speakerId: "nurse",
          expression: "neutral",
          text: "Das ist ganz normal, wenn man sich um seine Patienten kümmert. Aber hören Sie — bevor der Arzt kommt, muss ich Ihnen noch etwas sagen—",
          translation: "That's completely normal when you care about your patients. But listen — before the doctor gets here, there's something I need to tell you—",
          next: "t4",
        },
        t4: {
          id: "t4",
          type: "yourLine",
          speakerId: "nurse",
          targetPhrase: "Was ist los? Sagen Sie es mir.",
          translation: "What's wrong? Tell me.",
          next: "t5",
        },
        t5: {
          id: "t5",
          type: "line",
          speakerId: "nurse",
          expression: "neutral",
          text: "Herr Voss ist heute nicht der Einzige, dessen Zustand sich verändert hat. Es gibt noch etwas, das—",
          translation: "Herr Voss isn't the only one whose condition changed today. There's something else that—",
          next: null,
        },
      },
    },
  },
};
