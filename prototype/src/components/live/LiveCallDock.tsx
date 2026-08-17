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

export default function LiveCallDock() {
  const { activeCall, dockState, setDockState, reportLeave } = useLiveCall();
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

  if (!activeCall || !activeCall.session.url || !activeCall.session.token) return null;

  if (dockState === "full") {
    return (
      <div className="fixed inset-0 z-[70] overflow-y-auto bg-slate-950 p-3 sm:p-4">
        <LiveKitClassroom
          key={activeCall.session.roomName}
          url={activeCall.session.url}
          token={activeCall.session.token}
          roomName={activeCall.session.roomName}
          displayName={activeCall.session.displayName}
          role={activeCall.session.role}
          initialQuality={activeCall.mode}
          liveSessionId={activeCall.session.liveSessionId}
          minimized={false}
          onMinimize={onMinimize}
          onLeave={reportLeave}
        />
      </div>
    );
  }

  return (
    <div
      ref={cardRef}
      style={{ left: posRef.current.x, top: posRef.current.y, width: CARD_WIDTH, height: CARD_HEIGHT }}
      className="fixed z-[70] shadow-2xl"
    >
      <LiveKitClassroom
        key={activeCall.session.roomName}
        url={activeCall.session.url}
        token={activeCall.session.token}
        roomName={activeCall.session.roomName}
        displayName={activeCall.session.displayName}
        role={activeCall.session.role}
        initialQuality={activeCall.mode}
        liveSessionId={activeCall.session.liveSessionId}
        minimized
        onExpand={onExpand}
        onDragHandlePointerDown={onDragPointerDown}
        onLeave={reportLeave}
      />
    </div>
  );
}
