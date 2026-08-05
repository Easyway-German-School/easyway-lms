"use client";

export const dynamic = "force-dynamic";

import PortalShell from "@/components/PortalShell";
import CommunityHub from "@/components/CommunityHub";

/**
 * Community is in the student, tutor and admin sidebars alike, so the chrome
 * follows the viewer. It used to be hard-wired to the student shell: a tutor
 * who clicked Community got the student sidebar and every link from there led
 * further into the student portal.
 */
export default function CommunityPage() {
  return (
    <PortalShell>
      <div className="px-6 py-8">
        <div className="mb-6">
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">
            Easyway social hub
          </p>
          <h1 className="mt-2 text-3xl font-bold">Community</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Channels for your branch and level — ask questions, practise, and help each other.
          </p>
        </div>
        <CommunityHub />
      </div>
    </PortalShell>
  );
}
