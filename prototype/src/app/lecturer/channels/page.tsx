"use client";

export const dynamic = "force-dynamic";

import LecturerShell from "@/components/LecturerShell";
import StaffChannelsView from "@/components/StaffChannelsView";

export default function LecturerChannelsPage() {
  return (
    <LecturerShell>
      <div className="mx-auto max-w-5xl p-4 sm:p-6">
        <StaffChannelsView />
      </div>
    </LecturerShell>
  );
}
