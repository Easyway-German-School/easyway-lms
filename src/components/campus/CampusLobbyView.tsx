"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { motion } from "framer-motion";

import { CampusAlertsCard, CampusHeader, CampusRoomCard, CoinChip, Flash, GhostToggle, PersonCard, RequestsPanel, useFlash } from "@/components/campus/CampusParts";
import { YouthBlobs, YouthStoryStrip, youthStagger } from "@/components/youth/YouthMotion";
import { ROOMS, type PresencePerson } from "@/lib/campus";
import { useCampusLive, useGhost } from "@/lib/useCampus";

/**
 * CAMPUS — the place that makes the app feel inhabited.
 *
 * A street of rooms, each showing who is in it right now. Nothing here is a
 * chat and nothing takes typing: you can see people, wave at them, and
 * challenge them to a game. See lib/campus.ts for why it is built this way
 * (rooms not coordinates, a shared snapshot, separate age bands).
 */

export default function CampusLobbyView() {
  const router = useRouter();
  const { live, isPending, isError } = useCampusLive("lobby", true);
  const ghost = useGhost("lobby");
  const { message, flash } = useFlash();

  const snapshot = live?.snapshot;
  const off = live?.ok === false;

  const everyone = useMemo<PresencePerson[]>(() => {
    if (!snapshot) return [];
    const seen = new Set<string>();
    const out: PresencePerson[] = [];
    for (const room of Object.values(snapshot.rooms)) {
      for (const p of room.people) {
        if (!seen.has(p.userId)) {
          seen.add(p.userId);
          out.push(p);
        }
      }
    }
    return out;
  }, [snapshot]);

  const direct = live?.requests?.direct ?? [];

  return (
    <div className="relative isolate">
      <YouthBlobs />
      <div className="relative mx-auto max-w-3xl px-4 pb-10 pt-5 sm:px-6">
        <CampusHeader
          title="Campus"
          subtitle={
            snapshot ? `${snapshot.online} online now · ${snapshot.studying} studying` : off ? undefined : "Finding who's around…"
          }
          right={<CoinChip balance={live?.balance} />}
        />

        {off ? (
          <div className="mt-6 rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 text-center">
            <p className="text-base font-extrabold">
              {live?.reason === "off" ? "Campus is taking a break" : live?.reason === "locked" ? "Campus opens when your tuition is up to date" : "Campus is for students"}
            </p>
            <p className="mt-1 text-sm text-[var(--muted)]">
              {live?.reason === "off" ? "The school has paused it for now. It'll be back." : "Everything else in the app works as normal."}
            </p>
          </div>
        ) : (
          <>
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-xs text-[var(--muted)]">{live?.hidden ? "You're hidden — others can't see you here." : "You only ever see students in your own age group."}</p>
              <GhostToggle hidden={Boolean(live?.hidden)} busy={ghost.isPending} onChange={(next) => ghost.mutate(next)} />
            </div>

            <div className="mt-4">
              <YouthStoryStrip
                people={everyone.map((p) => ({
                  id: p.userId,
                  name: p.name,
                  avatar: p.avatar,
                  live: true,
                }))}
                onPick={(id) => {
                  const person = everyone.find((p) => p.userId === id);
                  if (person && person.room !== "lobby") router.push(`/campus/${person.room}`);
                }}
              />
            </div>

            <div className="mt-4">
              <CampusAlertsCard />
            </div>

            <div className="mt-4">
              <RequestsPanel cards={direct} room="lobby" onFlash={flash} onDuel={(id) => router.push(`/campus/duel/${id}`)} />
            </div>

            <motion.div className="mt-4 grid grid-cols-2 gap-3" variants={youthStagger} initial="hidden" animate="show">
              {ROOMS.map((room) => {
                const summary = snapshot?.rooms[room.id];
                return (
                  <motion.div key={room.id} variants={{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } }}>
                    <CampusRoomCard
                      room={room}
                      count={summary?.count ?? 0}
                      people={summary?.people ?? []}
                      more={summary?.more ?? 0}
                      href={`/campus/${room.id}`}
                    />
                  </motion.div>
                );
              })}
            </motion.div>

            <section className="mt-7">
              <h2 className="px-1 text-xs font-bold uppercase tracking-[0.2em] text-[var(--muted)]">Who&apos;s around</h2>
              {isPending ? (
                <p className="mt-3 text-sm text-[var(--muted)]">Looking around…</p>
              ) : isError ? (
                <p className="mt-3 text-sm text-[var(--muted)]">Couldn&apos;t reach Campus. It&apos;ll retry on its own.</p>
              ) : everyone.length === 0 ? (
                <div className="youth-pop mt-3 rounded-3xl border border-dashed border-[var(--border-strong)] p-6 text-center">
                  <p className="text-sm font-extrabold">It&apos;s quiet right now</p>
                  <p className="mt-1 text-sm text-[var(--muted)]">Step into the Library — others will see you there and join in.</p>
                  <Link href="/campus/library" className="mt-3 inline-block rounded-full bg-[var(--accent)] px-5 py-2.5 text-sm font-extrabold text-white">
                    Open the Library
                  </Link>
                </div>
              ) : (
                <ul className="mt-3 space-y-2">
                  {everyone.map((person) => (
                    <PersonCard key={person.userId} person={person} room="lobby" onFlash={flash} />
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
      <Flash message={message} />
    </div>
  );
}
