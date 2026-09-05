import { NextResponse } from "next/server";

import { requireAuthSession } from "@/lib/auth";
import { KIND } from "@/lib/notification-kinds";
import { isMutable, preferencesFor, savePreference } from "@/lib/notification-prefs";

export const dynamic = "force-dynamic";

/**
 * What a tutor wants to be told about, and how.
 *
 * Scoped to the kinds a tutor actually receives. Showing them the whole
 * vocabulary would list `lead.captured` and `gateway.error` — things only the
 * office is ever sent — and a settings page full of switches that control
 * nothing teaches people their settings do not work.
 */
const TUTOR_KINDS = [
  {
    kind: KIND.classStarting,
    label: "A class of mine is starting",
    detail: "Sent as the session opens, so you are not the last one into your own room.",
  },
  {
    kind: KIND.assignmentDue,
    label: "Assignment deadlines",
    detail: "When work you set falls due and submissions are ready to mark.",
  },
  {
    kind: KIND.materialPublished,
    label: "New materials published",
    detail: "When the school adds material for a level you teach.",
  },
  {
    kind: KIND.studentRegistered,
    label: "A student joins my class",
    detail: "A new enrolment lands in a cohort of yours.",
  },
  {
    kind: KIND.levelAdvance,
    label: "Students moving up a level",
    detail: "When your cohort is signed off and moves on.",
  },
  {
    kind: KIND.resultPublished,
    label: "Results published",
    detail: "When marks you entered go live to students.",
  },
  {
    kind: KIND.announcement,
    label: "School announcements",
    detail: "Notices from the office to all staff.",
  },
] as const;

export async function GET() {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const stored = await preferencesFor(session.user.id as string);

  return NextResponse.json({
    kinds: TUTOR_KINDS.map((entry) => ({
      ...entry,
      // A kind with no stored row is fully on. The client never has to know
      // that absence means "on" — it is resolved here, once.
      ...(stored[entry.kind] ?? { inApp: true, push: true, email: true, sms: true }),
      mutable: isMutable(entry.kind),
    })),
  });
}

export async function PATCH(request: Request) {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const kind = typeof body.kind === "string" ? body.kind : "";

  // Only the kinds this page offers. Without this check a crafted PATCH could
  // write a preference row for any string at all, and a tutor could silence a
  // kind the settings page deliberately does not expose.
  if (!TUTOR_KINDS.some((entry) => entry.kind === kind)) {
    return NextResponse.json({ error: "Unknown notification type" }, { status: 400 });
  }
  if (!isMutable(kind)) {
    return NextResponse.json({ error: "This notification cannot be turned off" }, { status: 400 });
  }

  await savePreference(session.user.id as string, kind, {
    inApp: body.inApp !== false,
    push: body.push !== false,
    email: body.email !== false,
    sms: body.sms !== false,
  });

  return NextResponse.json({ success: true });
}
