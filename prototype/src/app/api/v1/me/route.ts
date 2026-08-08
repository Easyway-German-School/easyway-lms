import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiKey } from "@/lib/api/auth";
import { apiOk, apiError } from "@/lib/api/response";

/**
 * "Is my key working, and who does it think I am?"
 *
 * The first endpoint every integrator calls and the one they come back to when
 * something is wrong, so it is deliberately the simplest thing in the API: it
 * touches only the tenant record and the key that was presented.
 *
 * It is also the only v1 endpoint that can exist today. The data endpoints —
 * students, enrolments, payments — must read through the tenant-scoped client,
 * and that depends on the `tenantId` columns which are staged and unapplied
 * (see prisma/migrations/manual/001_tenant_platform). Writing them now against
 * unscoped queries would mean writing the isolation bug on purpose and hoping
 * to remember to fix it. This proves the whole chain — key parsing, hashing,
 * lookup, revocation, expiry, scopes, rate limiting, the envelope — and the
 * rest lands when the migration does.
 */
export async function GET(request: NextRequest) {
  const gate = await requireApiKey(request, "identity:read");
  if (!gate.ok) return gate.response;

  const { key, tenantId, sandbox } = gate.ctx;

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, name: true, slug: true, status: true },
  });

  if (!tenant) {
    /**
     * A live key whose tenant has been deleted. Cascade should have taken the
     * key with it, so reaching here means something is inconsistent — refuse
     * rather than serve a request on behalf of a tenant that does not exist.
     */
    return apiError("not_found", "The tenant for this key no longer exists.");
  }

  return apiOk({
    tenant,
    key: {
      prefix: key.prefix,
      environment: key.environment,
      scopes: key.scopes,
    },
    sandbox,
  });
}
