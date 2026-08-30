import { redirect } from "next/navigation";

/**
 * Moved to /platform/billing — what a school owes for running on the platform
 * belongs with the platform (EduPrime), not inside the school's own admin
 * chrome. Kept as a redirect: the Paystack top-up callback, the low-balance
 * notification deep link and any operator bookmark all still point here.
 */
export default function LegacyBillingRedirect() {
  redirect("/platform/billing");
}
