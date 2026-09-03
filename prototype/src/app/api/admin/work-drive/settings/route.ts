import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";
import {
  QUOTA_DEFAULT_BYTES,
  WORK_DRIVE_ENABLED_KEY,
  WORK_DRIVE_QUOTA_KEY,
  parseQuota,
  workDriveConfig,
} from "@/lib/work-drive/settings";

export const dynamic = "force-dynamic";

/**
 * The Work Drive's per-tenant switches. Gated on `staff` — turning the feature
 * on and setting a storage ceiling is school configuration, the same category
 * as which sittings run, not a Work Drive action.
 */
export async function GET() {
  const gate = await requireCapability("staff");
  if (!gate.ok) return gate.response;

  const tenantId = gate.session.user.tenantId ?? null;
  const cfg = await workDriveConfig(tenantId);
  const agg = await prisma.workspace.aggregate({ where: { deletedAt: null }, _sum: { storageUsedBytes: true } });

  return NextResponse.json({
    enabled: cfg.enabled,
    quotaBytes: cfg.quotaBytes,
    quotaIsDefault: cfg.quota.bytes == null,
    defaultQuotaBytes: QUOTA_DEFAULT_BYTES,
    usedBytes: Number(agg._sum.storageUsedBytes ?? 0),
  });
}

export async function POST(request: NextRequest) {
  const gate = await requireCapability("staff");
  if (!gate.ok) return gate.response;

  const tenantId = gate.session.user.tenantId ?? null;
  if (!tenantId) return NextResponse.json({ error: "This account is not attached to a school." }, { status: 400 });

  const b = await request.json().catch(() => null);

  if (typeof b?.enabled === "boolean") {
    await prisma.schoolSetting.upsert({
      where: { tenantId_key: { tenantId, key: WORK_DRIVE_ENABLED_KEY } },
      create: { tenantId, key: WORK_DRIVE_ENABLED_KEY, value: { enabled: b.enabled } },
      update: { value: { enabled: b.enabled } },
    });
  }

  if (b?.quotaGb !== undefined) {
    // null / "" clears back to the platform default.
    const gb = b.quotaGb === null || b.quotaGb === "" ? null : Number(b.quotaGb);
    if (gb !== null && (!Number.isFinite(gb) || gb < 0)) {
      return NextResponse.json({ error: "The limit must be a number of GB, or blank for the default." }, { status: 400 });
    }
    const parsed = parseQuota({ bytes: gb === null ? null : Math.round(gb * 1024 ** 3) }, { strict: true });
    if (!parsed) return NextResponse.json({ error: "That limit is not valid." }, { status: 400 });
    await prisma.schoolSetting.upsert({
      where: { tenantId_key: { tenantId, key: WORK_DRIVE_QUOTA_KEY } },
      create: { tenantId, key: WORK_DRIVE_QUOTA_KEY, value: parsed },
      update: { value: parsed },
    });
  }

  return NextResponse.json({ ok: true });
}
