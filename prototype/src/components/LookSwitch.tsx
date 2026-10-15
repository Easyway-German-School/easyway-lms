"use client";

import { SparklesIcon } from "@/components/icons";

export default function LookSwitch() {
  return (
    <div className="mx-auto mt-4 flex max-w-3xl items-center gap-3 px-6 sm:px-10">
      <SparklesIcon className="h-4 w-4 shrink-0 text-[var(--accent)]" />
      <p className="text-xs text-[var(--muted)]">
        You’re using the EasyWay student experience, now available to every student.
      </p>
    </div>
  );
}
