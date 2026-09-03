import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runUnscoped } from "@/lib/tenant/context";
import { checkRateLimit, clientIp, rateLimitResponse } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * The public webinar landing + registration. No session — an external
 * registrant has no account. The route is namespaced under /api/public so the
 * edge middleware lets it through (see proxy.ts), and every read is explicitly
 * unscoped and then keyed by the webinar's own tenant.
 */

async function loadBySlug(slug: string) {
  return runUnscoped("public webinar landing", () =>
    prisma.webinar.findFirst({
      where: { landingSlug: slug, deletedAt: null, audience: "public" },
      select: {
        id: true,
        eventId: true,
        tenantId: true,
        mode: true,
        registrationRequired: true,
        registrationOpensAt: true,
        registrationClosesAt: true,
        capacity: true,
        landingConfig: true,
        startedAt: true,
        endedAt: true,
        event: {
          select: { title: true, description: true, startAt: true, endAt: true, timezone: true, status: true },
        },
      },
    }),
  );
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const w = await loadBySlug(slug);
  if (!w) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const registrations = await runUnscoped("public webinar count", () =>
    prisma.eventAttendee.count({ where: { eventId: w.eventId } }),
  );
  const now = Date.now();
  const opensOk = !w.registrationOpensAt || w.registrationOpensAt.getTime() <= now;
  const closesOk = !w.registrationClosesAt || w.registrationClosesAt.getTime() > now;
  const hasRoom = w.capacity == null || registrations < w.capacity;
  const registrationOpen = Boolean(w.registrationRequired && opensOk && closesOk && hasRoom && !w.endedAt);

  return NextResponse.json({
    title: w.event.title,
    description: w.event.description,
    startAt: w.event.startAt,
    endAt: w.event.endAt,
    timezone: w.event.timezone,
    status: w.endedAt ? "ended" : w.startedAt ? "live" : w.event.status,
    landing: w.landingConfig ?? null,
    registrationOpen,
    seatsLeft: w.capacity == null ? null : Math.max(0, w.capacity - registrations),
  });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const limit = checkRateLimit(`webinar-register:${clientIp(request.headers)}`, {
    windowMs: 60 * 60 * 1000,
    max: 20,
  });
  if (!limit.ok) return rateLimitResponse(limit, "Too many attempts. Please try again later.");

  const w = await loadBySlug(slug);
  if (!w) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (w.endedAt) return NextResponse.json({ error: "This webinar has ended." }, { status: 409 });

  const b = await request.json().catch(() => null);
  const name = String(b?.name ?? "").trim().slice(0, 120);
  const email = String(b?.email ?? "").trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return NextResponse.json({ error: "A valid email is required." }, { status: 400 });
  }

  const count = await runUnscoped("public webinar count", () =>
    prisma.eventAttendee.count({ where: { eventId: w.eventId } }),
  );
  if (w.capacity != null && count >= w.capacity) {
    return NextResponse.json({ error: "This webinar is full." }, { status: 409 });
  }

  await runUnscoped("public webinar register", () =>
    prisma.eventAttendee.upsert({
      where: { eventId_externalEmail: { eventId: w.eventId, externalEmail: email } },
      create: {
        eventId: w.eventId,
        externalName: name || null,
        externalEmail: email,
        role: "attendee",
        response: "accepted",
        registrationSource: "landing_page",
        tenantId: w.tenantId,
      },
      update: { externalName: name || undefined },
    }),
  );

  // Best-effort confirmation email. Single opt-in for v1 — the doc flags
  // double opt-in as later hardening.
  try {
    const { sendEmail, isEmailConfigured } = await import("@/lib/mailer");
    if (isEmailConfigured()) {
      const when = new Date(w.event.startAt).toLocaleString("en-GB", { dateStyle: "full", timeStyle: "short" });
      await sendEmail({
        to: email,
        subject: `You're registered: ${w.event.title}`,
        type: "webinar_registration",
        html: `<p>Hi${name ? ` ${name}` : ""},</p><p>You're registered for <strong>${w.event.title}</strong>.</p><p>${when} (${w.event.timezone})</p><p>A joining link will follow before it starts.</p>`,
      });
    }
  } catch (e) {
    console.error("webinar registration email failed", e);
  }

  return NextResponse.json({ ok: true });
}
