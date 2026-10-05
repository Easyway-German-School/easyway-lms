"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

import NewLookMoment from "@/components/moment/NewLookMoment";
import YouthProfileHero from "@/components/YouthProfileHero";
import YouthTabBar from "@/components/YouthTabBar";
import {
  DoorIcon,
  CalendarIcon,
  FlameIcon,
  PencilIcon,
  TargetIcon,
  ExamCentreIcon,
  SparklesIcon,
  FlagIcon,
} from "@/components/icons";
import { buildActivityGrid } from "@/lib/activity-grid";
import { hashAvatar } from "@/lib/avatar";
import type { GamificationPayload } from "@/lib/useGamification";
import { lookQueryKey } from "@/lib/useLook";

/**
 * The youth look's two big new pieces with mock data. Development only.
 *
 * The real screens sit behind a sign-in and a database; this renders the tab
 * bar and the profile hero from a seeded query cache so the layout can be
 * reviewed at phone width in seconds, with no account.
 */

const ICONS = { door: DoorIcon, calendar: CalendarIcon, flame: FlameIcon, pencil: PencilIcon, target: TargetIcon, landmark: ExamCentreIcon, bolt: SparklesIcon, flag: FlagIcon };

const GAME = {
  xp: 640,
  level: 3,
  xpIntoLevel: 140,
  xpForNextLevel: 250,
  levelProgressPercent: 56,
  tier: { name: "Entdecker", from: 3, colors: ["#0D7C7E", "#12939a"], blurb: "Finding your rhythm" },
  streak: 12,
  badgesEarned: 3,
  stats: { sessionsAttended: 18, totalSessions: 20, attendanceRate: 90, submissions: 6, completedLessons: 9, averageGrade: 82, examsRegistered: 0, missionsCompleted: 11, examReadiness: 40, memberSince: "2026-09-01" },
  badges: [
    { id: "a", name: "Erste Schritte", description: "", icon: "door", earned: true, progress: 100 },
    { id: "b", name: "Sieben Tage", description: "", icon: "flame", earned: true, progress: 100 },
    { id: "c", name: "Fleißig", description: "", icon: "pencil", earned: true, progress: 100 },
    { id: "d", name: "Stammgast", description: "", icon: "calendar", earned: false, progress: 80 },
  ],
} as unknown as GamificationPayload;

function seeded(saved: boolean, prompt: "announce" | "invite" | null = null) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  client.setQueryData(lookQueryKey, { look: "youth", reason: "wave", inWave: true, prompt, name: "Ada Okafor", avatar: saved ? hashAvatar("Ada Okafor") : null });
  const days: string[] = [];
  for (let i = 0; i < 80; i += 1) {
    if ((i * 7) % 5 < 3) for (let n = 0; n <= (i * 3) % 4; n += 1) days.push(new Date(Date.now() - i * 86_400_000).toISOString());
  }
  client.setQueryData(["student", "activity"], buildActivityGrid(days));
  return client;
}

export default function DevYouth() {
  const [saved, setSaved] = useState(true);
  const [client, setClient] = useState(() => seeded(true));
  const [live, setLive] = useState(false);
  const [popup, setPopup] = useState(0);

  if (process.env.NODE_ENV === "production") return null;

  return (
    <QueryClientProvider client={client}>
      <div className="look-youth app-canvas min-h-screen pb-28 text-[var(--foreground)]">
        <div className="flex flex-wrap gap-2 p-3 text-xs">
          <button
            className="rounded-full border px-3 py-1"
            onClick={() => {
              setSaved(!saved);
              setClient(seeded(!saved));
            }}
          >
            {saved ? "Show: no avatar yet" : "Show: avatar saved"}
          </button>
          <button className="rounded-full border px-3 py-1" onClick={() => { setClient(seeded(saved, "announce")); setPopup((n) => n + 1); }}>
            Popup: announce
          </button>
          <button className="rounded-full border px-3 py-1" onClick={() => { setClient(seeded(saved, "invite")); setPopup((n) => n + 1); }}>
            Popup: invite
          </button>
          <button className="rounded-full border px-3 py-1" onClick={() => setLive(!live)}>
            {live ? "Live: on" : "Live: off"}
          </button>
        </div>

        <YouthProfileHero
          fullName="Ada Okafor"
          studentCode="EW/2026/A1/OCT/0007"
          level="A1"
          branch="Lagos · Ikeja"
          tierName="Entdecker"
          game={GAME}
          badgeIcons={ICONS}
          photoUrl=""
          photoBroken={false}
          onPhotoBroken={() => {}}
          uploading={false}
          onTakePhoto={() => {}}
          onEditProfile={() => {}}
        />

        <NewLookMoment key={popup} />

        <YouthTabBar unreadChats={3} liveNow={live} avatar={saved ? hashAvatar("Ada Okafor") : null} name="Ada Okafor" />
      </div>
    </QueryClientProvider>
  );
}
