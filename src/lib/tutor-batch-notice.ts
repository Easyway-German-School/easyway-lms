import { prisma } from "@/lib/prisma";
import { KIND, notify } from "@/lib/notify";
import { assignmentBatches, readAssignment, teachingGroups } from "@/lib/lecturer-assignment";

/**
 * Tell a tutor which intake (batch) the office has put them on.
 *
 * Assigning a tutor to "October" changed their roster and nothing else: no
 * message said so, and nothing on their dashboard named the batch. This sends
 * one bell + push + email per tutor per batch, and is idempotent — the
 * dedupeKey is (tutor, batch), so it is safe to call from the admin save AND
 * from the daily cron. The cron pass is what reaches tutors who were assigned
 * before this existed.
 */

const titleCase = (value: string) => value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();

export async function announceTutorBatches(opts: { lecturerId?: string } = {}) {
  const lecturers = await prisma.lecturer.findMany({
    where: { status: { not: "inactive" }, ...(opts.lecturerId ? { id: opts.lecturerId } : {}) },
  });
  if (!lecturers.length) return { tutors: 0, sent: 0, told: [] as string[] };

  const branches = await prisma.branch.findMany({ select: { id: true, name: true } });
  const branchNames = new Map(branches.map((branch) => [branch.id, branch.name]));

  let sent = 0;
  const told: string[] = [];
  for (const lecturer of lecturers) {
    const assignment = readAssignment(lecturer);
    const batches = assignmentBatches(assignment);
    if (!batches.length) continue;
    const groups = teachingGroups(assignment, branchNames);

    for (const batch of batches) {
      const name = titleCase(batch);
      const mine = groups.filter((group) => !group.batch || group.batch.toLowerCase() === batch.toLowerCase());
      const where = mine.length ? mine.map((group) => `${group.branchName} ${group.label}`).join(", ") : "your class";
      const result = await notify({
        to: { userIds: [lecturer.userId] },
        kind: KIND.announcement,
        severity: "info",
        title: `You're teaching the ${name} batch`,
        message: `The office has assigned you to the ${name} intake: ${where}. Your students and class details are on your dashboard.`,
        emailBody:
          `The office has assigned you to the ${name} intake.\n\nYour classes: ${where}.\n\n` +
          `Open your dashboard to see your students, your timetable and your numbers for this batch. ` +
          `If the batch has not started yet, your roster fills as students are placed.`,
        link: "/lecturer/dashboard",
        push: true,
        email: true,
        dedupeKey: `tutor-batch:${lecturer.id}:${batch.toLowerCase()}`,
      }).catch((error) => {
        console.error("Tutor batch notice failed", error);
        return null;
      });
      if (result && result.created > 0) {
        sent += result.created;
        told.push(name);
      }
    }
  }
  return { tutors: lecturers.length, sent, told };
}
