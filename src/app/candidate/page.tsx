"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { signOut, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import BrandLogo from "@/components/BrandLogo";
import MyExamsPanel from "@/components/MyExamsPanel";

/**
 * The exam candidate's view.
 *
 * Someone who booked an ÖSD sitting without being a student. Deliberately a
 * bare shell with no sidebar: there are no classes, materials, community or
 * assignments behind this account, and showing navigation to features they
 * cannot use would only be a series of dead ends.
 */
export default function CandidatePage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [name, setName] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/auth/signin");
      return;
    }
    if (status !== "authenticated") return;

    (async () => {
      try {
        const res = await fetch("/api/my-exams", { cache: "no-store" });
        const data = await res.json();
        // A student who lands here belongs in the full portal.
        if (data.isStudent) {
          router.replace("/exams");
          return;
        }
        setName(data.name ?? null);
      } finally {
        setChecking(false);
      }
    })();
  }, [status, router]);

  if (status === "loading" || checking) {
    return <div className="min-h-screen bg-[var(--background)] p-10 text-sm text-[var(--muted)]">Loading…</div>;
  }

  return (
    <div className="min-h-screen bg-[linear-gradient(135deg,_#f7faff_0%,_#fffbf8_100%)]">
      <header className="border-b border-[var(--border)] bg-white/70 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-6 py-4">
          <BrandLogo variant="wordmark" className="h-9" />
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-[var(--muted)] sm:inline">
              {name ?? session?.user?.email}
            </span>
            <button
              onClick={() => signOut({ callbackUrl: "/auth/signin" })}
              className="rounded-full border border-[var(--border)] px-4 py-2 text-sm font-semibold hover:bg-[var(--surface-alt)]"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-6 py-10">
        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">
          Exam candidate
        </p>
        <h1 className="mt-2 text-3xl font-bold">Your exams</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
          Your bookings, seat numbers and results. You are registered as an exam candidate — if you
          would like to study with us as well, speak to any branch about enrolling.
        </p>

        <div className="mt-8">
          <MyExamsPanel />
        </div>
      </div>
    </div>
  );
}
