import { notify, KIND } from "@/lib/notify";
import type { TravelPackageReconcileResult } from "@/lib/travel-package";

const naira = (value: number) => `₦${Math.round(value).toLocaleString("en-NG")}`;

/**
 * Tell a Travel Package student, in their own numbers, that a payment on file
 * is a PART payment — sent after a reconcile that moved them from "settled" to
 * "balance owing" (a mis-file being put right). Deliberately warm, not a dunning
 * notice: the money they paid is safe and counts, there is simply more of the
 * ₦980,000 to go. Silent from their side otherwise — no email storm, just the
 * bell and the Payments page.
 *
 * No-op unless the reconcile actually changed the picture, so callers can pass
 * every result through without guarding.
 */
export async function travelPackagePartPaymentNotice(
  result: TravelPackageReconcileResult | null,
): Promise<void> {
  if (!result) return;
  if (!result.wasFullPaidBefore || result.fullPaidAfter) return;

  const paidLine = naira(result.paid);
  const owedLine = naira(result.owed);
  const priceLine = naira(result.packagePrice);

  await notify({
    to: { studentIds: [result.studentId] },
    kind: KIND.tuitionReminder,
    severity: "warning",
    title: "Travel Package — part payment recorded",
    message:
      `Your ${paidLine} is recorded against the Travel Package, which is ${priceLine} in total. ` +
      `That leaves ${owedLine} to pay` +
      (result.floorMet
        ? ". Your classes stay open — you can clear the balance in any amounts, any time."
        : `, and your classes open once the ${naira(result.minFirstPayment)} first payment is in.`),
    link: "/payments",
  });
}
