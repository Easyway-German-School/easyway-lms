"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/**
 * WHAT THE LEARNER DID, REPORTED FROM THE BROWSER.
 *
 * The previous version of this file recorded one thing: the first segment of
 * the path, once, if you sat on it for five seconds. That answers "is the
 * community tab popular" and nothing else. It cannot say when somebody
 * studies, how long a sitting lasts, whether they came back, or what they
 * actually pressed — which is to say it cannot support a single one of the
 * questions the school wants answered.
 *
 * THREE THINGS THIS ONE ADDS, and each is load-bearing:
 *
 *  1. THE LEARNER'S OWN CLOCK. `hourLocal` and `weekday` are read here, in the
 *     browser, and sent as plain integers. A server timestamp records when
 *     Vercel wrote the row — in whatever region it happened to run — which is
 *     a fact about our hosting and not about whether a student in Lagos
 *     studies at midnight. Every rhythm reading downstream depends on this.
 *
 *  2. A SESSION KEY. Held in sessionStorage, so it survives navigation within
 *     one tab and dies when the tab does. That is the only honest boundary for
 *     "one visit" available to us; guessing it server-side from timestamps is
 *     a fallback, not an equal.
 *
 *  3. INTENT, NOT JUST PRESENCE. Clicks on elements marked `data-track` are
 *     reported alongside page dwell, so the difference between opening the
 *     practice page and actually starting a drill is visible.
 *
 * WHAT IT DELIBERATELY NEVER READS. The value of any input, textarea or
 * contenteditable; the text of any message; anything a person typed. `detail`
 * comes from a `data-track` attribute that a developer wrote, never from the
 * page's content. This is the difference between measuring product usage and
 * reading somebody's post over their shoulder, and it is enforced here rather
 * than left to the server to notice.
 *
 * BUFFERED, because a click tracker that costs one HTTP request per tap is a
 * charge on a student's data bundle. Events queue and flush on a timer, on
 * navigation, and on page-hide via `keepalive` — the one flush a closing tab
 * will still honour.
 */

const FLUSH_MS = 15000;
const MIN_DWELL_SECONDS = 3;
const ENDPOINT = "/api/track";

type QueuedEvent = {
  area: string;
  action: string;
  path: string;
  detail?: string;
  deviceKind: string;
  hourLocal: number;
  weekday: number;
  sessionKey: string;
  durationSeconds: number;
};

/** Coarse bucket for aggregates. The full route travels separately in `path`. */
function areaFor(pathname: string): string {
  const parts = pathname.split("/").filter(Boolean);
  if (!parts.length) return "dashboard";
  // /lessons/abc123 is still "lessons"; a cuid in the bucket name would give
  // every learner their own private category and make every aggregate empty.
  return parts[0].toLowerCase();
}

function deviceKind(): string {
  if (typeof window === "undefined") return "unknown";
  const width = window.innerWidth;
  if (width < 768) return "mobile";
  if (width < 1180) return "tablet";
  return "desktop";
}

function sessionKey(): string {
  if (typeof window === "undefined") return "";
  try {
    const existing = window.sessionStorage.getItem("ew:sessionKey");
    if (existing) return existing;
    const fresh = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    window.sessionStorage.setItem("ew:sessionKey", fresh);
    return fresh;
  } catch {
    // Private browsing can throw on sessionStorage. A visit with no key still
    // gets grouped server-side by the 30-minute gap rule; losing precision is
    // acceptable, throwing inside a student's portal is not.
    return "";
  }
}

export default function StudentUsageTracker() {
  const pathname = usePathname();
  const queue = useRef<QueuedEvent[]>([]);
  const startedAt = useRef(Date.now());
  const lastPath = useRef(pathname);

  /** Send whatever is queued. `beacon` is the page-is-closing variant. */
  const flush = useRef((beacon = false) => {
    const events = queue.current;
    if (!events.length) return;
    queue.current = [];
    const payload = JSON.stringify({ events });
    try {
      if (beacon && typeof navigator !== "undefined" && navigator.sendBeacon) {
        navigator.sendBeacon(ENDPOINT, new Blob([payload], { type: "application/json" }));
        return;
      }
      void fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: payload,
      }).catch(() => {
        /* Analytics must never surface as an error in a learner's portal. */
      });
    } catch {
      /* Same. */
    }
  });

  const push = useRef((event: Omit<QueuedEvent, "deviceKind" | "hourLocal" | "weekday" | "sessionKey">) => {
    const now = new Date();
    queue.current.push({
      ...event,
      deviceKind: deviceKind(),
      hourLocal: now.getHours(),
      weekday: now.getDay(),
      sessionKey: sessionKey(),
    });
    // The server caps a batch at 40; flush early rather than have it discard
    // the tail of a busy minute.
    if (queue.current.length >= 20) flush.current();
  });

  /* ---- Page dwell ------------------------------------------------------ */
  useEffect(() => {
    const previous = lastPath.current;
    const seconds = Math.round((Date.now() - startedAt.current) / 1000);
    if (seconds >= MIN_DWELL_SECONDS) {
      push.current({ area: areaFor(previous), action: "view", path: previous, durationSeconds: seconds });
    }
    startedAt.current = Date.now();
    lastPath.current = pathname;
  }, [pathname]);

  /* ---- Clicks, timer, and the closing tab ------------------------------ */
  useEffect(() => {
    const onClick = (nativeEvent: MouseEvent) => {
      const target = nativeEvent.target as HTMLElement | null;
      const marked = target?.closest?.("[data-track]") as HTMLElement | null;
      if (!marked) return;
      const detail = marked.getAttribute("data-track") ?? "";
      if (!detail) return;
      push.current({
        area: areaFor(lastPath.current),
        action: marked.getAttribute("data-track-action") || "click",
        path: lastPath.current,
        detail: detail.slice(0, 120),
        durationSeconds: 0,
      });
    };

    const onHide = () => {
      // The last page of a visit is never billed by the navigation effect
      // above, because there is no navigation. Bill it here.
      const seconds = Math.round((Date.now() - startedAt.current) / 1000);
      if (seconds >= MIN_DWELL_SECONDS) {
        push.current({
          area: areaFor(lastPath.current),
          action: "view",
          path: lastPath.current,
          durationSeconds: seconds,
        });
        startedAt.current = Date.now();
      }
      flush.current(true);
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") onHide();
      else startedAt.current = Date.now();
    };

    const timer = window.setInterval(() => flush.current(), FLUSH_MS);
    document.addEventListener("click", onClick, true);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onHide);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onHide);
      flush.current(true);
    };
  }, []);

  return null;
}
