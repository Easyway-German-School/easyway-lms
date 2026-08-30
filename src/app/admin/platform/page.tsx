import { redirect } from "next/navigation";

/**
 * Moved to /platform — this console manages every school on the system,
 * EasyWay included, so it no longer lives inside EasyWay's own admin chrome;
 * it now wears EduPrime's, the platform brand. Kept as a redirect rather than
 * deleted outright: an operator's bookmark or an old link should still land
 * somewhere real.
 */
export default function LegacyPlatformRedirect() {
  redirect("/platform");
}
