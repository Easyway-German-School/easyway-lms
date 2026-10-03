import { withUnscoped } from "@/lib/tenant/context";
import { processPaystackWebhook } from "@/lib/paystack-webhook";

export const dynamic = "force-dynamic";

/**
 * The webhook for a business that connected its OWN Paystack account.
 *
 * Paystack signs each webhook with the key of the account that took the
 * payment, so a business's payments cannot arrive on the platform URL — the
 * signature would not match. The tenant in the path only says whose key to check
 * the signature against; the signature is what proves the request is real.
 * Everything after that runs scoped to the tenant. See processPaystackWebhook.
 */
export const POST = withUnscoped(
  "tenant's own payment webhook; scoped to that tenant as soon as its signature verifies",
  async (request: Request, { params }: { params: Promise<{ tenantId: string }> }) => {
    const { tenantId } = await params;
    return processPaystackWebhook(request, { tenantId });
  },
);
