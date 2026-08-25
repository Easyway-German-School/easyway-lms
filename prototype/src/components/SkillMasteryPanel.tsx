"use client";

import { useEffect, useState } from "react";
import { TargetIcon } from "@/components/icons";

/**
 * Per-skill mastery, for every student — not just the private-class ones who
 * already get a version of this in PremiumProgressPanel (which computes its
 * own number from Grade rows, a separate calculation this deliberately does
 * not touch). This reads the same StudentSkillMastery rows the AI lesson
 * planner already uses, via /api/student/mastery.
 *
 * Bands instead of a bare percentage — "50.4%" reads like a grade a language
 * learner has to defend; "Building" just describes where they are.
 */

const SKILL_LABEL: Record<string, string> = {
  grammar: "Grammar",
  vocabulary: "Vocabulary",
  reading: "Reading",
  listening: "Listening",
  speaking: "Speaking",
  writing: "Writing",
};

type SkillRow = { skill: string; mastery: number | null; attempts: number; lastActivityAt: string | null };

function band(mastery: number | null): { label: string; color: string } {
  if (mastery === null) return { label: "Not yet assessed", color: "bg-[var(--border)]" };
  if (mastery < 40) return { label: "Building", color: "bg-amber-400" };
  if (mastery < 70) return { label: "Solid", color: "bg-[var(--accent)]" };
  return { label: "Strong", color: "bg-emerald-500" };
}

export default function SkillMasteryPanel() {
  const [skills, setSkills] = useState<SkillRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/student/mastery", { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (!cancelled) setSkills(data.skills ?? []);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!loaded) return null;

  return (
    <div className="cinematic-card rounded-[32px] p-8">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]">
          <TargetIcon className="h-5 w-5" />
        </span>
        <div>
          <p className="text-sm uppercase tracking-[0.3em] text-[var(--muted)]">Skill mastery</p>
          <h2 className="mt-1 text-lg font-semibold text-[var(--foreground)]">How you&apos;re doing, by skill</h2>
        </div>
      </div>

      <div className="mt-6 space-y-4">
        {skills.map((row) => {
          const b = band(row.mastery);
          return (
            <div key={row.skill}>
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-[var(--foreground)]">{SKILL_LABEL[row.skill] ?? row.skill}</span>
                <span className="text-xs text-[var(--muted)]">{b.label}</span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[var(--surface-alt)]">
                <div
                  className={`h-full rounded-full ${b.color}`}
                  style={{ width: `${row.mastery === null ? 6 : Math.max(6, row.mastery)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
