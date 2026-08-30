import type { StoryChapter } from "@/lib/story/types";

/**
 * Second episode of the "study" series — unlocks the day after episode 1
 * completes. Same cast and all three backgrounds reused from episode 1 — no
 * new art needed. A high-stakes group project is announced with
 * professor-assigned (not student-chosen) groups, and ends on an unresolved
 * hook — Lena isn't in the student's group, and one of the unfamiliar
 * groupmates is left dangling mid-sentence.
 */
export const studyEpisode2: StoryChapter = {
  id: "study-second-lecture",
  goalId: "study",
  title: "The Group Project",
  synopsis: "Your second lecture — and a surprise project announcement changes everything.",
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
  sceneOrder: ["back-to-campus", "the-announcement", "the-list"],
  scenes: {
    "back-to-campus": {
      id: "back-to-campus",
      title: "Round Two",
      background: "/story/study/backgrounds/campus-square.png",
      startBeatId: "b1",
      beats: {
        b1: {
          id: "b1",
          type: "line",
          speakerId: "peer",
          expression: "warm",
          text: "Na, bereit für Runde zwei? Ich hab gehört, heute wird's spannend.",
          translation: "So, ready for round two? I heard today's going to be interesting.",
          // Callback to episode 1: only shows if the student left Lena
          // genuinely warm last time — trust is carried across episodes.
          variants: [
            {
              minTrust: 58,
              text: "Na, bereit für Runde zwei? Ehrlich, ich hab mich schon richtig auf dich gefreut heute.",
              translation: "So, ready for round two? Honestly, I was really looking forward to seeing you today.",
            },
          ],
          next: "b2",
        },
        b2: {
          id: "b2",
          type: "yourLine",
          speakerId: "peer",
          targetPhrase: "Wirklich? Was meinst du damit?",
          translation: "Really? What do you mean by that?",
          next: "b3",
        },
        b3: {
          id: "b3",
          type: "choice",
          speakerId: "peer",
          prompt: "Der Professor hat wohl etwas Großes für uns vorbereitet. Bist du aufgeregt oder eher nervös?",
          options: [
            {
              id: "excited",
              text: "Ich bin eher aufgeregt — ich mag Herausforderungen.",
              translation: "I'm more excited — I like challenges.",
              next: "b4",
              flavorNote: "Lena grinst — das gefällt ihr.",
              trustDelta: 4,
            },
            {
              id: "nervous",
              text: "Ehrlich gesagt, ein bisschen nervös.",
              translation: "Honestly, a little nervous.",
              next: "b4",
              flavorNote: "Lena drückt beruhigend deinen Arm.",
              trustDelta: 6,
            },
          ],
          next: null,
        },
        b4: {
          id: "b4",
          type: "line",
          speakerId: "peer",
          expression: "neutral",
          text: "Egal wie — lass uns reingehen, bevor wir zu spät kommen.",
          translation: "Either way — let's get inside before we're late.",
          next: null,
        },
      },
    },
    "the-announcement": {
      id: "the-announcement",
      title: "The Announcement",
      background: "/story/study/backgrounds/lecture-hall.png",
      startBeatId: "a1",
      beats: {
        a1: {
          id: "a1",
          type: "line",
          speakerId: "professor",
          expression: "neutral",
          text: "Guten Tag. Heute kündige ich das Semesterprojekt an — eine Gruppenarbeit, die dreißig Prozent Ihrer Note ausmacht.",
          translation: "Good day. Today I'm announcing the semester project — a group assignment worth thirty percent of your grade.",
          next: "a2",
        },
        a2: {
          id: "a2",
          type: "yourLine",
          speakerId: "professor",
          targetPhrase: "Dreißig Prozent? Das ist eine ganze Menge.",
          translation: "Thirty percent? That's quite a lot.",
          next: "a3",
        },
        a3: {
          id: "a3",
          type: "line",
          speakerId: "professor",
          expression: "neutral",
          text: "Genau deshalb nehme ich die Gruppeneinteilung auch sehr ernst. Die Gruppen werden von mir zugeteilt, nicht von Ihnen.",
          translation: "Exactly why I take the group assignments very seriously. The groups will be assigned by me, not by you.",
          next: "a4",
        },
        a4: {
          id: "a4",
          type: "write",
          prompt: "Write a short note (2–3 sentences) about what topic you'd want your group project to focus on, and why.",
          promptGerman: "Schreiben Sie eine kurze Notiz (2–3 Sätze): Welches Thema würden Sie für Ihr Gruppenprojekt wählen, und warum?",
          minWords: 12,
          exampleAnswer:
            "Ich würde gerne ein aktuelles Thema aus unserem Fach wählen, das auch praktische Relevanz hat. Das würde die Arbeit für die ganze Gruppe interessanter machen. Außerdem könnten wir dabei viel voneinander lernen.",
          next: null,
        },
      },
    },
    "the-list": {
      id: "the-list",
      title: "The List",
      background: "/story/study/backgrounds/student-lounge.png",
      startBeatId: "n1",
      beats: {
        n1: {
          id: "n1",
          type: "line",
          speakerId: "peer",
          expression: "concerned",
          text: "Ich hab die Liste gerade gesehen... wir sind nicht in derselben Gruppe.",
          translation: "I just saw the list... we're not in the same group.",
          next: "n2",
        },
        n2: {
          id: "n2",
          type: "yourLine",
          speakerId: "peer",
          targetPhrase: "Oh nein, wirklich? Mit wem bin ich denn zusammen?",
          translation: "Oh no, really? Who am I with then?",
          next: "n3",
        },
        n3: {
          id: "n3",
          type: "line",
          speakerId: "peer",
          expression: "concerned",
          text: "Das wollte ich dir gerade sagen — dein Gruppenname steht da, aber ich kenne keinen von den anderen dreien. Und einer davon—",
          translation: "That's what I wanted to tell you — your group's names are up there, but I don't recognize any of the other three. And one of them—",
          next: null,
        },
      },
    },
  },
};
