"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";

import { CampusAlertsCard, CampusHeader, CoinChip, FaceRow, Flash, GhostToggle, PersonCard, RequestsPanel, useFlash } from "@/components/campus/CampusParts";
import { BookOpenIcon, LockIcon, TargetIcon, UsersIcon } from "@/components/icons";
import { ROOMS, type PresencePerson, type RoomDef } from "@/lib/campus";
import { useCampusLive, useGhost } from "@/lib/useCampus";

/**
 * CAMPUS — the place that makes the app feel inhabited.
 *
 * A street of rooms, each showing who is in it right now. Nothing here is a
 * chat and nothing takes typing: you can see people, wave at them, and
 * challenge them to a game. See lib/campus.ts for why it is built this way
 * (rooms not coordinates, a shared snapshot, separate age bands).
 */

const TINT: Record<string, { bg: string; ink: string; icon: React.ReactNode }> = {
  library: { bg: "#E1F5EE", ink: "#085041", icon: <BookOpenIcon className="h-6 w-6" /> },
  arena: { bg: "#EEEDFE", ink: "#3C3489", icon: <TargetIcon className="h-6 w-6" /> },
  cafe: { bg: "#FAECE7", ink: "#712B13", icon: <UsersIcon className="h-6 w-6" /> },
  exam: { bg: "#FAEEDA", ink: "#633806", icon: <BookOpenIcon className="h-6 w-6" /> },
};

function RoomTile({ room, count, people, more }: { room: RoomDef; count: number; people: PresencePerson[]; more: number }) {
  const tint = TINT[room.id];
  const body = (
    <div
      className={`relative flex min-h-[8.5rem] flex-col justify-between rounded-3xl p-4 transition ${room.open ? "active:scale-[0.97]" : "opacity-70"}`}
      style={{ background: tint.bg, color: tint.ink }}
    >
      <div className="flex items-start justify-between">
        <span className="grid h-11 w-11 place-items-center rounded-2xl bg-white/60">{tint.icon}</span>
        {!room.open ? <LockIcon className="h-4 w-4" strokeWidth={2.2} /> : null}
      </div>
      <div>
        <p className="text-base font-extrabold leading-tight">{room.name}</p>
        <p className="mt-0.5 text-xs opacity-80">{room.open ? room.blurb : "Opening soon"}</p>
        {room.open ? (
          <div className="mt-2 space-y-1.5">
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-bold">
              <span className={`h-2 w-2 rounded-full ${count > 0 ? "bg-emerald-500" : "bg-black/20"}`} />
              {count > 0 ? `${count} here` : "Be the first"}
            </span>
            <div className="min-h-[24px]">
              <FaceRow people={people} more={more} size={24} />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
  return room.open ? <Link href={`/campus/${room.id}`}>{body}</Link> : body;
}

export default function CampusLobbyView() {
  const router = useRouter();
  const { live, isPending, isError } = useCampusLive("lobby", true);
  const ghost = useGhost("lobby");
  const { message, flash } = useFlash();

  const snapshot = live?.snapshot;
  const off = live?.ok === false;

  // Everyone visible on the campus, once each, for the "who's online" list.
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
    <>
      <div className="mx-auto max-w-3xl px-4 pb-10 pt-5 sm:px-6">
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
              <CampusAlertsCard />
            </div>

            <div className="mt-4">
              <RequestsPanel cards={direct} room="lobby" onFlash={flash} onDuel={(id) => router.push(`/campus/duel/${id}`)} />
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              {ROOMS.map((room) => {
                const summary = snapshot?.rooms[room.id];
                return <RoomTile key={room.id} room={room} count={summary?.count ?? 0} people={summary?.people ?? []} more={summary?.more ?? 0} />;
              })}
            </div>

            <section className="mt-7">
              <h2 className="px-1 text-xs font-bold uppercase tracking-[0.2em] text-[var(--muted)]">Who&apos;s around</h2>
              {isPending ? (
                <p className="mt-3 text-sm text-[var(--muted)]">Looking around…</p>
              ) : isError ? (
                <p className="mt-3 text-sm text-[var(--muted)]">Couldn&apos;t reach Campus. It&apos;ll retry on its own.</p>
              ) : everyone.length === 0 ? (
                <div className="mt-3 rounded-3xl border border-dashed border-[var(--border-strong)] p-6 text-center">
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
    </>
  );
}
