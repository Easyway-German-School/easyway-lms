import { withUnscoped } from "@/lib/tenant/context";
import { processPaystackWebhook } from "@/lib/paystack-webhook";

/**
 * The platform's own (EasyWay) Paystack webhook. A business that connected its
 * own Paystack account posts to /api/paystack/webhook/<tenantId> instead.
 *
 * Wrapped rather than marked inside the body: the scope has to be established
 * before the handler runs, not on its first line. See withUnscoped in
 * src/lib/tenant/context.ts.
 */
export const POST = withUnscoped(
  "payment provider webhook carries no tenant; the payment record identifies it",
  (request: Request) => processPaystackWebhook(request),
);
