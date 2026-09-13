"use client";

import Link from "next/link";
import ComingSoonLock from "@/components/ComingSoonLock";
import { ArrowLeftIcon } from "@/components/icons";

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
  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-14">
      <BackToDashboard />
      <ComingSoonLock
        title="AI Tandem Partner"
        description="Conversation practice with your AI partner is on the way. Check back soon."
      />
    </div>
  );
}
