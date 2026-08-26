import type { StoryChapter } from "@/lib/story/types";

/**
 * Pilot chapter for the "study" (university) Germany-goal track — see the
 * `study` entry in germany-goals.ts for the tone this should match: C1-level,
 * "your first lecture" as the destination, hue 224 / scenery
 * campus+cathedral+gate on the journey map — academic, civic Germany.
 *
 * Three scenes: meeting a fellow student outside the lecture hall (one
 * branching choice), the lecture itself (introducing yourself to the
 * professor), and forming a study group afterward (the writing beat).
 */
export const studyEpisode1: StoryChapter = {
  id: "study-first-lecture",
  goalId: "study",
  title: "Your First Lecture",
  synopsis: "Your first day on campus — from the lecture hall to your first study group.",
  characters: [
    {
      id: "professor",
      name: "Professor Weidmann",
      role: "Dozent",
      defaultExpression: "neutral",
      portraits: {
        neutral: "/story/study/characters/professor-neutral.png",
        warm: "/story/study/characters/professor-warm.png",
        pleased: "/story/study/characters/professor-pleased.png",
      },
    },
    {
      id: "peer",
      name: "Lena",
      role: "Kommilitonin",
      defaultExpression: "neutral",
      portraits: {
        neutral: "/story/study/characters/peer-neutral.png",
        warm: "/story/study/characters/peer-warm.png",
        concerned: "/story/study/characters/peer-concerned.png",
      },
    },
  ],
  sceneOrder: ["campus-arrival", "the-lecture", "study-group"],
  scenes: {
    "campus-arrival": {
      id: "campus-arrival",
      title: "Outside the Lecture Hall",
      background: "/story/study/backgrounds/campus-square.png",
      startBeatId: "p1",
      beats: {
        p1: {
          id: "p1",
          type: "line",
          speakerId: "peer",
          expression: "neutral",
          text: "Hey, bist du auch neu hier? Ich hab dich noch nie gesehen.",
          translation: "Hey, are you new here too? I haven't seen you before.",
          next: "p2",
        },
        p2: {
          id: "p2",
          type: "yourLine",
          speakerId: "peer",
          targetPhrase: "Ja, das ist mein erster Tag. Ich bin ziemlich aufgeregt.",
          translation: "Yes, it's my first day. I'm pretty nervous.",
          next: "p3",
        },
        p3: {
          id: "p3",
          type: "choice",
          speakerId: "peer",
          prompt: "Kein Grund zur Sorge! Möchtest du dich zu mir setzen, oder lieber vorne, näher am Professor?",
          options: [
            {
              id: "sit-together",
              text: "Lass uns zusammen sitzen, das wäre schön.",
              translation: "Let's sit together, that would be nice.",
              next: "p4",
              flavorNote: "Lena lächelt und rückt einen Stuhl für dich zurecht.",
            },
            {
              id: "sit-front",
              text: "Ich setze mich lieber nach vorne, um alles gut zu hören.",
              translation: "I'd rather sit up front so I can hear everything well.",
              next: "p4",
              flavorNote: "Lena nickt — das versteht sie gut.",
            },
          ],
          next: null,
        },
        p4: {
          id: "p4",
          type: "line",
          speakerId: "peer",
          expression: "warm",
          text: "Kein Problem. Komm, die Vorlesung fängt gleich an.",
          translation: "No problem. Come on, the lecture's about to start.",
          next: null,
        },
      },
    },
    "the-lecture": {
      id: "the-lecture",
      title: "The Lecture",
      background: "/story/study/backgrounds/lecture-hall.png",
      startBeatId: "l1",
      beats: {
        l1: {
          id: "l1",
          type: "line",
          speakerId: "professor",
          expression: "neutral",
          text: "Guten Tag zusammen. Ich sehe ein neues Gesicht — mögen Sie sich kurz vorstellen?",
          translation: "Good day everyone. I see a new face — would you like to introduce yourself briefly?",
          next: "l2",
        },
        l2: {
          id: "l2",
          type: "yourLine",
          speakerId: "professor",
          targetPhrase: "Guten Tag, Herr Professor. Ich bin neu hier und freue mich auf das Semester.",
          translation: "Good day, Professor. I'm new here and looking forward to the semester.",
          next: "l3",
        },
        l3: {
          id: "l3",
          type: "line",
          speakerId: "professor",
          expression: "pleased",
          text: "Herzlich willkommen. Dann fangen wir an — heute geht es um die Grundlagen unseres Fachs.",
          translation: "Warm welcome. Let's begin then — today we're covering the fundamentals of our subject.",
          next: "l4",
        },
        l4: {
          id: "l4",
          type: "line",
          speakerId: "professor",
          expression: "warm",
          text: "Ich erwarte, dass Sie sich aktiv beteiligen — Fragen sind hier immer willkommen.",
          translation: "I expect you to participate actively — questions are always welcome here.",
          next: null,
        },
      },
    },
    "study-group": {
      id: "study-group",
      title: "After Class",
      background: "/story/study/backgrounds/student-lounge.png",
      startBeatId: "s1",
      beats: {
        s1: {
          id: "s1",
          type: "line",
          speakerId: "peer",
          expression: "warm",
          text: "Das war doch gar nicht so schlimm, oder? Der Professor mag es, wenn man mitdenkt.",
          translation: "That wasn't so bad after all, was it? The professor likes it when people think along.",
          next: "s2",
        },
        s2: {
          id: "s2",
          type: "yourLine",
          speakerId: "peer",
          targetPhrase: "Stimmt, ich fand die Vorlesung wirklich interessant.",
          translation: "True, I actually found the lecture really interesting.",
          next: "s3",
        },
        s3: {
          id: "s3",
          type: "line",
          speakerId: "peer",
          expression: "warm",
          text: "Ein paar von uns treffen sich immer nach der Vorlesung, um die wichtigsten Punkte zusammenzufassen. Machst du mit?",
          translation: "A few of us always meet after the lecture to summarize the key points. Want to join?",
          next: "s4",
        },
        s4: {
          id: "s4",
          type: "write",
          prompt: "Write a short summary (2–3 sentences) of today's lecture topic for the study group.",
          promptGerman: "Schreiben Sie eine kurze Zusammenfassung (2–3 Sätze) des heutigen Vorlesungsthemas für die Lerngruppe.",
          minWords: 12,
          exampleAnswer:
            "In der heutigen Vorlesung haben wir die Grundlagen unseres Fachs besprochen. Der Professor hat besonders betont, wie wichtig aktive Mitarbeit ist. Ich fand die Beispiele sehr hilfreich zum Verständnis.",
          next: null,
        },
      },
    },
  },
};
