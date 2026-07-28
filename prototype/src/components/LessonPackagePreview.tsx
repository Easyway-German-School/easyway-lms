"use client";

import { motion } from "framer-motion";

type LessonPackage = {
  summary: string;
  objectives: string[];
  grammarFocus: string[];
  vocabulary: string[];
  quizQuestions?: Array<{ question: string; type: string; options?: string[]; answer: string }>;
  modules: Array<{ title: string; description: string; lessons: Array<{ title: string; description: string; type: string; duration: number }> }>;
  missions: Array<{ title: string; description: string; reward: string }>;
};

export default function LessonPackagePreview({ lessonPackage }: { lessonPackage: LessonPackage | null }) {
  if (!lessonPackage) return null;

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="rounded-3xl border border-[var(--border)] bg-[var(--surface-alt)] p-6 shadow-sm">
      <h3 className="text-xl font-semibold text-[var(--foreground)]">AI Lesson Package Preview</h3>
      <p className="mt-3 text-sm text-[var(--muted)]">Review the lesson structure, mission path, and focus areas before applying.</p>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl bg-[var(--surface)] p-4">
          <h4 className="font-semibold text-[var(--foreground)]">Summary</h4>
          <p className="mt-2 text-sm text-[var(--muted)]">{lessonPackage.summary}</p>
        </div>
        <div className="rounded-2xl bg-[var(--surface)] p-4">
          <h4 className="font-semibold text-[var(--foreground)]">Objectives</h4>
          <ul className="mt-2 space-y-2 text-sm text-[var(--muted)]">
            {lessonPackage.objectives.map((objective, index) => (
              <li key={index}>• {objective}</li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl bg-[var(--surface)] p-4">
          <h4 className="font-semibold text-[var(--foreground)]">Grammar Focus</h4>
          <div className="mt-2 flex flex-wrap gap-2">
            {lessonPackage.grammarFocus.map((item) => (
              <span key={item} className="rounded-full bg-[var(--accent)]/10 px-3 py-1 text-xs font-semibold text-[var(--accent)]">{item}</span>
            ))}
          </div>
        </div>
        <div className="rounded-2xl bg-[var(--surface)] p-4">
          <h4 className="font-semibold text-[var(--foreground)]">Vocabulary</h4>
          <div className="mt-2 flex flex-wrap gap-2">
            {lessonPackage.vocabulary.map((item) => (
              <span key={item} className="rounded-full bg-[var(--surface-alt)] px-3 py-1 text-xs font-semibold text-[var(--foreground)]">{item}</span>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-6 space-y-4">
        {lessonPackage.modules.map((module, index) => (
          <div key={index} className="rounded-2xl bg-[var(--surface)] p-4">
            <h4 className="font-semibold text-[var(--foreground)]">{module.title}</h4>
            <p className="mt-1 text-sm text-[var(--muted)]">{module.description}</p>
            <div className="mt-3 grid gap-2">
              {module.lessons.map((lesson, lessonIndex) => (
                <div key={lessonIndex} className="rounded-xl bg-[var(--surface-alt)] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium text-[var(--foreground)]">{lesson.title}</p>
                    <span className="text-xs text-[var(--muted)]">{lesson.duration} min</span>
                  </div>
                  <p className="mt-1 text-sm text-[var(--muted)]">{lesson.description}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 rounded-2xl bg-[var(--surface)] p-4">
        <h4 className="font-semibold text-[var(--foreground)]">Generated Missions</h4>
        <div className="mt-3 space-y-3">
          {lessonPackage.missions.map((mission, index) => (
            <div key={index} className="rounded-xl bg-[var(--surface-alt)] p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="font-medium text-[var(--foreground)]">{mission.title}</p>
                <span className="text-xs font-semibold text-[var(--accent)]">{mission.reward}</span>
              </div>
              <p className="mt-1 text-sm text-[var(--muted)]">{mission.description}</p>
            </div>
          ))}
        </div>
      </div>

      {lessonPackage.quizQuestions?.length ? (
        <div className="mt-6 rounded-2xl bg-[var(--surface)] p-4">
          <h4 className="font-semibold text-[var(--foreground)]">Suggested Quiz Questions</h4>
          <div className="mt-3 space-y-3 text-sm text-[var(--muted)]">
            {lessonPackage.quizQuestions.map((question, index) => (
              <div key={index} className="rounded-xl bg-[var(--surface-alt)] p-3">
                <p className="font-medium text-[var(--foreground)]">{index + 1}. {question.question}</p>
                {question.options?.length ? (
                  <p className="mt-1">Options: {question.options.join(", ")}</p>
                ) : null}
                <p className="mt-1 text-xs text-[var(--muted)]">Answer: {question.answer}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </motion.div>
  );
}
