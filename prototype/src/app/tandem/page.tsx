"use client";

import { useEffect, useState } from "react";
import GenericTandemChat from "@/components/tandem/GenericTandemChat";
import VisualNovelStory from "@/components/tandem/VisualNovelStory";
import type { StoryChapter } from "@/lib/story/types";
import type { StoryProgress } from "@/lib/story-progress";

type StoryResponse =
  | { available: true; chapter: StoryChapter; progress: StoryProgress }
  | { available: false };

export default function TandemPartner() {
  const [story, setStory] = useState<StoryResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/student/story", { credentials: "include", cache: "no-store" })
      .then((response) => (response.ok ? response.json() : { available: false }))
      .then((data: StoryResponse) => { if (!cancelled) setStory(data); })
      .catch(() => { if (!cancelled) setStory({ available: false }); });
    return () => { cancelled = true; };
  }, []);

  // Nothing personalized yet for this student — including the loading
  // instant itself, since a flash of the wrong experience is worse than a
  // brief delay. Every non-"care" goal falls through here today.
  if (!story || !story.available) return <GenericTandemChat />;

  return <VisualNovelStory chapter={story.chapter} initialProgress={story.progress} />;
}
