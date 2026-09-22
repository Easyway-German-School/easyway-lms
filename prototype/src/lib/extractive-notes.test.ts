import { describe, expect, it } from "vitest";
import { buildExtractiveNotes, condenseSegments } from "./extractive-notes";

const CLASS = `
Good morning everyone. Can you hear me? Okay, great, let's start.
Today we are going to talk about the accusative case, which is the Akkusativ in German.
The accusative is used for the direct object of a verb. For example, Ich sehe den Mann. I see the man.
Remember that only the masculine article changes: der becomes den in the accusative.
Haus means house. And the German word for car is das Auto. Apple in German is Apfel.
Ich habe einen Hund und eine Katze. Wir haben keinen Fisch.
Who can give me another example with the accusative? Yes, Chioma, go ahead.
Ich kaufe einen Tisch für mein Zimmer. Very good, that is a correct sentence and the article is einen.
Now the difference between nominative and accusative is only visible with masculine nouns, so please remember this rule.
Der Tisch ist neu is nominative because the table is the subject of the sentence. Ich kaufe den Tisch is accusative.
Let's practice the verbs that always take an accusative object: haben, kaufen, sehen, brauchen, essen and trinken.
For homework, please write ten sentences using the accusative and bring them next class.
Also please revise the numbers from one to one hundred for the test on Friday.
Okay. Thank you everyone. See you tomorrow.
`;

describe("buildExtractiveNotes", () => {
  const notes = buildExtractiveNotes(CLASS);

  it("produces notes from a real-looking class", () => {
    expect(notes).not.toBeNull();
    expect(notes!.summary.length).toBeGreaterThan(40);
    expect(notes!.keyPoints.length).toBeGreaterThan(0);
  });

  it("never files pleasantries as notes", () => {
    const all = [notes!.summary, ...notes!.keyPoints].join(" ");
    expect(all).not.toMatch(/can you hear me/i);
    expect(all).not.toMatch(/see you tomorrow/i);
  });

  it("lifts homework into action items", () => {
    const items = notes!.actionItems.join(" ");
    expect(items).toMatch(/homework/i);
    expect(items).toMatch(/revise the numbers/i);
  });

  it("lists only vocabulary the tutor said as a pair", () => {
    const pairs = notes!.vocabulary.map((v) => `${v.de}=${v.en}`.toLowerCase());
    expect(pairs).toContain("haus=house");
    expect(pairs).toContain("das auto=car");
    expect(pairs).toContain("apfel=apple");
    // Never a guessed translation for a word that was only used, not glossed.
    expect(pairs.join(" ")).not.toContain("hund");
  });

  it("refuses to summarise a mic check", () => {
    expect(buildExtractiveNotes("Can you hear me? Yes. Okay. Hello everyone. Can you see my screen? Great.")).toBeNull();
    expect(buildExtractiveNotes("")).toBeNull();
  });

  it("never files the same line said twice as two separate notes", () => {
    // A tutor repeating a rhetorical question while nobody answers, or Whisper
    // stuttering a clause — real transcripts do this. One real class produced
    // the same sentence as three separate "key points".
    const REPEATED = `
      Good morning everyone, today we're going to look at separable verbs in German.
      Aber so ganz legal ist das ja nicht, oder? Wollen Sie denn damit, wenn ich fragen darf?
      Was machen Sie denn damit, wenn ich fragen darf? Aber so ganz legal ist das ja nicht, oder?
      The separable prefix moves to the end of the sentence in the present tense, for example ich stehe auf.
      Aber so ganz legal ist das ja nicht, oder? For homework please write five sentences with separable verbs.
      Remember that trennbare Verben split apart when you conjugate them in a main clause.
      Please revise the vocabulary list before Friday's test and bring your workbook.
    `;
    const notes = buildExtractiveNotes(REPEATED);
    expect(notes).not.toBeNull();
    const all = [notes!.summary, ...notes!.keyPoints, ...notes!.actionItems].join(" | ").toLowerCase();
    // The line appears 3 times verbatim in the transcript — it may be picked ONCE.
    expect((all.match(/ganz legal ist das ja nicht/g) ?? []).length).toBeLessThanOrEqual(1);
    // A near-identical restart of the same question must not sneak in as a second point either.
    expect((all.match(/wenn ich fragen darf/g) ?? []).length).toBeLessThanOrEqual(1);
    // The dedupe must not have swallowed the actually distinct teaching content.
    expect(all).toMatch(/separable/);
  });
});

describe("condenseSegments", () => {
  const segments = Array.from({ length: 200 }, (_, i) => ({
    start: i * 10,
    end: i * 10 + 9,
    text:
      i === 199
        ? "For homework please write ten sentences and bring them next class."
        : i % 7 === 0
          ? "Remember the rule for the accusative article, for example Ich sehe den Mann."
          : "So yeah and then we will see what happens with that thing over there.",
  }));
  const cost = (segment: { text: string }) => segment.text.length + 25;

  it("returns everything when it already fits", () => {
    const { picked, truncated } = condenseSegments(segments.slice(0, 5), cost, 10_000);
    expect(truncated).toBe(false);
    expect(picked).toHaveLength(5);
  });

  it("keeps the closing lines — homework is said last — and stays in budget", () => {
    const budget = 3_000;
    const { picked, truncated } = condenseSegments(segments, cost, budget);
    expect(truncated).toBe(true);
    expect(picked).toContain(199);
    expect(picked).toContain(0);
    expect(picked.reduce((sum, i) => sum + cost(segments[i]), 0)).toBeLessThanOrEqual(budget);
    expect([...picked].sort((a, b) => a - b)).toEqual(picked);
  });
});
