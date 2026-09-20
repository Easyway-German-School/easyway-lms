import { prisma } from "@/lib/prisma";
import { notify, KIND } from "@/lib/notify";
import { isAssigned, readAssignment } from "@/lib/lecturer-assignment";
import { MATERIAL_AUDIENCE_SELECT, cohortMatchesAssignment } from "@/lib/material-audience";

/**
 * "You have materials sitting there — go send them to your class."
 *
 * An office cohort upload lands on a tutor's own `/lecturer/materials` list
 * the moment it matches their assignment (see the tutor materials GET), and
 * the office's own upload already pushed a notification to the students who
 * matched it that day. What neither of those covers is the tutor actually
 * NOTICING it is there and using the "Send to my class" button (see
 * `/api/lecturer/materials/[id]/send`) to catch anyone the original send
 * missed — a student named onto them afterwards, say. Becca surfaces it
 * instead of leaving it to be found by accident.
 *
 * Deliberately not per-material tracking of "has this tutor sent it" — that
 * would need a schema change for a nudge whose only job is to point a tutor
 * at a screen they already own the decision on. A once-a-week reminder that
 * "you have things to check" is honest without needing to know whether they
 * already handled the last one.
 */

/** Only nudge about materials from roughly the last three weeks — an upload from months ago is not "new" any more. */
const RECENT_DAYS = 21;
/** Ceiling on how many office materials we look at per tick. */
const MATERIAL_SCAN_LIMIT = 300;

function isoWeekKey(now = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-w${String(week).padStart(2, "0")}`;
}

export async function nudgeTutorsWithUnsentMaterials() {
  const cutoff = new Date(Date.now() - RECENT_DAYS * 86_400_000);

  const materials = await prisma.material.findMany({
    where: {
      lecturerId: null,
      uploadedBy: { not: null },
      visibleToStudents: true,
      createdAt: { gte: cutoff },
    },
    orderBy: { createdAt: "desc" },
    take: MATERIAL_SCAN_LIMIT,
    select: { ...MATERIAL_AUDIENCE_SELECT, title: true },
  });

  if (!materials.length) {
    return { scanned: 0, materialsChecked: 0, nudged: 0 };
  }

  const lecturers = await prisma.lecturer.findMany({
    where: { status: "active", deletedAt: null },
    select: {
      id: true,
      userId: true,
      branchId: true,
      level: true,
      sessionSlot: true,
      branchIds: true,
      levels: true,
      sessionSlots: true,
      assignmentGroups: true,
      classTypes: true,
      batches: true,
    },
  });

  let nudged = 0;
  const week = isoWeekKey();

  for (const lecturer of lecturers) {
    if (!lecturer.userId) continue;
    const assignment = readAssignment(lecturer);
    if (!isAssigned(assignment)) continue;

    const matching = materials.filter((material) => cohortMatchesAssignment(material, assignment));
    if (!matching.length) continue;

    const sample = matching[0];
    const res = await notify({
      to: { userIds: [lecturer.userId] },
      kind: KIND.materialsWaitingToSend,
      severity: "info",
      title:
        matching.length === 1
          ? "A material is waiting for your class"
          : `${matching.length} materials are waiting for your class`,
      message:
        matching.length === 1
          ? `Becca here — the office added “${sample.title}” for your class. Open Materials and hit “Send to my class” so everyone currently on your roster actually gets it.`
          : `Becca here — the office added ${matching.length} materials that match your class, including “${sample.title}”. Open Materials and send them to your roster — it only takes a tap each.`,
      link: "/lecturer/materials",
      push: true,
      dedupeKey: `materials-waiting-to-send:${lecturer.id}:${week}`,
    }).catch((error) => {
      console.error("Material-send nudge failed", lecturer.id, error);
      return null;
    });
    if (res && res.created > 0) nudged += 1;
  }

  return { scanned: lecturers.length, materialsChecked: materials.length, nudged };
}
