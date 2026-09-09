"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import Mascot from "@/components/Mascot";
import { SpotlightArrow, SpotlightMask, inflate, useTargetRect } from "@/components/Spotlight";
import { isPhotoGatedRoute } from "@/lib/access";
import { useStudentAccess } from "@/lib/useStudentAccess";

/**
 * Becca walks a PAID, photo-less student to the one control that unlocks their
 * portal.
 *
 * The photo gate (PhotoLockScreen, StudentShell) is independent of the paywall,
 * so a student who has paid still meets a locked portal on every class page and
 * reads it as "my payment is broken". The plain lock screen tells them it is a
 * photo; it does not take them to the button. Students glaze past it and the
 * office fields the complaint.
 *
 * This is a hard RENDER-GATE, not a moment-queue entry — same category as the
 * lock screen it sits on top of. It shows whenever server truth
 * (`hasAccess && !hasPhoto`) says so, is not subject to the two-modal cap, and
 * has no dismiss: no close button, no backdrop click, no Escape. Wriggle out
 * (reload, back button, another tab) and it re-arms, because nothing about it
 * is a one-shot flag.
 *
 * Three states, decided by route:
 *   LOCK   on a photo-gated page — a full-screen Becca card over the lock
 *          screen, one button: "Show me". Sends them to /profile.
 *   POINT  on /profile — a spotlight on the camera control, Becca pointing.
 *   DONE   the photo just landed — a short "You're in" beat, then it unmounts.
 *
 * The one way out that is NOT a photo: "Trouble uploading? Message the office"
 * opens the help panel (the office can set a photo from the admin student page).
 * Surfaced quietly, then prominently after two failed upload attempts — so a
 * broken uploader, which shipped to prod as recently as PR #68, never fully
 * traps anyone. /payments and /notifications also stay reachable throughout.
 */

const TARGET = '[data-guide-target="photo"]';
/** After this long with no camera control found, fall back to a plain button. */
const TARGET_TIMEOUT_MS = 2600;
const DONE_BEAT_MS = 1500;

export default function PhotoUnlockGuide() {
  const { access } = useStudentAccess();
  const pathname = usePathname();
  const router = useRouter();
  const reduceMotion = useReducedMotion();

  const paid = access?.hasAccess === true;
  const hasPhoto = access?.hasPhoto === true;
  const photoless = paid && access?.hasPhoto === false;

  const onProfile = pathname === "/profile";
  const onGatedPage = isPhotoGatedRoute(pathname);

  // "They just fixed it" — celebrate only if we were mid-guide on /profile.
  const wasPhotoless = useRef(false);
  const [celebrating, setCelebrating] = useState(false);
  useEffect(() => {
    if (access == null) return;
    if (wasPhotoless.current && hasPhoto && onProfile) {
      setCelebrating(true);
      const t = window.setTimeout(() => setCelebrating(false), DONE_BEAT_MS);
      return () => window.clearTimeout(t);
    }
    wasPhotoless.current = photoless;
  }, [access, hasPhoto, photoless, onProfile]);

  // Upload failures, reported by the profile page. Two of them promote the
  // "message the office" link from a footnote to a real option.
  const [failures, setFailures] = useState(0);
  useEffect(() => {
    const bump = () => setFailures((n) => n + 1);
    window.addEventListener("easyway:photo-upload-failed", bump);
    return () => window.removeEventListener("easyway:photo-upload-failed", bump);
  }, []);

  const active = photoless && (onGatedPage || onProfile);

  // Lock the page scroll only for the full-screen LOCK card. On /profile the
  // student needs to reach the control, and the fallback button, by scrolling.
  useEffect(() => {
    if (!active || !onGatedPage) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [active, onGatedPage]);

  const [viewport, setViewport] = useState({ width: 1024, height: 768 });
  useEffect(() => {
    const measure = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const rect = useTargetRect(active && onProfile ? TARGET : undefined, pathname);
  const [targetMissing, setTargetMissing] = useState(false);
  useEffect(() => {
    if (!active || !onProfile) {
      setTargetMissing(false);
      return;
    }
    if (rect) {
      setTargetMissing(false);
      return;
    }
    const t = window.setTimeout(() => setTargetMissing(true), TARGET_TIMEOUT_MS);
    return () => window.clearTimeout(t);
  }, [active, onProfile, rect]);

  const openHelp = () => window.dispatchEvent(new CustomEvent("easyway:open-help"));
  const openCamera = () => {
    const button = document.querySelector<HTMLButtonElement>(`${TARGET} button`);
    button?.click();
  };

  const helpLink = (
    <button
      type="button"
      onClick={openHelp}
      className={
        failures >= 2
          ? "mt-3 w-full rounded-full border border-[var(--border)] px-4 py-2.5 text-sm font-semibold text-[var(--foreground)] transition hover:bg-[var(--background)]"
          : "mt-3 w-full text-center text-xs text-[var(--muted)] underline-offset-2 transition hover:underline"
      }
    >
      {failures >= 2 ? "Still stuck? Message the office and we'll add it for you" : "Trouble uploading? Message the office"}
    </button>
  );

  if (celebrating) {
    return (
      <div className="fixed inset-0 z-[135] flex flex-col items-center justify-center bg-[rgb(2_6_23_/_0.72)] px-6 text-center backdrop-blur-sm">
        <Mascot mood="celebrating" className="h-36 w-36" />
        <p className="mt-5 text-xl font-bold text-white">You&apos;re in. Welcome.</p>
        <p className="mt-1 text-sm text-white/70">Everything just unlocked.</p>
      </div>
    );
  }

  if (!active || access == null) return null;

  // ---- POINT: on /profile, spotlight the camera control -------------------
  if (onProfile) {
    const hole = rect ? inflate(rect, 10) : null;
    const guideSize = viewport.width < 640 ? 88 : 124;

    // Becca to the right of the spotlight when there is room, else below it.
    const roomRight = hole ? viewport.width - (hole.left + hole.width) : 0;
    const sideRight = hole && roomRight >= guideSize + 24;
    const guideLeft = hole
      ? sideRight
        ? hole.left + hole.width + 16
        : Math.min(Math.max(12, hole.left + hole.width / 2 - guideSize / 2), viewport.width - guideSize - 12)
      : 0;
    const guideTop = hole
      ? sideRight
        ? Math.max(12, hole.top + hole.height / 2 - guideSize / 2)
        : hole.top + hole.height + 14
      : 0;

    const handX = guideLeft + guideSize * (sideRight ? 0.12 : 0.5);
    const handY = guideTop + guideSize * (sideRight ? 0.5 : 0.15);
    const targetX = hole ? hole.left + hole.width / 2 : 0;
    const targetY = hole ? hole.top + hole.height / 2 : 0;
    const rawAngle = hole ? (Math.atan2(targetY - handY, targetX - handX) * 180) / Math.PI : 0;
    const pointLeft = hole ? targetX < handX : false;
    const armAngle = pointLeft
      ? Math.sign(rawAngle || 1) * Math.max(90.01, Math.min(140, Math.abs(rawAngle)))
      : Math.max(-90, Math.min(90, rawAngle));

    return (
      <div className="fixed inset-0 z-[132]" role="dialog" aria-modal="true" aria-label="Add your profile photo">
        {hole && !targetMissing && (
          <>
            <SpotlightMask hole={hole} zIndex={0} />
            <SpotlightArrow from={{ x: handX, y: handY }} to={{ x: targetX, y: targetY }} zIndex={0} />
            <motion.div
              initial={false}
              animate={{ left: guideLeft, top: guideTop }}
              transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 180, damping: 22 }}
              className="pointer-events-none fixed z-10"
              style={{ width: guideSize, height: guideSize }}
            >
              <Mascot mood="happy" pointAngle={armAngle} className="h-full w-full drop-shadow-2xl" />
            </motion.div>
          </>
        )}

        {(!hole || targetMissing) && <div className="fixed inset-0 bg-[rgb(2_6_23_/_0.55)]" />}

        {/* Instruction card — bottom sheet on mobile, floating panel on desktop. */}
        <div className="fixed inset-x-0 bottom-0 z-20 flex justify-center p-4 sm:bottom-6">
          <div className="w-full max-w-sm rounded-3xl bg-[var(--surface)] p-5 text-center shadow-2xl">
            <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-[var(--accent)]">
              One step left
            </p>
            <h2 className="mt-1.5 text-lg font-bold leading-snug text-[var(--foreground)]">
              {targetMissing ? "Add your profile photo" : "Tap the camera"}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
              {targetMissing
                ? "Open your camera or pick a photo from your phone. Your whole portal opens the moment it saves."
                : "It's the button on your photo. Take a selfie or choose one from your phone — everything opens the moment it saves."}
            </p>
            {targetMissing && (
              <button
                type="button"
                onClick={openCamera}
                className="mt-4 w-full rounded-full bg-[var(--accent)] px-6 py-3 text-sm font-bold text-white shadow-lg transition hover:brightness-110"
              >
                Open camera
              </button>
            )}
            {helpLink}
          </div>
        </div>
      </div>
    );
  }

  // ---- LOCK: on a gated page, the full-screen Becca card -----------------
  return (
    <div
      className="fixed inset-0 z-[132] flex items-center justify-center bg-[rgb(2_6_23_/_0.9)] px-6 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label="One step to unlock your portal"
    >
      <motion.div
        initial={reduceMotion ? false : { opacity: 0, y: 16, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="w-full max-w-md rounded-[28px] bg-[var(--surface)] p-7 text-center shadow-2xl"
      >
        <Mascot mood="greeting" className="mx-auto h-32 w-32" />

        <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.4em] text-emerald-500">
          Your payment is all sorted
        </p>
        <h1 className="mt-2 text-2xl font-bold leading-snug text-[var(--foreground)]">
          One step and your portal opens
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">
          Becca here. Your seat is paid for and your classes are ready — the only thing holding your
          portal shut is a profile photo. It is how your tutor knows who is who in class, and it is
          the one that goes on your certificate. Ten seconds and you are in. Come with me.
        </p>

        <button
          type="button"
          onClick={() => router.push("/profile")}
          className="mt-6 w-full rounded-full bg-[var(--accent)] px-6 py-3.5 text-sm font-bold text-white shadow-lg transition hover:-translate-y-0.5 hover:brightness-110"
        >
          Show me — it takes ten seconds
        </button>

        {helpLink}
      </motion.div>
    </div>
  );
}
