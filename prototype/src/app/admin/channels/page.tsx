"use client";

export const dynamic = "force-dynamic";

import AdminShell from "@/components/AdminShell";
import StaffChannelsView from "@/components/StaffChannelsView";

export default function AdminChannelsPage() {
  return (
    <AdminShell>
      <main className="mx-auto max-w-5xl">
        <StaffChannelsView />
      </main>
    </AdminShell>
  );
}
