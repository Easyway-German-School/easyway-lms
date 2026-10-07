"use client";

import { useEffect, useState } from "react";

import { CampusRoomCard } from "@/components/campus/CampusParts";
import { YouthBlobs, YouthFace } from "@/components/youth/YouthMotion";
import { ROOMS, type Band, type CampusSnapshot, type PresencePerson } from "@/lib/campus";

const BANDS: Array<{ id: Band; label: string; hint: string }> = [
  { id: "minor", label: "Under 18", hint: "Their own street. Adults never appear here." },
  { id: "adult", label: "18 and over", hint: "The adult campus. Minors never appear here." },
  { id: "unknown", label: "Age unknown", hint: "No birth date on file — kept apart on purpose." },
];

type Payload = {
  enabled: boolean;
  bands: Record<Band, CampusSnapshot & { people: number }>;
};

/**
 * CAMPUS AS THE OFFICE SEES IT — the same street of rooms the youth look uses,
 * every age band, and nobody on the street can tell you are looking. Waves and
 * challenges stay off: watching is not joining.
 */
export default function AdminCampusWatch({ immersive = false }: { immersive?: boolean }) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [band, setBand] = useState<Band>("minor");

  useEffect(() => {
    let active = true;
    const load = () => {
      fetch("/api/admin/campus/observe", { cache: "no-store" })
        .then(async (res) => {
          const body = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(body?.error || "Could not load Campus.");
          return body as Payload;
        })
        .then((body) => active && (setData(body), setError("")))
        .catch((e) => active && setError(e instanceof Error ? e.message : "Could not load Campus."));
    };
    load();
    const timer = window.setInterval(load, 15_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  if (error) return <p className="text-sm font-semibold text-red-600">{error}</p>;
  if (!data) return <p className="text-sm text-[var(--muted)]">Looking at Campus…</p>;
  if (!data.enabled) {
    return (
      <p className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 text-sm text-[var(--muted)]">
        Campus is switched off for this school.
      </p>
    );
  }

  const snap = data.bands[band];
  const everyone: PresencePerson[] = [];
  const seen = new Set<string>();
  for (const room of Object.values(snap.rooms)) {
    for (const p of room.people) {
      if (!seen.has(p.userId)) {
        seen.add(p.userId);
        everyone.push(p);
      }
    }
  }

  return (
    <div className={`relative isolate look-youth ${immersive ? "mx-auto w-full max-w-6xl space-y-5 px-4 py-5 sm:px-8 sm:py-7" : "space-y-4"}`}>
      {immersive ? <YouthBlobs /> : null}
      <div className="relative space-y-5">
        {immersive ? null : (
          <p className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--muted)]">
            You are watching. Students cannot see you, and you do not appear in any room. Age groups stay on separate
            streets — pick one below. This is the same Campus they see (rooms and faces, not a walk-around map).
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {BANDS.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => setBand(b.id)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-bold ${
                band === b.id ? "bg-[var(--accent)] text-white" : "border border-[var(--border)] text-[var(--muted)]"
              }`}
            >
              {b.label}
              {data.bands[b.id].online ? ` · ${data.bands[b.id].online}` : ""}
            </button>
          ))}
        </div>
        <p className="text-xs text-[var(--muted)]">{BANDS.find((b) => b.id === band)?.hint}</p>

        <div className={immersive ? "" : "rounded-[2rem] border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-6"}>
          <div className="flex items-end justify-between gap-3">
            <div>
              <h2 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Campus</h2>
              <p className="text-sm text-[var(--muted)]">
                {snap.online} online now · {snap.studying} studying
              </p>
            </div>
          </div>

          <div className={`mt-4 grid grid-cols-2 gap-3 ${immersive ? "sm:gap-4 lg:grid-cols-4" : ""}`}>
            {ROOMS.map((room) => {
              const summary = snap.rooms[room.id];
              return (
                <CampusRoomCard
                  key={room.id}
                  room={room}
                  count={summary?.count ?? 0}
                  people={summary?.people ?? []}
                  more={summary?.more ?? 0}
                  tall={immersive}
                />
              );
            })}
          </div>

          <section className="mt-7">
            <h3 className="px-1 text-xs font-bold uppercase tracking-[0.2em] text-[var(--muted)]">Who&apos;s around</h3>
            {everyone.length === 0 ? (
              <p className="mt-3 rounded-3xl border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--muted)]">
                Nobody in this group is on Campus right now.
              </p>
            ) : (
              <ul className={`mt-3 ${immersive ? "grid gap-2 sm:grid-cols-2" : "space-y-2"}`}>
                {everyone.map((person) => (
                  <li
                    key={person.userId}
                    className="youth-pop flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5"
                  >
                    <YouthFace config={person.avatar} seed={person.name} size={immersive ? 48 : 40} live />
                    <div className="min-w-0">
                      <p className="truncate font-bold">{person.name}</p>
                      <p className="text-xs text-[var(--muted)]">
                        {person.level} · {person.room === "lobby" ? "wandering" : person.room}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
