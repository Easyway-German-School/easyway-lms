"use client";

import AdminShell from "@/components/AdminShell";
import InfluencerDashboard from "@/components/InfluencerDashboard";

/** A partner's own dashboard. See InfluencerDashboard for why this file is now this short. */
export default function InfluencerDashboardPage() {
  return (
    <AdminShell>
      <InfluencerDashboard mode="self" />
    </AdminShell>
  );
}
