"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import AdminShell from "@/components/AdminShell";

export default function PersonalizationAdminPage() {
  const { data: session } = useSession();
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadStats = async () => {
      try {
        const res = await fetch("/api/admin/personalization");
        if (!res.ok) throw new Error("Unable to load personalization stats");
        const data = await res.json();
        setStats(data);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    loadStats();
  }, []);

  return (
    <AdminShell>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">Admin</p>
            <h1 className="text-3xl font-bold">Personalization analytics</h1>
            <p className="mt-2 text-sm text-[var(--muted)]">Track planner strategy usage and learning plan health.</p>
          </div>
          {/* Went to /dashboard — the STUDENT portal — from a page inside the
              admin sidebar. "Back" now means back to the admin dashboard. */}
          <Link href="/admin" className="rounded-lg border border-[var(--border)] px-4 py-3 text-sm font-semibold">
            Back to dashboard
          </Link>
        </div>

        {loading ? (
          <div className="rounded-3xl bg-[var(--surface)] p-6">Loading personalization metrics…</div>
        ) : (
          <>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-3xl bg-[var(--surface)] p-6 shadow-sm">
              <p className="text-sm text-[var(--muted)]">Planner strategies</p>
              <p className="mt-3 text-2xl font-bold">{stats?.strategies?.length || 0}</p>
              <p className="mt-2 text-sm text-[var(--accent)]">{(stats?.strategies || []).join(", ")}</p>
            </div>
            <div className="rounded-3xl bg-[var(--surface)] p-6 shadow-sm">
              <p className="text-sm text-[var(--muted)]">Plans cached</p>
              <p className="mt-3 text-2xl font-bold">{stats?.cachedPlans || 0}</p>
              <p className="mt-2 text-sm text-[var(--muted)]">Stored personalization plans in the database.</p>
            </div>
            <div className="rounded-3xl bg-[var(--surface)] p-6 shadow-sm">
              <p className="text-sm text-[var(--muted)]">Active role</p>
              <p className="mt-3 text-2xl font-bold">{(session as any)?.user?.role || "Student"}</p>
              <p className="mt-2 text-sm text-[var(--muted)]">You can use this page to inspect personalization health.</p>
            </div>
          </div>
          <section className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-3xl bg-[var(--surface)] p-6 shadow-sm">
              <h2 className="text-lg font-semibold">Mastery coverage</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">The planner gets stronger as assessed skills accumulate.</p>
              <div className="mt-5 space-y-3">
                {(stats?.masteryBySkill || []).map((row: any) => <div key={row.skill}><div className="flex justify-between text-sm"><span className="capitalize">{row.skill}</span><strong>{row.average}% · {row.learners} learners</strong></div><div className="mt-1 h-2 rounded-full bg-[var(--border)]"><div className="h-2 rounded-full bg-[var(--accent)]" style={{ width: `${Math.min(100, row.average)}%` }} /></div></div>)}
                {!stats?.masteryBySkill?.length ? <p className="text-sm text-[var(--muted)]">No assessed skills yet.</p> : null}
              </div>
            </div>
            <div className="rounded-3xl bg-[var(--surface)] p-6 shadow-sm">
              <h2 className="text-lg font-semibold">Learners needing support</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">Weak signals used to steer future recommendations.</p>
              <div className="mt-4 space-y-2">{(stats?.weakestLearners || []).slice(0, 8).map((row: any, index: number) => <div key={`${row.student}-${row.skill}-${index}`} className="flex items-center justify-between gap-3 border-b border-[var(--border)] py-2 text-sm"><span>{row.student} <span className="text-[var(--muted)]">· {row.skill}</span></span><strong>{Math.round(row.mastery)}%</strong></div>)}{!stats?.weakestLearners?.length ? <p className="text-sm text-[var(--muted)]">No low-mastery learners recorded.</p> : null}</div>
            </div>
          </section>
          </>
        )}
      </div>
    </AdminShell>
  );
}
