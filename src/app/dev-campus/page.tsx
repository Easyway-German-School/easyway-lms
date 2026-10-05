"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import ArenaView from "@/components/campus/ArenaView";
import CampusLobbyView from "@/components/campus/CampusLobbyView";
import DuelView from "@/components/campus/DuelView";
import LibraryView from "@/components/campus/LibraryView";
import YouthTabBar from "@/components/YouthTabBar";
import { hashAvatar } from "@/lib/avatar";
import { summariseCampus, type PresencePerson, type PresenceRoom } from "@/lib/campus";
import { campusBeatKey, campusLiveKey, type LiveState } from "@/lib/useCampus";

/**
 * Campus with mock people and a simulated duel opponent. Development only.
 *
 * The real screens sit behind a sign-in and a database. This renders them from a
 * seeded query cache and a stubbed `fetch`, so the layout and the duel's
 * feel — the instant right/wrong colour, the waiting screen, the result card —
 * can be reviewed at phone width in seconds.
 */

const NAMES: Array<[string, string, PresenceRoom]> = [
  ["Chidi A.", "B1", "library"],
  ["Ngozi U.", "A2", "library"],
  ["Tunde B.", "A1", "arena"],
  ["Sade K.", "A1", "library"],
  ["Emeka O.", "B1", "lobby"],
  ["Funmi L.", "A2", "arena"],
  ["Ife M.", "A1", "library"],
  ["Bola S.", "B2", "library"],
  ["Zainab R.", "A2", "lobby"],
];

const PEOPLE: PresencePerson[] = NAMES.map(([name, level, room], i) => ({
  userId: `u${i}`,
  name,
  avatar: hashAvatar(name),
  level,
  room,
}));

const WORDS = [
  ["Tisch", "table", "der"],
  ["Katze", "cat", "die"],
  ["Haus", "house", "das"],
  ["Apfel", "apple", "der"],
  ["Schule", "school", "die"],
  ["Buch", "book", "das"],
  ["Hund", "dog", "der"],
  ["Tür", "door", "die"],
] as const;

function liveState(room: PresenceRoom): LiveState {
  return {
    ok: true,
    incoming: 2,
    balance: 126,
    hidden: false,
    snapshot: summariseCampus(PEOPLE, "me"),
    requests: {
      direct: [
        { id: "r1", kind: "wave", open: false, from: { userId: "u0", name: "Chidi A.", avatar: hashAvatar("Chidi A."), level: "B1" }, expiresAt: new Date(Date.now() + 200_000).toISOString() },
        { id: "r2", kind: "duel", open: false, from: { userId: "u5", name: "Funmi L.", avatar: hashAvatar("Funmi L."), level: "A2" }, expiresAt: new Date(Date.now() + 150_000).toISOString() },
      ],
      open: [
        { id: "r3", kind: "duel", open: true, from: { userId: "u2", name: "Tunde B.", avatar: hashAvatar("Tunde B."), level: "A1" }, expiresAt: new Date(Date.now() + 120_000).toISOString() },
      ],
    },
  };
}

function makeClient() {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  for (const room of ["lobby", "library", "arena", "cafe", "exam"] as PresenceRoom[]) client.setQueryData(campusLiveKey(room), liveState(room));
  client.setQueryData(campusBeatKey, liveState("lobby"));
  return client;
}

/** A tiny fake server for the duel, so the screen can be played end to end. */
function installFakeServer(state: { mine: Array<{ i: number; choice: string; correct: boolean; points: number; article: string }>; oppAnswered: number }) {
  const real = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("/api/campus/duel/")) {
      if (init?.method === "POST") {
        const { i, choice } = JSON.parse(String(init.body));
        const [, , article] = WORDS[i];
        const correct = choice === article;
        const points = correct ? 140 : 0;
        state.mine.push({ i, choice, correct, points, article });
        const finished = state.mine.length >= WORDS.length;
        return new Response(JSON.stringify({ ok: true, correct, article, points, finished, coins: finished ? 8 : 0 }), { status: 200 });
      }
      // The opponent creeps along while you play.
      state.oppAnswered = Math.min(WORDS.length, state.oppAnswered + 1);
      const done = state.mine.length >= WORDS.length && state.oppAnswered >= WORDS.length;
      const myPoints = state.mine.reduce((s, a) => s + a.points, 0);
      return new Response(
        JSON.stringify({
          id: "demo",
          level: "A1",
          status: done ? "done" : "active",
          total: WORDS.length,
          questions: WORDS.map(([noun, gloss]) => ({ noun, gloss })),
          mine: state.mine,
          myPoints,
          opponent: { name: "Chidi A.", avatar: hashAvatar("Chidi A."), answered: state.oppAnswered, finished: state.oppAnswered >= WORDS.length },
          result: done ? { winner: myPoints >= 800 ? "me" : "them", myPoints, theirPoints: 760 } : null,
        }),
        { status: 200 },
      );
    }
    if (url.includes("/api/campus/")) return new Response(JSON.stringify({ id: "x", coins: 3, ok: true, duelId: "demo" }), { status: 200 });
    return real(input, init);
  };
  return () => {
    window.fetch = real;
  };
}

type Screen = "lobby" | "library" | "arena" | "duel";

export default function DevCampus() {
  const client = useMemo(makeClient, []);
  const [screen, setScreen] = useState<Screen>("lobby");
  const [run, setRun] = useState(0);

  useEffect(() => installFakeServer({ mine: [], oppAnswered: 2 }), [run]);

  if (process.env.NODE_ENV === "production") return null;

  return (
    <QueryClientProvider client={client}>
      <div className="look-youth app-canvas min-h-screen pb-28 text-[var(--foreground)]">
        <div className="flex flex-wrap gap-2 p-3 text-xs">
          {(["lobby", "library", "arena", "duel"] as Screen[]).map((s) => (
            <button
              key={s}
              className={`rounded-full border px-3 py-1 ${screen === s ? "bg-[var(--accent)] text-white" : ""}`}
              onClick={() => {
                setScreen(s);
                setRun((n) => n + 1);
              }}
            >
              {s}
            </button>
          ))}
        </div>

        <div key={`${screen}-${run}`}>
          {screen === "lobby" ? <CampusLobbyView /> : null}
          {screen === "library" ? <LibraryView /> : null}
          {screen === "arena" ? <ArenaView /> : null}
          {screen === "duel" ? <DuelView id="demo" /> : null}
        </div>

        <YouthTabBar unreadChats={0} campusIncoming={2} liveNow={false} avatar={hashAvatar("Me")} name="Me Tester" />
      </div>
    </QueryClientProvider>
  );
}
