"use client";

import StudentShell from "@/components/StudentShell";
import NextLevelJourney from "@/components/next-level/NextLevelJourney";

/**
 * Becca's next-level journey. Listed in TUITION_FREE_ROUTES on purpose: a
 * graduate whose portal is locked until the new intake opens is exactly who
 * this is for, and a paywalled upsell page is a dead end.
 */
export default function NextLevelPage() {
  return (
    <StudentShell>
      <NextLevelJourney />
    </StudentShell>
  );
}
