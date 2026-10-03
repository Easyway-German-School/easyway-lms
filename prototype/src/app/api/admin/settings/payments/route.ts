import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/admin-roles";
import { currentTenantId } from "@/lib/tenant/context";
import {
  checkKeyWithPaystack,
  describeOwnAccount,
  parseSecretKey,
  removeOwnAccount,
  saveOwnAccount,
} from "@/lib/paystack-account";

export const dynamic = "force-dynamic";

/**
 * A business connecting its OWN Paystack account, so fees settle straight to it.
 *
 * Behind `payments`, which is super-admin only: this is where money is pointed.
 * The secret key goes in and is never sent back — the screen only ever learns
 * the last four characters. See lib/paystack-account.ts for how it is stored.
 */

function webhookUrlFor(tenantId: string): string {
  const base = (process.env.NEXTAUTH_URL || "").replace(/\/+$/, "");
  return `${base}/api/paystack/webhook/${tenantId}`;
}

export async function GET() {
  const gate = await requireCapability("payments");
  if (!gate.ok) return gate.response;

  const tenantId = currentTenantId();
  if (!tenantId) return NextResponse.json({ error: "No school in this session." }, { status: 400 });

  return NextResponse.json({
    account: await describeOwnAccount(tenantId),
    webhookUrl: webhookUrlFor(tenantId),
  });
}

export async function PUT(request: Request) {
  const gate = await requireCapability("payments");
  if (!gate.ok) return gate.response;

  const tenantId = currentTenantId();
  if (!tenantId) return NextResponse.json({ error: "No school in this session." }, { status: 400 });

  const body = await request.json().catch(() => null);
  const parsed = parseSecretKey(body?.secretKey);
  if (!parsed.ok) {
    return NextResponse.json(
      {
        error:
          "That does not look like a Paystack secret key. It starts with sk_live_ or sk_test_ — copy it from Paystack, Settings, API Keys & Webhooks.",
      },
      { status: 400 },
    );
  }

  // A real key or nothing. Saving a typo would look connected and then fail on
  // the first student's payment, which is the worst moment to find out.
  const check = await checkKeyWithPaystack(parsed.key);
  if (!check.ok) {
    return NextResponse.json({ error: check.reason ?? "Paystack did not accept that key." }, { status: 422 });
  }

  await saveOwnAccount(tenantId, parsed.key, parsed.mode);

  return NextResponse.json({
    account: await describeOwnAccount(tenantId),
    webhookUrl: webhookUrlFor(tenantId),
  });
}

export async function DELETE() {
  const gate = await requireCapability("payments");
  if (!gate.ok) return gate.response;

  const tenantId = currentTenantId();
  if (!tenantId) return NextResponse.json({ error: "No school in this session." }, { status: 400 });

  await removeOwnAccount(tenantId);

  return NextResponse.json({
    account: await describeOwnAccount(tenantId),
    webhookUrl: webhookUrlFor(tenantId),
  });
}
