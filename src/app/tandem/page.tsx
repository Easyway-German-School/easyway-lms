"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import GenericTandemChat from "@/components/tandem/GenericTandemChat";
import VisualNovelStory from "@/components/tandem/VisualNovelStory";
import { ArrowLeftIcon } from "@/components/icons";
import type { StoryAccessState } from "@/lib/story-progress";

type StoryResponse = { access: StoryAccessState };

/**
 * A fixed way out. Tandem renders no portal sidebar and its inner views fill
 * the screen, so without this the only exit is the browser back button.
 */
function BackToDashboard() {
  return (
    <Link
      href="/dashboard"
      className="fixed left-3 top-3 z-50 inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)]/90 px-3 py-1.5 text-xs font-semibold text-[var(--foreground)] shadow-sm backdrop-blur hover:bg-[var(--surface-alt)]"
    >
      <ArrowLeftIcon /> Dashboard
    </Link>
  );
}

export default function TandemPartner() {
  const [story, setStory] = useState<StoryResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/student/story", { credentials: "include", cache: "no-store" })
      .then((response) => (response.ok ? response.json() : { access: { state: "unavailable" } }))
      .then((data: StoryResponse) => { if (!cancelled) setStory(data); })
      .catch(() => { if (!cancelled) setStory({ access: { state: "unavailable" } }); });
    return () => { cancelled = true; };
  }, []);

  // Nothing personalized yet for this student — including the loading
  // instant itself, since a flash of the wrong experience is worse than a
  // brief delay. Every goal without a story series falls through here.
  // VisualNovelStory itself renders the playable/locked/season-complete
  // states — this component's only job is the top-level available/not switch.
  if (!story || story.access.state === "unavailable") {
    return (
      <>
        <BackToDashboard />
        <GenericTandemChat />
      </>
    );
  }

  return (
    <>
      <BackToDashboard />
      <VisualNovelStory initialAccess={story.access} />
    </>
  );
}
