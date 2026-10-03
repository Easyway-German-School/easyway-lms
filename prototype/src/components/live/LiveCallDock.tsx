"use client";

/**
 * The only place `LiveKitClassroom` is ever mounted.
 *
 * Sitting in the root layout (outside every page's own tree) is what lets a
 * call survive navigation: Next does not remount a layout when the route
 * inside it changes, so as long as this component keeps rendering
 * `LiveKitClassroom`, the Room connection inside it never tears down —
 * whatever page the student is actually looking at.
 *
 * Full-screen while the student is on `/live`, a small draggable card
 * everywhere else. The switch is automatic (leaving `/live` minimizes,
 * coming back restores) but a manual minimize button on the classroom itself
 * overrides it without a fight — see the effect below for why.
 */

import { useCallback, useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import LiveKitClassroom from "./LiveKitClassroom";
import { useLiveCall } from "./LiveCallContext";

const MARGIN = 12;
const CARD_WIDTH = 288;
const CARD_HEIGHT = 176;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

export default function LiveCallDock() {
  const { activeCall, dockState, setDockState, reportLeave, shortRecordingPrompt, resolveShortRecordingPrompt } = useLiveCall();
  const pathname = usePathname();
  const router = useRouter();

  const cardRef = useRef<HTMLDivElement>(null);
  const posRef = useRef({ x: MARGIN, y: MARGIN });
  const draggingRef = useRef(false);
  const dragOffsetRef = useRef({ x: 0, y: 0 });

  // Auto-follow the route, but only ON A ROUTE CHANGE. This effect's deps are
  // [pathname, activeCall] — a manual minimize/expand tap on the classroom
  // itself changes neither, so it is never immediately overridden by this.
  useEffect(() => {
    if (!activeCall) return;
    setDockState(pathname === "/live" ? "full" : "minimized");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, activeCall !== null]);

  const positionCard = useCallback(() => {
    const el = cardRef.current;
    if (!el) return;
    el.style.left = `${posRef.current.x}px`;
    el.style.top = `${posRef.current.y}px`;
  }, []);

  useEffect(() => {
    if (dockState !== "minimized") return;
    // First time this call goes small, park it bottom-right rather than
    // wherever a previous, already-ended call happened to be dropped.
    posRef.current = {
      x: clamp(window.innerWidth - CARD_WIDTH - MARGIN, MARGIN, window.innerWidth - CARD_WIDTH - MARGIN),
      y: clamp(window.innerHeight - CARD_HEIGHT - MARGIN, MARGIN, window.innerHeight - CARD_HEIGHT - MARGIN),
    };
    positionCard();
  }, [dockState, positionCard]);

  const onDragPointerDown = useCallback((event: React.PointerEvent) => {
    draggingRef.current = true;
    const rect = cardRef.current?.getBoundingClientRect();
    dragOffsetRef.current = {
      x: event.clientX - (rect?.left ?? 0),
      y: event.clientY - (rect?.top ?? 0),
    };

    function onMove(moveEvent: PointerEvent) {
      if (!draggingRef.current) return;
      posRef.current = {
        x: clamp(moveEvent.clientX - dragOffsetRef.current.x, MARGIN, window.innerWidth - CARD_WIDTH - MARGIN),
        y: clamp(moveEvent.clientY - dragOffsetRef.current.y, MARGIN, window.innerHeight - CARD_HEIGHT - MARGIN),
      };
      const el = cardRef.current;
      if (el) {
        el.style.left = `${posRef.current.x}px`;
        el.style.top = `${posRef.current.y}px`;
      }
    }

    function onUp() {
      draggingRef.current = false;
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    }

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }, []);

  const onExpand = useCallback(() => {
    setDockState("full");
    if (pathname !== "/live") router.push("/live");
  }, [pathname, router, setDockState]);

  const onMinimize = useCallback(() => setDockState("minimized"), [setDockState]);

  // Rendered regardless of `activeCall` — the moment this prompt is set, the
  // call that produced it has already gone (`reportLeave` clears it in the
  // same tick), so a return keyed to `activeCall` below would never show it.
  const shortRecordingModal = shortRecordingPrompt ? (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm space-y-4 rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-xl">
        <h2 className="text-lg font-bold text-[var(--foreground)]">Keep this recording?</h2>
        <p className="text-sm text-[var(--foreground-soft)]">
          That class lasted only <strong>{formatDuration(shortRecordingPrompt.durationMs)}</strong> — too short to be a real
          lesson. We&apos;d recommend deleting it so it never shows up for your students.
        </p>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => resolveShortRecordingPrompt("delete")}
            className="rounded-2xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700"
          >
            Delete recording (recommended)
          </button>
          <button
            type="button"
            onClick={() => resolveShortRecordingPrompt("keep")}
            className="rounded-2xl border border-[var(--border)] px-4 py-2.5 text-sm font-semibold text-[var(--foreground-soft)] transition hover:bg-[var(--surface-alt)]"
          >
            Keep it
          </button>
        </div>
      </div>
    </div>
  ) : null;

  if (!activeCall || !activeCall.session.url || !activeCall.session.token) return shortRecordingModal;

  const classroom = (
    <LiveKitClassroom
      key={activeCall.session.roomName}
      url={activeCall.session.url}
      token={activeCall.session.token}
      roomName={activeCall.session.roomName}
      displayName={activeCall.session.displayName}
      role={activeCall.session.role}
      initialQuality={activeCall.mode}
      liveSessionId={activeCall.session.liveSessionId}
      minimized={dockState === "minimized"}
      onExpand={onExpand}
      onMinimize={onMinimize}
      onDragHandlePointerDown={onDragPointerDown}
      onLeave={reportLeave}
    />
  );

  if (dockState === "full") {
    return (
      <>
        <div className="fixed inset-0 z-[70] overflow-y-auto bg-slate-950 p-3 sm:p-4">{classroom}</div>
        {shortRecordingModal}
      </>
    );
  }

  return (
    <>
      <div
        ref={cardRef}
        style={{ left: posRef.current.x, top: posRef.current.y, width: CARD_WIDTH, height: CARD_HEIGHT }}
        className="fixed z-[70] shadow-2xl"
      >
        {classroom}
      </div>
      {shortRecordingModal}
    </>
  );
}
