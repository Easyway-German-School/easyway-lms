import { NextResponse } from "next/server";

import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * WHERE LEARNER BEHAVIOUR ENTERS THE BUILDING.
 *
 * This replaces `/api/beta/usage`, which took one event per request and
 * recorded it only for the handful of people who had joined the beta
 * programme. Both of those were wrong for what the school actually needs.
 *
 * BATCHED, because the browser now reports clicks as well as page dwell, and
 * one HTTP request per tap on a phone connection is a tax on the learner's
 * data bundle to buy us an analytics row. The client buffers and flushes; this
 * takes up to `MAX_BATCH` at a time.
 *
 * WRITTEN FOR EVERYONE, unless they have explicitly said no. See
 * `User.analyticsOptOutAt` in the schema for why the old consent column could
 * not carry that meaning. This is the school's own operational record of its
 * own students using its own portal — the same category as an attendance
 * register — and the honest control is a visible opt-out, not a silent
 * default-off that leaves the school blind to 95% of its roster.
 *
 * WHAT IT WILL NOT RECORD. Nothing free-typed by the learner ever reaches this
 * route: `detail` is a label the CLIENT CODE chose (a button's name, a lesson
 * slug), never the contents of a message, a search box or an answer. The
 * ingest below re-enforces that by capping and trimming every string, but the
 * real guarantee is that the tracker never reads an input's value.
 */

export const dynamic = "force-dynamic";

/** A page you left open at lunch is not two hours of studying. */
const MAX_EVENT_SECONDS = 600;
const MAX_BATCH = 40;

const ALLOWED_ACTIONS = new Set([
  "view",
  "click",
  "start",
  "complete",
  "submit",
  "play",
  "pause",
  "search",
  "open",
  "close",
]);

type Incoming = {
  area?: unknown;
  action?: unknown;
  path?: unknown;
  detail?: unknown;
  deviceKind?: unknown;
  hourLocal?: unknown;
  weekday?: unknown;
  sessionKey?: unknown;
  durationSeconds?: unknown;
};

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function wholeNumber(value: unknown, low: number, high: number): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const rounded = Math.round(parsed);
  return rounded >= low && rounded <= high ? rounded : null;
}

export async function POST(request: Request) {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const viewer = await prisma.user.findUnique({
    where: { id: session.user.id as string },
    select: { analyticsOptOutAt: true, tenantId: true },
  });
  if (!viewer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (viewer.analyticsOptOutAt) return NextResponse.json({ ok: true, recorded: 0, optedOut: true });

  const body = (await request.json().catch(() => null)) as { events?: Incoming[] } | Incoming | null;
  const list: Incoming[] = Array.isArray((body as { events?: Incoming[] })?.events)
    ? (body as { events: Incoming[] }).events
    : body
      ? [body as Incoming]
      : [];

  const rows = list.slice(0, MAX_BATCH).flatMap((raw) => {
    const area = text(raw.area, 80);
    if (!area || area === "unknown") return [];
    const action = text(raw.action, 40) ?? "view";
    if (!ALLOWED_ACTIONS.has(action)) return [];
    return [
      {
        userId: session.user.id as string,
        tenantId: viewer.tenantId ?? null,
        area,
        action,
        path: text(raw.path, 200),
        detail: text(raw.detail, 120),
        deviceKind: text(raw.deviceKind, 12),
        hourLocal: wholeNumber(raw.hourLocal, 0, 23),
        weekday: wholeNumber(raw.weekday, 0, 6),
        sessionKey: text(raw.sessionKey, 40),
        durationSeconds: Math.max(0, Math.min(MAX_EVENT_SECONDS, Math.round(Number(raw.durationSeconds) || 0))),
      },
    ];
  });

  if (!rows.length) return NextResponse.json({ ok: true, recorded: 0 });

  /**
   * Best-effort on purpose, and `skipDuplicates` because a `keepalive` flush
   * fired on page-hide is one of the few requests a browser will genuinely
   * send twice. An analytics failure must never be able to surface as an error
   * in a student's portal — they are trying to do a lesson.
   */
  try {
    await prisma.learnerUsageEvent.createMany({ data: rows, skipDuplicates: true });
  } catch (error) {
    console.error("[track] could not record learner events", error);
    return NextResponse.json({ ok: true, recorded: 0 });
  }
  return NextResponse.json({ ok: true, recorded: rows.length });
}
