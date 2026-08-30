import { describe as suite, expect, it } from "vitest";

import {
  describeStyle,
  levelRank,
  pickExploration,
  readLearningStyle,
  styleAdjustment,
  styleFromSeed,
  type LessonTouch,
  type LearningStyle,
  type StyleInputs,
} from "./learner-style";

/**
 * Same standard as learner-signals.test.ts: every number this file produces
 * ends up nudging a real student's real study plan. A weighting that changes
 * meaning during a refactor hands everyone a slightly worse plan and nobody
 * notices, which is exactly what a test suite is for.
 */

const NOW = new Date("2026-08-30T12:00:00.000Z");

function touch(partial: Partial<LessonTouch> = {}): LessonTouch {
  return {
    lessonId: `l-${Math.round((partial.score ?? 0) + (partial.nominalMinutes ?? 0))}-${partial.type ?? "lesson"}-${partial.status ?? "completed"}`,
    type: "lesson",
    status: "completed",
    startedAt: NOW.toISOString(),
    completedAt: NOW.toISOString(),
    nominalMinutes: 20,
    score: null,
    level: "A2",
    ...partial,
  };
}

function inputs(partial: Partial<StyleInputs> = {}): StyleInputs {
  return {
    lessonTouches: [],
    grades: [],
    videos: [],
    rhythm: null,
    seed: null,
    studentLevel: "A2",
    ...partial,
  };
}

suite("readLearningStyle — evidence honesty", () => {
  it("returns 'none' and no summary when there is nothing to go on", () => {
    const style = readLearningStyle(inputs(), NOW);
    expect(style.confidence).toBe("none");
    expect(style.summary).toBe("");
    expect(style.formatAffinity.lesson).toBeNull();
  });

  it("stays 'thin' on a handful of points — a nudge, not a steer", () => {
    const style = readLearningStyle(
      inputs({ lessonTouches: [touch(), touch({ type: "quiz" }), touch({ type: "quiz" })] }),
      NOW,
    );
    expect(style.confidence).toBe("thin");
  });

  it("reaches 'fair' after about a fortnight of ordinary use", () => {
    const many = Array.from({ length: 9 }, (_, i) => touch({ type: i % 2 ? "quiz" : "lesson" }));
    const style = readLearningStyle(inputs({ lessonTouches: many }), NOW);
    expect(style.confidence).toBe("fair");
  });

  it("does not invent a format affinity for a format never touched", () => {
    const style = readLearningStyle(inputs({ lessonTouches: [touch(), touch(), touch()] }), NOW);
    expect(style.formatAffinity.lesson).not.toBeNull();
    expect(style.formatAffinity.assignment).toBeNull();
    expect(style.formatAffinity.video).toBeNull();
  });
});

suite("readLearningStyle — format affinity", () => {
  it("rates a format the student finishes higher than one they abandon", () => {
    const style = readLearningStyle(
      inputs({
        lessonTouches: [
          touch({ type: "quiz", status: "completed" }),
          touch({ type: "quiz", status: "completed" }),
          touch({ type: "quiz", status: "completed" }),
          touch({ type: "assignment", status: "started" }),
          touch({ type: "assignment", status: "started" }),
          touch({ type: "assignment", status: "in_progress" }),
        ],
      }),
      NOW,
    );
    expect(style.formatAffinity.quiz as number).toBeGreaterThan(style.formatAffinity.assignment as number);
  });

  it("reads video appetite from the watch library, not from lesson rows", () => {
    const style = readLearningStyle(
      inputs({
        lessonTouches: [touch(), touch(), touch()],
        videos: [
          { completed: true, positionSeconds: 300, durationSeconds: 310, at: NOW.toISOString() },
          { completed: true, positionSeconds: 280, durationSeconds: 290, at: NOW.toISOString() },
          { completed: false, positionSeconds: 20, durationSeconds: 400, at: NOW.toISOString() },
        ],
      }),
      NOW,
    );
    expect(style.formatAffinity.video).not.toBeNull();
    expect(style.formatAffinity.video as number).toBeGreaterThan(0.4);
  });

  it("lets voluntary surface time stand in before anything of that format is finished", () => {
    const style = readLearningStyle(
      inputs({
        lessonTouches: [touch(), touch(), touch()],
        rhythm: {
          avgSessionMinutes: 15,
          bestHours: [20],
          archetype: "steady",
          surfaceShare: { lessons: 0.5, watch: 0.4, dashboard: 0.1 },
        },
      }),
      NOW,
    );
    // Never completed a video, but 40% of their time is in the watch library.
    expect(style.formatAffinity.video).not.toBeNull();
    expect(style.formatAffinity.video as number).toBeGreaterThan(0.4);
  });
});

suite("readLearningStyle — length and grit", () => {
  it("takes the sweet spot from finished lengths, floored to the typical sitting", () => {
    const style = readLearningStyle(
      inputs({
        lessonTouches: [
          touch({ nominalMinutes: 10, status: "completed" }),
          touch({ nominalMinutes: 12, status: "completed" }),
          touch({ nominalMinutes: 45, status: "started" }),
        ],
        rhythm: {
          avgSessionMinutes: 14,
          bestHours: [7],
          archetype: "early_bird",
          surfaceShare: { lessons: 1 },
        },
      }),
      NOW,
    );
    expect(style.sweetSpotMinutes).toBeLessThanOrEqual(14);
    expect(style.sessionShape).toBe("short");
  });

  it("reads grit only once there are at least two stretch attempts", () => {
    const oneStretch = readLearningStyle(
      inputs({ studentLevel: "A2", lessonTouches: [touch({ level: "B1", status: "started" })] }),
      NOW,
    );
    expect(oneStretch.difficultyGrit).toBeNull();

    const bails = readLearningStyle(
      inputs({
        studentLevel: "A2",
        lessonTouches: [
          touch({ level: "B1", status: "started" }),
          touch({ level: "B1", status: "started" }),
          touch({ level: "B2", status: "in_progress" }),
        ],
      }),
      NOW,
    );
    expect(bails.difficultyGrit).toBe(0);
  });
});

suite("styleFromSeed", () => {
  it("turns a signup answer into a gentle prior tagged 'seed'", () => {
    const style = styleFromSeed({ format: "watch", pace: "short" });
    expect(style.confidence).toBe("seed");
    expect(style.evidenceCount).toBe(0);
    expect(style.formatAffinity.video as number).toBeGreaterThan(style.formatAffinity.assignment as number);
    expect(style.sweetSpotMinutes).toBe(10);
  });

  it("is used only to fill gaps once real behaviour exists", () => {
    // Student SAID 'read', but actually finishes every quiz and abandons lessons.
    const style = readLearningStyle(
      inputs({
        seed: { format: "read" },
        lessonTouches: [
          touch({ type: "quiz", status: "completed" }),
          touch({ type: "quiz", status: "completed" }),
          touch({ type: "quiz", status: "completed" }),
          touch({ type: "lesson", status: "started" }),
          touch({ type: "lesson", status: "started" }),
        ],
      }),
      NOW,
    );
    expect(style.confidence).toBe("thin");
    expect(style.formatAffinity.quiz as number).toBeGreaterThan(style.formatAffinity.lesson as number);
  });
});

suite("styleAdjustment — bounded nudge", () => {
  const strong: LearningStyle = {
    confidence: "strong",
    evidenceCount: 30,
    formatAffinity: { lesson: 0.3, quiz: 0.9, assignment: 0.2, discussion: 0.5, video: 0.8 },
    followThrough: 0.7,
    sweetSpotMinutes: 15,
    sessionShape: "short",
    bestHours: [20],
    difficultyGrit: 0.2,
    summary: "",
  };

  it("is zero when there is no style to apply", () => {
    expect(styleAdjustment({ type: "quiz", duration: 15 }, null, 2)).toBe(0);
    expect(styleAdjustment({ type: "quiz", duration: 15 }, { ...strong, confidence: "none" }, 2)).toBe(0);
  });

  it("lifts a loved format and drops an avoided one", () => {
    const lovedQuiz = styleAdjustment({ type: "quiz", duration: 15 }, strong, 2);
    const avoidedAssignment = styleAdjustment({ type: "assignment", duration: 15 }, strong, 2);
    expect(lovedQuiz).toBeGreaterThan(0);
    expect(avoidedAssignment).toBeLessThan(0);
  });

  it("never exceeds the clamp, so it cannot bury an academically-needed lesson", () => {
    const extreme = styleAdjustment({ type: "assignment", duration: 90, level: "C2" }, strong, 2);
    expect(extreme).toBeGreaterThanOrEqual(-12);
    const best = styleAdjustment({ type: "quiz", duration: 15 }, strong, 2);
    expect(best).toBeLessThanOrEqual(12);
  });

  it("penalises a stretch lesson for a student who abandons stretch content", () => {
    const stretch = styleAdjustment({ type: "quiz", duration: 15, level: "B2" }, strong, 2);
    const atLevel = styleAdjustment({ type: "quiz", duration: 15, level: "A2" }, strong, 2);
    expect(stretch).toBeLessThan(atLevel);
  });

  it("scales down with confidence — a thin profile barely moves the queue", () => {
    const thin: LearningStyle = { ...strong, confidence: "thin" };
    const strongPull = Math.abs(styleAdjustment({ type: "assignment", duration: 60 }, strong, 2));
    const thinPull = Math.abs(styleAdjustment({ type: "assignment", duration: 60 }, thin, 2));
    expect(thinPull).toBeLessThan(strongPull);
  });
});

suite("pickExploration", () => {
  const settled: LearningStyle = {
    confidence: "fair",
    evidenceCount: 12,
    formatAffinity: { lesson: 0.8, quiz: 0.3, assignment: 0.2, discussion: 0.2, video: 0.75 },
    followThrough: 0.6,
    sweetSpotMinutes: 15,
    sessionShape: "short",
    bestHours: [20],
    difficultyGrit: 0.5,
    summary: "",
  };

  const ranked = [
    ...Array.from({ length: 8 }, (_, i) => ({ id: `keep-${i}`, type: "lesson", duration: 15, _score: 100 - i })),
    { id: "off-1", type: "assignment", duration: 40, _score: 50 },
    { id: "off-2", type: "quiz", duration: 30, _score: 48 },
    { id: "off-3", type: "lesson", duration: 15, _score: 46 },
  ];

  it("stays silent until the profile is at least 'fair'", () => {
    const thin = pickExploration(ranked, { ...settled, confidence: "thin" }, { keep: 8 });
    expect(thin.picks).toHaveLength(0);
  });

  it("surfaces a fixed slice of off-profile lessons from just past the kept set", () => {
    const rng = () => 0.5;
    const result = pickExploration(ranked, settled, { keep: 8, ratio: 0.15 }, rng);
    expect(result.picks.length).toBeGreaterThanOrEqual(1);
    // 'lesson' is a preferred format, so off-1 / off-2 (assignment / quiz) win.
    expect(result.picks.every((p) => p.id.startsWith("off"))).toBe(true);
    expect(result.picks.some((p) => p.id === "off-3")).toBe(false);
    expect(result.reason).toMatch(/outside your usual pattern/);
  });

  it("returns nothing when there is no band past the kept set", () => {
    expect(pickExploration(ranked.slice(0, 8), settled, { keep: 8 }).picks).toHaveLength(0);
  });
});

suite("describeStyle", () => {
  it("claims a lead format only when one clearly leads", () => {
    const clear = describeStyle(
      {
        confidence: "fair",
        evidenceCount: 10,
        formatAffinity: { lesson: 0.2, quiz: 0.85, assignment: 0.2, discussion: 0.2, video: 0.3 },
        followThrough: 0.7,
        sweetSpotMinutes: 12,
        sessionShape: "short",
        bestHours: [20],
        difficultyGrit: null,
        summary: "",
      },
      { avgSessionMinutes: 12, bestHours: [20], archetype: "steady", surfaceShare: {} },
    );
    expect(clear).toMatch(/quizzes/);
    expect(clear).toMatch(/8pm/);
  });

  it("says so plainly when it is still running on the signup answer", () => {
    expect(describeStyle(styleFromSeed({ format: "mixed" }), null)).toMatch(/sign-up/);
  });
});

suite("levelRank", () => {
  it("orders the CEFR ladder and defaults the unknown to A2", () => {
    expect(levelRank("B2")).toBeGreaterThan(levelRank("A1"));
    expect(levelRank(null)).toBe(levelRank("A2"));
    expect(levelRank("nonsense")).toBe(2);
  });
});
