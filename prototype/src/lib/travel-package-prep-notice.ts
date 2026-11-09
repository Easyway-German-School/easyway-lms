import { prisma } from "@/lib/prisma";
import { isTravelPackagePathway } from "@/lib/payment";
import { KIND, notify } from "@/lib/notify";

/**
 * Becca's one-time "this is new, go look" push for the Travel Package Visa &
 * Interview Prep guide (see /travel-package). Office-triggered from the
 * Travel Package roster, not automatic — the office decides when the guide
 * is ready to announce, and this can be clicked again safely afterwards: the
 * dedupe key means it only ever reaches a given student once.
 */
const DEDUPE_KEY = "travel-package-prep-ready-v1";

export async function notifyTravelPackagePrepReady(): Promise<{ sent: number }> {
  const students = await prisma.student.findMany({
    where: { deletedAt: null, status: { not: "inactive" } },
    select: { id: true, pathway: true },
  });
  const studentIds = students.filter((s) => isTravelPackagePathway(s.pathway)).map((s) => s.id);
  if (studentIds.length === 0) return { sent: 0 };

  const result = await notify({
    to: { studentIds },
    kind: KIND.travelPackagePrepReady,
    severity: "info",
    dedupeKey: DEDUPE_KEY,
    title: "Your Germany prep, now interactive",
    message:
      "Becca: \"I've put together a proper visa-interview and bootcamp guide just for the Travel Package — your route, " +
      "the real questions, and a few things to practise before we talk to the office about your appointment. Have a look " +
      "when you get a moment.\"",
    link: "/travel-package",
  });

  return { sent: result.created };
}
