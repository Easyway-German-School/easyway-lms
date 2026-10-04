"use client";

import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { useState } from "react";

import Avatar from "@/components/Avatar";
import AvatarBuilder from "@/components/AvatarBuilder";
import { CameraIcon, FlameIcon, MedalIcon, PencilIcon, PinIcon, SparklesIcon } from "@/components/icons";
import { BACKGROUNDS, avatarOrDefault } from "@/lib/avatar";
import type { ActivityGrid } from "@/lib/activity-grid";
import type { Badge, BadgeIcon } from "@/lib/gamification";
import type { GamificationPayload } from "@/lib/useGamification";
import { useLook } from "@/lib/useLook";

/**
 * The "Me" screen's top half on the new look — what a profile on the apps
 * students already live in looks like: a face, a handle, a few numbers you can
 * read at a glance, the things you've earned, and a grid that shows you turned
 * up.
 *
 * The record photo is not forgotten. It is the thing that unlocks the portal
 * and only the school ever sees it, so it lives in its own quiet row at the
 * bottom of this card with the camera button — carrying the same
 * `data-guide-target="photo"` the photo-unlock guide points at, so a locked
 * student is still walked straight to it.
 */

const LEVEL_COLORS = [
  "var(--surface-alt)",
  "color-mix(in srgb, var(--accent-strong) 30%, transparent)",
  "color-mix(in srgb, var(--accent-strong) 50%, transparent)",
  "color-mix(in srgb, var(--accent-strong) 75%, transparent)",
  "var(--accent-strong)",
];

const WEEKDAY_LABELS = ["", "Mon", "", "Wed", "", "Fri", ""];

function StudyGrid() {
  const { data } = useQuery<ActivityGrid>({
    queryKey: ["student", "activity"],
    queryFn: async () => {
      const response = await fetch("/api/student/activity", { cache: "no-store" });
      if (!response.ok) throw new Error("Could not load activity");
      return response.json();
    },
    staleTime: 5 * 60_000,
  });

  return (
    <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-extrabold">Your study grid</h3>
        <p className="text-xs text-[var(--muted)]">
          {data ? `${data.activeDays} active ${data.activeDays === 1 ? "day" : "days"} · last 12 weeks` : "Last 12 weeks"}
        </p>
      </div>

      <div className="mt-3 flex gap-1.5">
        <div className="grid grid-rows-7 gap-[3px] pt-px text-[9px] leading-none text-[var(--muted)]">
          {WEEKDAY_LABELS.map((label, i) => (
            <span key={i} className="flex items-center">
              {label}
            </span>
          ))}
        </div>
        <div className="grid min-w-0 flex-1 grid-flow-col grid-cols-12 gap-[3px]" role="img" aria-label="Activity over the last twelve weeks">
          {(data?.weeks ?? Array.from({ length: 12 }, () => Array.from({ length: 7 }, () => null))).map((week, wi) => (
            <div key={wi} className="grid grid-rows-7 gap-[3px]">
              {week.map((cell, di) => (
                <span
                  key={di}
                  title={cell && !cell.future ? `${cell.count} on ${cell.date}` : undefined}
                  className="aspect-square w-full rounded-[3px]"
                  style={{
                    background: cell ? (cell.future ? "transparent" : LEVEL_COLORS[cell.level]) : "var(--surface-alt)",
                  }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between text-[11px] text-[var(--muted)]">
        <span>{data && data.longestRun > 1 ? `Longest run: ${data.longestRun} days` : "Every action counts"}</span>
        <span className="flex items-center gap-1">
          Less
          {LEVEL_COLORS.map((color, i) => (
            <span key={i} className="h-2.5 w-2.5 rounded-[3px]" style={{ background: color }} />
          ))}
          More
        </span>
      </div>
    </div>
  );
}

export default function YouthProfileHero({
  fullName,
  studentCode,
  level,
  branch,
  tierName,
  game,
  badgeIcons,
  photoUrl,
  photoBroken,
  onPhotoBroken,
  uploading,
  onTakePhoto,
  onEditProfile,
}: {
  fullName: string;
  studentCode: string;
  level: string;
  branch: string;
  tierName: string | null;
  game: GamificationPayload | null;
  badgeIcons: Record<BadgeIcon, typeof MedalIcon>;
  photoUrl: string;
  photoBroken: boolean;
  onPhotoBroken: () => void;
  uploading: boolean;
  onTakePhoto: () => void;
  onEditProfile: () => void;
}) {
  const { avatar, saveAvatar, ready } = useLook();
  const [building, setBuilding] = useState(false);

  const shown = avatarOrDefault(avatar, fullName);
  const coverColor = BACKGROUNDS[shown.bg];

  const earned = (game?.badges ?? []).filter((b) => b.earned);
  // Pin up to three: what they have, then the nearest ones they are working towards.
  const closest = (game?.badges ?? []).filter((b) => !b.earned).sort((a, b) => b.progress - a.progress);
  const pinned: Badge[] = [...earned, ...closest].slice(0, 3);

  return (
    <div className="mx-auto max-w-3xl px-4 pt-4 sm:px-6">
      <div className="overflow-hidden rounded-[2rem] border border-[var(--border)] bg-[var(--surface)]">
        {/* The cover takes its colour from the avatar's backdrop, so changing the
            avatar visibly changes the whole card — a small, immediate reward. */}
        <div className="h-28 transition-colors" style={{ background: `linear-gradient(135deg, ${coverColor}, ${coverColor}99)` }} />

        <div className="px-5 pb-5">
          <div className="-mt-14 flex items-end justify-between gap-3">
            <button
              type="button"
              onClick={() => setBuilding(true)}
              aria-label="Edit your avatar"
              className="relative rounded-full border-4 border-[var(--surface)] bg-[var(--surface)] transition active:scale-95"
            >
              <Avatar config={avatar} seed={fullName} size={104} />
              <span className="absolute -bottom-0.5 -right-0.5 grid h-9 w-9 place-items-center rounded-full border-[3px] border-[var(--surface)] bg-[var(--accent)] text-white shadow">
                <PencilIcon className="h-4 w-4" strokeWidth={2.2} />
              </span>
            </button>

            <button
              type="button"
              onClick={onEditProfile}
              className="mb-1 rounded-full border border-[var(--border-strong)] px-4 py-2 text-sm font-bold text-[var(--foreground-soft)] transition active:scale-95"
            >
              Edit profile
            </button>
          </div>

          <h1 className="mt-3 text-2xl font-extrabold tracking-tight">{fullName}</h1>
          <p className="text-sm text-[var(--muted)]">@{studentCode}</p>

          <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
            <span className="rounded-full bg-[var(--accent-strong)]/12 px-3 py-1.5 text-[var(--accent-strong)]">{level} · German</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--surface-alt)] px-3 py-1.5 text-[var(--foreground-soft)]">
              <PinIcon className="h-3.5 w-3.5" /> {branch}
            </span>
            {tierName && (
              <span className="rounded-full bg-[var(--accent)]/12 px-3 py-1.5 text-[var(--accent-ink)]">{tierName}</span>
            )}
          </div>

          {/* First-timers get one obvious thing to do; it disappears once they have. */}
          {ready && !avatar && (
            <button
              type="button"
              onClick={() => setBuilding(true)}
              className="mt-4 flex w-full items-center gap-3 rounded-2xl bg-[var(--accent)] p-3 text-left text-white transition active:scale-[0.98]"
            >
              <Avatar config={null} seed={fullName} size={44} />
              <span className="flex-1">
                <span className="block text-sm font-extrabold">Make your avatar</span>
                <span className="block text-xs opacity-90">This is the face your classmates see.</span>
              </span>
              <SparklesIcon className="h-5 w-5" />
            </button>
          )}

          <div className="mt-5 grid grid-cols-3 gap-2 text-center">
            {[
              { label: "Day streak", value: game?.streak ?? 0, icon: <FlameIcon className="h-4 w-4 text-[var(--accent)]" /> },
              { label: "Level", value: game?.level ?? 1, icon: <SparklesIcon className="h-4 w-4 text-[var(--accent-strong)]" /> },
              { label: "Badges", value: game?.badgesEarned ?? 0, icon: <MedalIcon className="h-4 w-4 text-[var(--warning)]" /> },
            ].map((stat) => (
              <div key={stat.label} className="rounded-2xl bg-[var(--surface-alt)] py-3">
                <div className="flex items-center justify-center gap-1 text-xl font-extrabold">
                  {stat.icon}
                  {stat.value}
                </div>
                <div className="text-[11px] font-semibold text-[var(--muted)]">{stat.label}</div>
              </div>
            ))}
          </div>

          {game && (
            <div className="mt-4">
              <div className="flex justify-between text-[11px] font-semibold text-[var(--muted)]">
                <span>
                  Level {game.level} → {game.level + 1}
                </span>
                <span>
                  {game.xpIntoLevel} / {game.xpForNextLevel} XP
                </span>
              </div>
              <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-[var(--surface-alt)]">
                <motion.div
                  className="h-full rounded-full bg-[var(--accent)]"
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.max(game.levelProgressPercent, 3)}%` }}
                  transition={{ duration: 0.9, ease: "easeOut" }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {pinned.length > 0 && (
        <div className="mt-4 rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <h3 className="text-sm font-extrabold">Pinned badges</h3>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {pinned.map((badge) => {
              const Glyph = badgeIcons[badge.icon] ?? MedalIcon;
              return (
                <div
                  key={badge.id}
                  className={`rounded-2xl p-3 text-center ${
                    badge.earned ? "bg-[var(--accent)]/10" : "bg-[var(--surface-alt)]"
                  }`}
                >
                  <span
                    className={`mx-auto grid h-10 w-10 place-items-center rounded-full ${
                      badge.earned ? "bg-[var(--accent)] text-white" : "bg-[var(--border)] text-[var(--muted)]"
                    }`}
                  >
                    <Glyph className="h-5 w-5" />
                  </span>
                  <p className="mt-2 text-xs font-bold leading-tight">{badge.name}</p>
                  <p className="mt-0.5 text-[10px] text-[var(--muted)]">{badge.earned ? "Earned" : `${badge.progress}%`}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-4">
        <StudyGrid />
      </div>

      {/* The record photo: identity, not decoration. Only the school sees it. */}
      <div className="mt-4 flex items-center gap-3 rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full bg-[var(--surface-alt)]">
          {photoUrl && !photoBroken ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoUrl} alt="Your ID photo" className="h-full w-full object-cover" onError={onPhotoBroken} />
          ) : (
            <span className="grid h-full w-full place-items-center text-[var(--muted)]">
              <CameraIcon className="h-5 w-5" />
            </span>
          )}
          {uploading && <span className="absolute inset-0 grid place-items-center bg-black/50 text-[10px] font-bold text-white">…</span>}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">ID photo</p>
          <p className="text-xs text-[var(--muted)]">Only the school sees this. Classmates see your avatar.</p>
        </div>
        <button
          type="button"
          onClick={onTakePhoto}
          disabled={uploading}
          data-guide-target="photo"
          aria-label="Take a new ID photo"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[var(--accent)] text-white transition active:scale-90 disabled:opacity-60"
        >
          <CameraIcon className="h-5 w-5" />
        </button>
      </div>

      {building && (
        <AvatarBuilder initial={avatar} seed={fullName} onSave={saveAvatar} onClose={() => setBuilding(false)} />
      )}
    </div>
  );
}
