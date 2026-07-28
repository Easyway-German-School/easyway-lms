"use client";

export const dynamic = "force-dynamic";

import StudentShell from "@/components/StudentShell";
import CommunityHub from "@/components/CommunityHub";

export default function CommunityPage() {
  return (
    <StudentShell>
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
    </StudentShell>
  );
}
