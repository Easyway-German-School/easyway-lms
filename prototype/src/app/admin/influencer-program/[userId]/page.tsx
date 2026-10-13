"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import AdminShell from "@/components/AdminShell";
import InfluencerDashboard from "@/components/InfluencerDashboard";
import { ChevronLeftIcon } from "@/components/icons";

/** The admin's remote view into one partner's own dashboard — see InfluencerDashboard. */
export default function AdminInfluencerDetailPage() {
  const params = useParams<{ userId: string }>();

  return (
    <AdminShell>
      <div className="mb-4">
        <Link href="/admin/influencer-program" className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--muted)] hover:text-[var(--foreground)]">
          <ChevronLeftIcon className="h-4 w-4" />
          All partners
        </Link>
      </div>
      <InfluencerDashboard mode="admin" targetUserId={params.userId} />
    </AdminShell>
  );
}
