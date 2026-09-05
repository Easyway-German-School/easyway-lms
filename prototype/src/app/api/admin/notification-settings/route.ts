import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";
import { KIND } from "@/lib/notification-kinds";
import {
  isMailIdentityKey,
  KIND_GROUPS,
  KIND_LABELS,
  MAIL_IDENTITIES,
  NOREPLY_ADDRESS,
  SUPPORT_ADDRESS,
} from "@/lib/mail-identity";
import { allPlans, invalidateRoutingCache } from "@/lib/notification-routing";
import { activeTransport, isEmailConfigured } from "@/lib/mailer";
import { isSmsConfigured } from "@/lib/sms";
import { parseAutoRelease, RESULTS_AUTO_RELEASE_KEY } from "@/lib/result-settings";

/**
 * Which notifications go out, on which channels, as which sender.
 *
 * Gated on `emails`, the capability that already governs bulk mail — the
 * person who owns communications owns this too.
 */

export const dynamic = "force-dynamic";

const ALL_KINDS = Object.values(KIND) as string[];

export async function GET() {
  const gate = await requireCapability("emails");
  if (!gate.ok) return gate.response;

  const tenantId = gate.session.user.tenantId ?? null;
  const autoReleaseRow = tenantId
    ? await prisma.schoolSetting
        .findUnique({ where: { tenantId_key: { tenantId, key: RESULTS_AUTO_RELEASE_KEY } }, select: { value: true } })
        .catch(() => null)
    : null;

  return NextResponse.json({
    groups: KIND_GROUPS,
    labels: KIND_LABELS,
    plans: await allPlans(ALL_KINDS),
    autoRelease: parseAutoRelease(autoReleaseRow?.value),
    identities: {
      support: { ...MAIL_IDENTITIES.support },
      noreply: { ...MAIL_IDENTITIES.noreply },
    },
    addresses: { support: SUPPORT_ADDRESS, noreply: NOREPLY_ADDRESS },
    // The page must be honest about whether any of this can actually be
    // delivered. A settings screen full of ticked "email" boxes over a
    // transport that cannot authenticate is the most misleading thing the
    // admin area could show.
    transport: {
      configured: isEmailConfigured(),
      via: activeTransport(),
    },
    smsTransport: {
      configured: isSmsConfigured(),
    },
  });
}

export async function PATCH(req: NextRequest) {
  const gate = await requireCapability("emails");
  if (!gate.ok) return gate.response;

  const body = await req.json().catch(() => null);

  // Automatic result release lives in SchoolSetting, not a per-kind row, so it
  // is handled here before the kind lookup rather than as another `kind`.
  if (body && body.autoRelease !== undefined) {
    const tenantId = gate.session.user.tenantId;
    if (!tenantId) return NextResponse.json({ error: "No school in context" }, { status: 400 });
    const parsed = parseAutoRelease(body.autoRelease, { strict: true });
    if (!parsed) {
      return NextResponse.json({ error: "Invalid auto-release settings" }, { status: 400 });
    }
    await prisma.schoolSetting.upsert({
      where: { tenantId_key: { tenantId, key: RESULTS_AUTO_RELEASE_KEY } },
      update: { value: parsed },
      create: { tenantId, key: RESULTS_AUTO_RELEASE_KEY, value: parsed },
    });
    return NextResponse.json({ autoRelease: parsed });
  }

  const kind = typeof body?.kind === "string" ? body.kind : "";
  if (!ALL_KINDS.includes(kind)) {
    return NextResponse.json({ error: "Unknown notification kind" }, { status: 400 });
  }

  const data: Record<string, unknown> = { updatedBy: gate.admin?.userId ?? null };
  if (typeof body.inApp === "boolean") data.inApp = body.inApp;
  if (typeof body.push === "boolean") data.push = body.push;
  if (typeof body.email === "boolean") data.email = body.email;
  if (typeof body.sms === "boolean") data.sms = body.sms;
  if (body.identity !== undefined) {
    if (body.identity !== null && !isMailIdentityKey(body.identity)) {
      return NextResponse.json({ error: "Sender must be support or noreply" }, { status: 400 });
    }
    data.identity = body.identity;
  }

  // Upsert, because a kind with no row is following the code default — the
  // first time anybody touches it is the first time a row exists.
  const current = await allPlans([kind]);
  await prisma.notificationSetting.upsert({
    where: { kind },
    update: data,
    create: {
      kind,
      inApp: current[kind].inApp,
      push: current[kind].push,
      email: current[kind].email,
      sms: current[kind].sms,
      identity: current[kind].identity,
      ...data,
    },
  });

  invalidateRoutingCache();
  return NextResponse.json({ plans: await allPlans([kind]) });
}

/** Put one kind back on the code default by deleting its row. */
export async function DELETE(req: NextRequest) {
  const gate = await requireCapability("emails");
  if (!gate.ok) return gate.response;

  const kind = req.nextUrl.searchParams.get("kind") ?? "";
  if (!ALL_KINDS.includes(kind)) {
    return NextResponse.json({ error: "Unknown notification kind" }, { status: 400 });
  }

  await prisma.notificationSetting.deleteMany({ where: { kind } });
  invalidateRoutingCache();
  return NextResponse.json({ plans: await allPlans([kind]) });
}
