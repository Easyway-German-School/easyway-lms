"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";

/**
 * The first sixty seconds in the portal.
 *
 * A new student lands on a dashboard with thirteen sidebar items and no idea
 * which one matters, so they click Dashboard, see numbers that are all zero,
 * and leave. This walks them through the four things they will actually use,
 * in the order they will need them — and it says out loud what a student on a
 * bad connection most needs to hear, which is that missing a class is
 * survivable because every class is recorded.
 *
 * It runs once per ACCOUNT, not once per device (see
 * `Student.welcomeTourSeenAt`). Skipping counts as seeing it: a student who
 * wants to get on with it should not be asked twice.
 */

type Onboarding = {
  firstName: string | null;
  level: string;
  branchName: string | null;
  isOnlineBranch: boolean;
  sessionSlot: string;
  tourSeen: boolean;
};

type Slide = {
  eyebrow: string;
  title: string;
  body: string;
  art: string;
  /** Brand gradient pair for the slide's stage. */
  from: string;
  to: string;
};

function buildSlides(profile: Onboarding): Slide[] {
  // Dropped entirely when there is no branch on the record, rather than
  // rendering "our branch campus" — a first sentence that reads like a broken
  // mail merge is worse than a shorter one.
  const where = profile.isOnlineBranch
    ? " You study online, so your classroom travels with you."
    : profile.branchName
      ? ` You are at our ${profile.branchName} campus.`
      : "";

  return [
    {
      eyebrow: "Welcome",
      title: profile.firstName ? `Willkommen, ${profile.firstName}.` : "Willkommen.",
      body: `You are starting at ${profile.level}.${where} Here is the whole portal in four screens — under a minute, and you never have to see it again.`,
      art: "👋",
      from: "#0D7C7E",
      to: "#FF6600",
    },
    {
      eyebrow: "Every week",
      title: profile.isOnlineBranch ? "Your class opens in Live class" : "Your timetable lives in Classes",
      body: profile.isOnlineBranch
        ? `Your ${profile.sessionSlot} session runs live over video. Pick your video quality before you join — on mobile data, Data saver keeps the lesson steady instead of frozen.`
        : `Your ${profile.sessionSlot} session, the topic for each day and any material your tutor attaches are all on your Classes calendar.`,
      art: profile.isOnlineBranch ? "🎥" : "🗓️",
      from: "#0D7C7E",
      to: "#0EA5A7",
    },
    {
      eyebrow: "If you miss one",
      title: "Every class is recorded",
      body: "Materials has a Watch tab. Class recordings land there the same day, and the player picks up exactly where your connection dropped. Missing a class costs you minutes, not the lesson.",
      art: "🎬",
      from: "#7C3AED",
      to: "#FF6600",
    },
    {
      eyebrow: "You are not alone in this",
      title: "Your class is in Community",
      body: "Your branch and level have their own space — ask questions between classes, and practise with the people sitting the same exam as you. Students who post in their first week finish at nearly twice the rate.",
      art: "💬",
      from: "#FF6600",
      to: "#FF8533",
    },
  ];
}

export default function WelcomeTour() {
  const [profile, setProfile] = useState<Onboarding | null>(null);
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/student/onboarding", { cache: "no-store" });
        if (!res.ok) return;
        const data: Onboarding = await res.json();
        if (cancelled || data.tourSeen) return;
        setProfile(data);
        setOpen(true);
      } catch {
        // The tour is a nicety. A dashboard that renders without it is fine;
        // one that fails to render because of it is not.
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function finish() {
    setOpen(false);
    // Fire and forget: the tour is already gone from the screen, and a failed
    // write costs the student one repeat, not their session.
    void fetch("/api/student/onboarding", { method: "POST" }).catch(() => {});
  }

  if (!profile) return null;

  const slides = buildSlides(profile);
  const slide = slides[index];
  const isLast = index === slides.length - 1;

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          role="dialog"
          aria-modal="true"
          aria-label="Welcome to your student portal"
          className="fixed inset-0 z-[130] flex items-start justify-center overflow-y-auto overscroll-contain bg-slate-950/80 p-4 backdrop-blur-sm"
        >
          <motion.div
            initial={{ opacity: 0, y: 30, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 240, damping: 24 }}
            className="relative my-auto w-full max-w-xl overflow-hidden rounded-[32px] bg-[var(--surface)] shadow-2xl"
          >
            {/* The stage. Re-keyed per slide so each one animates in fresh. */}
            <div
              className="relative overflow-hidden px-8 py-12 text-center text-white transition-colors duration-500"
              style={{ background: `linear-gradient(135deg, ${slide.from}, ${slide.to})` }}
            >
              {[0, 1].map((ring) => (
                <motion.div
                  key={`${index}-${ring}`}
                  aria-hidden
                  initial={{ scale: 0.5, opacity: 0.45 }}
                  animate={{ scale: 2.2, opacity: 0 }}
                  transition={{ duration: 2.6, delay: ring * 0.9, repeat: Infinity, ease: "easeOut" }}
                  className="pointer-events-none absolute left-1/2 top-1/2 h-40 w-40 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/40"
                />
              ))}

              <motion.div
                key={`art-${index}`}
                initial={{ scale: 0.4, opacity: 0, rotate: -12 }}
                animate={{ scale: 1, opacity: 1, rotate: 0 }}
                transition={{ type: "spring", stiffness: 260, damping: 16 }}
                className="relative mx-auto grid h-24 w-24 place-items-center rounded-3xl bg-white/15 text-5xl backdrop-blur"
              >
                {slide.art}
              </motion.div>

              <motion.p
                key={`eyebrow-${index}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 }}
                className="relative mt-6 text-xs font-semibold uppercase tracking-[0.32em] text-white/75"
              >
                {slide.eyebrow}
              </motion.p>
              <motion.h2
                key={`title-${index}`}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.22 }}
                className="relative mt-2 text-2xl font-bold leading-tight sm:text-3xl"
              >
                {slide.title}
              </motion.h2>
            </div>

            <div className="p-7">
              <motion.p
                key={`body-${index}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.12 }}
                className="min-h-[88px] text-[15px] leading-7 text-[var(--muted)]"
              >
                {slide.body}
              </motion.p>

              <div className="mt-6 flex items-center gap-2">
                {slides.map((_, dot) => (
                  <button
                    key={dot}
                    onClick={() => setIndex(dot)}
                    aria-label={`Go to step ${dot + 1}`}
                    className={`h-1.5 rounded-full transition-all ${
                      dot === index ? "w-8 bg-[var(--accent)]" : "w-4 bg-[var(--border)] hover:bg-[var(--muted)]"
                    }`}
                  />
                ))}
                <span className="ml-auto text-xs text-[var(--muted)]">
                  {index + 1} of {slides.length}
                </span>
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-3">
                <button
                  onClick={() => (isLast ? finish() : setIndex((current) => current + 1))}
                  className="flex-1 rounded-full bg-[var(--accent)] px-6 py-3.5 text-sm font-bold text-white shadow-lg transition hover:brightness-110"
                >
                  {isLast ? "Take me to my dashboard" : "Next"}
                </button>
                {index > 0 ? (
                  <button
                    onClick={() => setIndex((current) => current - 1)}
                    className="rounded-full border border-[var(--border)] px-5 py-3.5 text-sm font-semibold text-[var(--muted)]"
                  >
                    Back
                  </button>
                ) : null}
              </div>

              {!isLast ? (
                <button onClick={finish} className="mt-3 w-full text-center text-xs text-[var(--muted)] hover:underline">
                  Skip the tour
                </button>
              ) : null}
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
