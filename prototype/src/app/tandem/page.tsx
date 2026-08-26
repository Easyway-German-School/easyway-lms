"use client";

import { useEffect, useState } from "react";
import GenericTandemChat from "@/components/tandem/GenericTandemChat";
import VisualNovelStory from "@/components/tandem/VisualNovelStory";
import type { StoryAccessState } from "@/lib/story-progress";

type StoryResponse = { access: StoryAccessState };

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
  if (!story || story.access.state === "unavailable") return <GenericTandemChat />;

  return <VisualNovelStory initialAccess={story.access} />;
}
