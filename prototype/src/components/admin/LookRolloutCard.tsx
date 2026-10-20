"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type { CohortSummary } from "@/lib/look-cohorts";

type Payload = { counts: CohortSummary };

function Count({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl bg-[var(--surface-alt)] p-3">
      <p className="text-xl font-black tabular-nums text-[var(--foreground)]">{value}</p>
      <p className="text-xs font-semibold text-[var(--foreground-soft)]">{label}</p>
    </div>
  );
}

export default function LookRolloutCard() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/admin/look-wave", { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error || "Could not load student look totals.");
        return body as Payload;
      })
      .then((body) => {
        if (active) {
          setData(body);
          setError("");
        }
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : "Could not load student look totals.");
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <section className="mt-6 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-6">
      <h2 className="text-lg font-bold text-[var(--foreground)]">Student experience — enabled for everyone</h2>
      <p className="mt-1 text-xs text-[var(--muted)]">
        Every student now gets the same phone-friendly navigation and updated community, regardless of age or a
        previously saved layout preference.{" "}
        <Link href="/admin/community" className="font-semibold text-[var(--accent)] underline">
          Community → Insights and People
        </Link>
        .
      </p>
      {error ? <p className="mt-3 text-sm font-semibold text-red-600">{error}</p> : null}
      {data ? (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Count label="Using the new experience" value={data.counts.seeingNew} />
          <Count label="Active students" value={data.counts.total} />
          <Count label="Saw Becca’s introduction" value={data.counts.prompted} />
        </div>
      ) : !error ? (
        <p className="mt-4 text-sm text-[var(--muted)]">Loading…</p>
      ) : null}
    </section>
  );
}
