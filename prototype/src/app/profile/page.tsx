"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";

import StudentShell from "@/components/StudentShell";
import BrandLoader from "@/components/BrandLoader";
import { useGamification } from "@/lib/useGamification";
import { uploadImage, validateImageFile } from "@/lib/upload";
import type { Badge, BadgeIcon } from "@/lib/gamification";
import {
  AttendanceIcon,
  CalendarIcon,
  CheckIcon,
  CrossIcon,
  DoorIcon,
  ExamCentreIcon,
  FlagIcon,
  FlameIcon,
  MedalIcon,
  PencilIcon,
  PinIcon,
  SparklesIcon,
  StarIcon,
  TargetIcon,
} from "@/components/icons";

/** The badge list is built server-side and names its icon; this resolves it. */
const BADGE_ICONS: Record<BadgeIcon, typeof FlameIcon> = {
  door: DoorIcon,
  calendar: CalendarIcon,
  flame: FlameIcon,
  pencil: PencilIcon,
  target: TargetIcon,
  landmark: ExamCentreIcon,
  bolt: SparklesIcon,
  flag: FlagIcon,
};

type Profile = {
  studentCode: string;
  fullName: string;
  gender: string;
  dateOfBirth: string;
  email: string;
  phone: string;
  address: string;
  branch: string;
  currentLevel: string;
  currentCourse: string;
  assignedTutor: string;
  registrationDate: string;
  paymentStatus: string;
  preferredExam: string;
  targetRoute: string;
  emergencyContact: string;
  photoUrl: string;
};

const EMPTY_FORM = {
  fullName: "",
  gender: "",
  dateOfBirth: "",
  phone: "",
  email: "",
  address: "",
  branch: "",
  currentLevel: "",
  currentCourse: "",
  preferredExam: "",
};

const TABS = ["Overview", "Achievements", "Details"] as const;
type Tab = (typeof TABS)[number];

function initialsOf(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/** A number that counts up when it first appears, like a game HUD. */
function CountUp({ value, duration = 900 }: { value: number; duration?: number }) {
  const [shown, setShown] = useState(0);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (reduceMotion) {
      setShown(value);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      // easeOutCubic, so it decelerates into the final figure
      const t = Math.min(1, (now - start) / duration);
      setShown(Math.round(value * (1 - Math.pow(1 - t, 3))));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, duration, reduceMotion]);

  return <>{shown.toLocaleString()}</>;
}

function StatPill({
  label,
  value,
  suffix = "",
  icon,
  index,
}: {
  label: string;
  value: number;
  suffix?: string;
  icon: ReactNode;
  index: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 + index * 0.07, type: "spring", stiffness: 120, damping: 16 }}
      // `min-w-0` so a pill can shrink inside the flex row from `sm` up; the
      // grid handles the phone. Without it the row is un-shrinkable again and
      // the clipping comes straight back on a narrow tablet.
      className="min-w-0 flex-1 rounded-3xl border border-white/10 bg-white/[0.06] px-3 py-4 text-center backdrop-blur-xl sm:px-4"
    >
      <p className="flex justify-center text-white/80">{icon}</p>
      <p className="mt-1 text-2xl font-bold text-white sm:text-3xl">
        <CountUp value={value} />
        {suffix}
      </p>
      {/* Tracking that wide turns "Attendance" into an overflow on a 160px
          pill. It keeps the look where there is room and gives it up where
          there is not. */}
      <p className="mt-1 truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)] sm:tracking-[0.22em]">
        {label}
      </p>
    </motion.div>
  );
}

function BadgeTile({ badge, index }: { badge: Badge; index: number }) {
  const BadgeGlyph = BADGE_ICONS[badge.icon] ?? MedalIcon;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: index * 0.05, type: "spring", stiffness: 160, damping: 18 }}
      whileHover={{ y: -4 }}
      className={`relative overflow-hidden rounded-3xl border p-5 text-center transition ${
        badge.earned
          ? "border-[var(--accent)]/40 bg-gradient-to-b from-[var(--accent)]/12 to-transparent shadow-[0_16px_40px_rgba(255,102,0,0.14)]"
          : "border-[var(--border)] bg-[var(--surface-alt)]"
      }`}
    >
      <div
        className={`mx-auto flex h-14 w-14 items-center justify-center rounded-2xl ${
          badge.earned ? "bg-[var(--accent)]/15 text-[var(--accent)]" : "bg-[var(--border)] text-[var(--muted)]"
        }`}
      >
        <BadgeGlyph className="h-7 w-7" />
      </div>
      <p className={`mt-3 text-sm font-bold ${badge.earned ? "text-[var(--foreground)]" : "text-[var(--muted)]"}`}>
        {badge.name}
      </p>
      <p className="mt-1 text-xs text-[var(--muted)]">{badge.description}</p>

      {badge.earned ? (
        <p className="mt-3 text-[10px] font-bold uppercase tracking-[0.24em] text-[var(--accent)]">Earned</p>
      ) : (
        <div className="mt-3">
          <div className="h-1.5 overflow-hidden rounded-full bg-[var(--border)]">
            <motion.div
              className="h-full rounded-full bg-slate-400"
              initial={{ width: 0 }}
              animate={{ width: `${badge.progress}%` }}
              transition={{ duration: 0.8, delay: 0.2 + index * 0.05 }}
            />
          </div>
          <p className="mt-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
            {badge.progress}%
          </p>
        </div>
      )}
    </motion.div>
  );
}

function DetailCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface-alt)] p-5">
      <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-[var(--muted)]">{label}</p>
      <p className="mt-2 text-sm font-medium text-[var(--foreground)]">{value}</p>
    </div>
  );
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [tab, setTab] = useState<Tab>("Overview");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [formState, setFormState] = useState(EMPTY_FORM);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { game } = useGamification();
  const queryClient = useQueryClient();

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const response = await fetch("/api/student/profile");
        if (!response.ok) throw new Error("Could not load your profile");
        const data = await response.json();
        if (!active) return;

        const student = data?.student ?? {};
        const user = data?.user ?? {};
        const admission = student?.admission ?? {};

        const loaded: Profile = {
          // The official code, not the internal cuid — this is what appears on
          // certificates and exam entries.
          studentCode: student?.studentCode || "Not yet issued",
          fullName: user?.name || "Learner",
          gender: admission?.gender || "—",
          dateOfBirth: admission?.dob || "—",
          email: user?.email || "—",
          phone: admission?.phone || "—",
          address: admission?.address || "—",
          branch: student?.branch?.name || admission?.branch || "—",
          currentLevel: student?.level || "A1",
          currentCourse: student?.pathway || "—",
          assignedTutor: student?.tutor?.name || "To be assigned",
          registrationDate: user?.createdAt
            ? new Date(user.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
            : "—",
          paymentStatus: student?.paymentStatus || "Pending",
          preferredExam: admission?.preferredExam || "Not decided yet",
          targetRoute: admission?.targetRoute || "—",
          emergencyContact: admission?.emergencyContactName
            ? `${admission.emergencyContactName} · ${admission.emergencyContactInfo ?? ""}`.trim()
            : "—",
          photoUrl: student?.photoUrl || admission?.photoUrl || "",
        };

        setProfile(loaded);
        setFormState({
          fullName: loaded.fullName,
          gender: loaded.gender === "—" ? "" : loaded.gender,
          dateOfBirth: loaded.dateOfBirth === "—" ? "" : loaded.dateOfBirth,
          phone: loaded.phone === "—" ? "" : loaded.phone,
          email: loaded.email === "—" ? "" : loaded.email,
          address: loaded.address === "—" ? "" : loaded.address,
          branch: loaded.branch === "—" ? "" : loaded.branch,
          currentLevel: loaded.currentLevel,
          currentCourse: loaded.currentCourse === "—" ? "" : loaded.currentCourse,
          preferredExam: loaded.preferredExam,
        });
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : "Could not load your profile");
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  /**
   * Avatars save on their own rather than waiting for the edit form, because a
   * student who picks a photo and then closes the sheet would reasonably expect
   * the photo to have stuck.
   */
  async function handleAvatarChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const invalid = validateImageFile(file);
    if (invalid) {
      setError(invalid);
      return;
    }

    setUploading(true);
    setError("");
    setMessage("");

    try {
      const url = await uploadImage(file);
      if (!url) throw new Error("Upload failed");

      const response = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...formState, photoUrl: url }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || "Could not save your new photo");

      setProfile((prev) => (prev ? { ...prev, photoUrl: url } : prev));
      setMessage("Profile photo updated.");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Could not upload that photo");
    } finally {
      setUploading(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setMessage("");
    setError("");

    try {
      const response = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formState),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || "Unable to save your profile right now.");

      setProfile((prev) =>
        prev
          ? {
              ...prev,
              fullName: formState.fullName || prev.fullName,
              gender: formState.gender || prev.gender,
              dateOfBirth: formState.dateOfBirth || prev.dateOfBirth,
              phone: formState.phone || prev.phone,
              email: formState.email || prev.email,
              address: formState.address || prev.address,
              branch: formState.branch || prev.branch,
              currentLevel: formState.currentLevel || prev.currentLevel,
              currentCourse: formState.currentCourse || prev.currentCourse,
              preferredExam: formState.preferredExam || prev.preferredExam,
            }
          : prev,
      );
      // The level can change tuition and therefore XP, so drop the cached stats.
      queryClient.invalidateQueries({ queryKey: ["student", "gamification"] });
      setMessage("Profile saved.");
      setEditing(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save your profile right now.");
    } finally {
      setSaving(false);
    }
  }

  if (!profile) {
    return (
      <StudentShell>
        <div className="px-6 py-16">
          {error ? <p className="text-center text-sm text-red-600">{error}</p> : <BrandLoader />}
        </div>
      </StudentShell>
    );
  }

  const tier = game?.tier;
  const ring = tier ? `linear-gradient(135deg, ${tier.colors[0]}, ${tier.colors[1]})` : "linear-gradient(135deg, #FF6600, #0D7C7E)";
  const verified = profile.paymentStatus === "Completed";

  return (
    <StudentShell>
      <div className="pb-16">
        {/* ---------- Cinematic cover ---------- */}
        <div className="relative h-64 overflow-hidden sm:h-72">
          <div className="absolute inset-0 bg-[linear-gradient(135deg,_#041418_0%,_#0b2f36_45%,_#12100a_100%)]" />
          {/* Slow drifting colour fields — the "cinematic" part */}
          <motion.div
            className="absolute -left-24 -top-24 h-96 w-96 rounded-full bg-[#0D7C7E]/45 blur-[90px]"
            animate={{ x: [0, 70, 0], y: [0, 40, 0] }}
            transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
          />
          <motion.div
            className="absolute -right-16 top-10 h-80 w-80 rounded-full bg-[#FF6600]/40 blur-[90px]"
            animate={{ x: [0, -60, 0], y: [0, 50, 0] }}
            transition={{ duration: 22, repeat: Infinity, ease: "easeInOut" }}
          />
          <div className="absolute inset-0 bg-[linear-gradient(to_top,_rgba(2,6,23,0.95),_transparent_70%)]" />

          {/* `gap-3` and `min-w-0`, because on a 375px phone the tier pill and
              the Edit button were fighting for the same row: the pill's blurb
              wrapped underneath its own label and the button broke across two
              lines. The eyebrow and the pill now shrink, and the button never
              does — it is the only thing here anybody taps. */}
          <div className="relative flex h-full items-start justify-between gap-3 px-4 py-5 sm:px-10 sm:py-6">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-white/60 sm:tracking-[0.4em]">
                Student profile
              </p>
              {tier && (
                <div
                  className="mt-3 inline-flex max-w-full items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold text-white shadow-lg"
                  style={{ background: ring }}
                >
                  <StarIcon className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{tier.name}</span>
                  {/* The blurb is the first thing to go when there is no room:
                      "Anfänger" is the badge, "Just getting started" is the
                      footnote to it. */}
                  <span className="hidden truncate font-medium opacity-80 sm:inline">· {tier.blurb}</span>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="shrink-0 whitespace-nowrap rounded-full border border-white/25 bg-white/10 px-3.5 py-2 text-[11px] font-bold uppercase tracking-[0.12em] text-white backdrop-blur transition hover:bg-white/20 sm:px-4 sm:text-xs sm:tracking-[0.18em]"
            >
              Edit profile
            </button>
          </div>
        </div>

        {/* ---------- Identity + stats, overlapping the cover ---------- */}
        <div className="relative -mt-24 px-6 sm:px-10">
          <div className="mx-auto max-w-6xl">
            <div className="rounded-[36px] border border-white/10 bg-[linear-gradient(160deg,_rgba(2,15,20,0.96),_rgba(6,25,32,0.92))] p-6 shadow-[0_40px_100px_rgba(2,6,23,0.4)] backdrop-blur-2xl sm:p-8">
              <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-end">
                {/* Avatar with a tier-coloured story ring */}
                <div className="relative shrink-0">
                  <div className="rounded-full p-[3px]" style={{ background: ring }}>
                    <div className="rounded-full border-[3px] border-[#04141a] bg-[#04141a] p-0.5">
                      <div className="relative h-28 w-28 overflow-hidden rounded-full sm:h-32 sm:w-32">
                        {profile.photoUrl ? (
                          <img src={profile.photoUrl} alt={profile.fullName} className="h-full w-full object-cover" />
                        ) : (
                          <div
                            className="flex h-full w-full items-center justify-center text-3xl font-black text-white"
                            style={{ background: ring }}
                          >
                            {initialsOf(profile.fullName) || "EW"}
                          </div>
                        )}

                        <AnimatePresence>
                          {uploading && (
                            <motion.div
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              exit={{ opacity: 0 }}
                              className="absolute inset-0 flex items-center justify-center bg-black/60"
                            >
                              <motion.span
                                className="h-7 w-7 rounded-full border-2 border-white/30 border-t-white"
                                animate={{ rotate: 360 }}
                                transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
                              />
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </div>
                  </div>

                  {/* Camera button. `capture` makes phones offer the camera directly. */}
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    aria-label="Change profile photo"
                    className="absolute -bottom-1 -right-1 flex h-10 w-10 items-center justify-center rounded-full border-[3px] border-[#04141a] bg-[var(--accent)] text-white shadow-lg transition hover:brightness-110 disabled:opacity-60"
                  >
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                      <circle cx="12" cy="13" r="4" />
                    </svg>
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    capture="user"
                    onChange={handleAvatarChange}
                    className="hidden"
                  />

                  {game && (
                    <div className="absolute -left-2 bottom-1 rounded-full border-[3px] border-[#04141a] bg-[var(--surface)] px-2.5 py-1 text-[10px] font-black text-[var(--foreground)]">
                      LVL {game.level}
                    </div>
                  )}
                </div>

                {/* Name block */}
                <div className="flex-1 text-center sm:text-left">
                  <div className="flex items-center justify-center gap-2 sm:justify-start">
                    <h1 className="text-3xl font-black tracking-tight text-white sm:text-4xl">{profile.fullName}</h1>
                    {verified && (
                      <span
                        title="Tuition paid in full"
                        className="flex h-6 w-6 items-center justify-center rounded-full bg-sky-500 text-white"
                      >
                        <CheckIcon className="h-3.5 w-3.5" strokeWidth={3} />
                      </span>
                    )}
                  </div>
                  <p className="mt-1 font-mono text-sm text-[var(--muted)]">@{profile.studentCode}</p>

                  <div className="mt-4 flex flex-wrap justify-center gap-2 sm:justify-start">
                    <span className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-white">
                      {profile.currentLevel} · German
                    </span>
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-white">
                      <PinIcon className="h-3.5 w-3.5" /> {profile.branch}
                    </span>
                    <span
                      className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                        verified ? "bg-emerald-400/15 text-emerald-200" : "bg-amber-400/15 text-amber-200"
                      }`}
                    >
                      {profile.paymentStatus === "Completed" ? "Tuition paid" : `Payment: ${profile.paymentStatus}`}
                    </span>
                  </div>
                </div>
              </div>

              {/* Stat strip.
                  TWO BY TWO ON A PHONE, four across from `sm` up. As a single
                  flex row these four pills needed about 430px and the viewport
                  is 375, so the fourth — attendance — was sliced down the
                  middle and rendered as a stray digit. A grid wraps instead of
                  clipping, which is the difference between a small screen and
                  a broken one. */}
              <div className="mt-8 grid grid-cols-2 gap-3 sm:flex">
                <StatPill index={0} icon={<SparklesIcon className="h-5 w-5" />} label="XP" value={game?.xp ?? 0} />
                <StatPill index={1} icon={<FlameIcon className="h-5 w-5" />} label="Streak" value={game?.streak ?? 0} />
                <StatPill index={2} icon={<MedalIcon className="h-5 w-5" />} label="Badges" value={game?.badgesEarned ?? 0} />
                <StatPill
                  index={3}
                  icon={<AttendanceIcon className="h-5 w-5" />}
                  label="Attendance"
                  value={game?.stats.attendanceRate ?? 0}
                  suffix="%"
                />
              </div>

              {/* XP bar */}
              {game && (
                <div className="mt-6">
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
                    <span>
                      Level {game.level} → {game.level + 1}
                    </span>
                    <span>
                      {game.xpIntoLevel} / {game.xpForNextLevel} XP
                    </span>
                  </div>
                  <div className="mt-2 h-3 overflow-hidden rounded-full bg-white/10">
                    <motion.div
                      className="h-full rounded-full"
                      style={{ background: ring }}
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.max(game.levelProgressPercent, 2)}%` }}
                      transition={{ duration: 1.1, ease: "easeOut" }}
                    />
                  </div>
                </div>
              )}

              {(message || error) && (
                <p className={`mt-5 text-sm ${error ? "text-red-300" : "text-emerald-300"}`}>{error || message}</p>
              )}
            </div>

            {/* ---------- Tabs ---------- */}
            <div className="mt-8 flex gap-1 rounded-full border border-[var(--border)] bg-[var(--surface)] p-1.5">
              {TABS.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setTab(item)}
                  className={`relative flex-1 rounded-full px-4 py-2.5 text-sm font-bold transition ${
                    tab === item ? "text-white" : "text-[var(--muted)] hover:text-[var(--foreground)]"
                  }`}
                >
                  {tab === item && (
                    <motion.span
                      layoutId="profile-tab"
                      className="absolute inset-0 rounded-full bg-[var(--accent)]"
                      transition={{ type: "spring", stiffness: 320, damping: 30 }}
                    />
                  )}
                  <span className="relative">{item}</span>
                </button>
              ))}
            </div>

            {/* ---------- Tab panels ---------- */}
            <div className="mt-6">
              <AnimatePresence mode="wait">
                <motion.div
                  key={tab}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.22 }}
                >
                  {tab === "Overview" && (
                    <div className="grid gap-5 lg:grid-cols-3">
                      <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 lg:col-span-2">
                        <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-[var(--accent)]">
                          Learning snapshot
                        </p>
                        <div className="mt-5 grid gap-4 sm:grid-cols-2">
                          <DetailCard label="Course" value={profile.currentCourse} />
                          <DetailCard label="Level" value={profile.currentLevel} />
                          <DetailCard label="Assigned tutor" value={profile.assignedTutor} />
                          <DetailCard label="Preferred exam" value={profile.preferredExam} />
                          <DetailCard
                            label="Classes attended"
                            value={
                              game
                                ? `${game.stats.sessionsAttended} of ${game.stats.totalSessions}`
                                : "—"
                            }
                          />
                          <DetailCard
                            label="Average score"
                            value={game?.stats.averageGrade != null ? `${game.stats.averageGrade}%` : "Not graded yet"}
                          />
                        </div>
                      </div>

                      <div className="space-y-5">
                        <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6">
                          <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-[var(--accent)]">
                            Exam readiness
                          </p>
                          <p className="mt-4 text-4xl font-black text-[var(--foreground)]">
                            {game?.stats.examReadiness ?? 0}%
                          </p>
                          <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--surface-alt)]">
                            <motion.div
                              className="h-full rounded-full bg-[var(--accent)]"
                              initial={{ width: 0 }}
                              animate={{ width: `${game?.stats.examReadiness ?? 0}%` }}
                              transition={{ duration: 0.9 }}
                            />
                          </div>
                        </div>
                        <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6">
                          <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-[var(--accent)]">
                            Member since
                          </p>
                          <p className="mt-3 text-lg font-bold text-[var(--foreground)]">{profile.registrationDate}</p>
                          <p className="mt-1 text-sm text-[var(--muted)]">
                            {game?.stats.submissions ?? 0} assignments handed in
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {tab === "Achievements" && (
                    <div>
                      <div className="mb-5 flex items-baseline justify-between">
                        <p className="text-sm font-bold text-[var(--foreground)]">
                          {game?.badgesEarned ?? 0} of {game?.badges.length ?? 0} unlocked
                        </p>
                        <p className="text-xs text-[var(--muted)]">Earned from your real class record</p>
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        {(game?.badges ?? []).map((badge, index) => (
                          <BadgeTile key={badge.id} badge={badge} index={index} />
                        ))}
                      </div>
                    </div>
                  )}

                  {tab === "Details" && (
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      <DetailCard label="Full name" value={profile.fullName} />
                      <DetailCard label="Student ID" value={profile.studentCode} />
                      <DetailCard label="Email" value={profile.email} />
                      <DetailCard label="Phone" value={profile.phone} />
                      <DetailCard label="Gender" value={profile.gender} />
                      <DetailCard label="Date of birth" value={profile.dateOfBirth} />
                      <DetailCard label="Address" value={profile.address} />
                      <DetailCard label="Branch" value={profile.branch} />
                      <DetailCard label="Target route" value={profile.targetRoute} />
                      <DetailCard label="Emergency contact" value={profile.emergencyContact} />
                      <DetailCard label="Registered" value={profile.registrationDate} />
                      <DetailCard label="Payment status" value={profile.paymentStatus} />
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>

      {/* ---------- Edit sheet ---------- */}
      <AnimatePresence>
        {editing && (
          <motion.div
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => !saving && setEditing(false)}
          >
            <motion.div
              className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-[32px] bg-[var(--surface)] p-6 shadow-2xl sm:rounded-[32px] sm:p-8"
              initial={{ y: 60, opacity: 0, scale: 0.98 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 40, opacity: 0 }}
              transition={{ type: "spring", stiffness: 200, damping: 26 }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-2xl font-black text-[var(--foreground)]">Edit profile</h2>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    Your name and photo appear across the portal and on your certificates.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="rounded-full p-2 text-[var(--muted)] transition hover:bg-[var(--surface-alt)]"
                  aria-label="Close"
                >
                  <CrossIcon className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-6 flex items-center gap-4 rounded-3xl border border-[var(--border)] bg-[var(--surface-alt)] p-4">
                <div className="h-16 w-16 overflow-hidden rounded-full" style={{ background: ring }}>
                  {profile.photoUrl ? (
                    <img src={profile.photoUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center font-black text-white">
                      {initialsOf(profile.fullName) || "EW"}
                    </div>
                  )}
                </div>
                <div>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white transition hover:brightness-110 disabled:opacity-60"
                  >
                    {uploading ? "Uploading…" : "Change photo"}
                  </button>
                  <p className="mt-1.5 text-xs text-[var(--muted)]">JPG or PNG, up to 5MB.</p>
                </div>
              </div>

              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                {[
                  { label: "Full name", key: "fullName" as const, type: "text" },
                  { label: "Email", key: "email" as const, type: "email" },
                  { label: "Phone", key: "phone" as const, type: "tel" },
                  { label: "Address", key: "address" as const, type: "text" },
                  { label: "Branch", key: "branch" as const, type: "text" },
                  { label: "Current course", key: "currentCourse" as const, type: "text" },
                ].map((field) => (
                  <label key={field.key} className={field.key === "address" ? "sm:col-span-2" : ""}>
                    <span className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--muted)]">
                      {field.label}
                    </span>
                    <input
                      type={field.type}
                      value={formState[field.key]}
                      onChange={(event) =>
                        setFormState((prev) => ({ ...prev, [field.key]: event.target.value }))
                      }
                      className="mt-2 w-full rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/15"
                    />
                  </label>
                ))}

                <label>
                  <span className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--muted)]">Gender</span>
                  <select
                    value={formState.gender}
                    onChange={(event) => setFormState((prev) => ({ ...prev, gender: event.target.value }))}
                    className="mt-2 w-full rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)]"
                  >
                    <option value="">Prefer not to say</option>
                    <option value="Female">Female</option>
                    <option value="Male">Male</option>
                    <option value="Other">Other</option>
                  </select>
                </label>

                <label>
                  <span className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--muted)]">
                    Date of birth
                  </span>
                  <input
                    type="date"
                    value={formState.dateOfBirth}
                    onChange={(event) => setFormState((prev) => ({ ...prev, dateOfBirth: event.target.value }))}
                    className="mt-2 w-full rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)]"
                  />
                </label>

                <label>
                  <span className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--muted)]">Level</span>
                  <select
                    value={formState.currentLevel}
                    onChange={(event) => setFormState((prev) => ({ ...prev, currentLevel: event.target.value }))}
                    className="mt-2 w-full rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)]"
                  >
                    {["A1", "A2", "B1", "B2", "C1", "C2"].map((level) => (
                      <option key={level} value={level}>
                        {level}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  <span className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--muted)]">
                    Preferred exam
                  </span>
                  <select
                    value={formState.preferredExam}
                    onChange={(event) => setFormState((prev) => ({ ...prev, preferredExam: event.target.value }))}
                    className="mt-2 w-full rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)]"
                  >
                    <option value="Not decided yet">Not decided yet</option>
                    <option value="Internal Easyway exam">Internal Easyway exam</option>
                    <option value="OSD">OSD</option>
                    <option value="telc">telc</option>
                  </select>
                </label>
              </div>

              {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

              <div className="mt-7 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="rounded-full bg-[var(--accent)] px-6 py-3 text-sm font-bold text-white shadow-lg shadow-[var(--accent)]/25 transition hover:brightness-110 disabled:opacity-60"
                >
                  {saving ? "Saving…" : "Save changes"}
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  disabled={saving}
                  className="rounded-full border border-[var(--border)] px-6 py-3 text-sm font-bold text-[var(--foreground)] transition hover:bg-[var(--surface-alt)]"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </StudentShell>
  );
}
