import { prisma } from "@/lib/prisma";
import { lecturerCan, type LecturerFeature } from "@/lib/lecturer-features";

/**
 * Resolve the Lecturer record id for a signed-in user.
 *
 * `session.user.id` is a **User** id. `Class.lecturerId`, `Material.lecturerId`
 * and `Exam.lecturerId` all reference the **Lecturer** table, which has its own
 * id. Passing the User id straight into those filters matches nothing and
 * silently returns empty lists rather than erroring — which is exactly how the
 * whole tutor portal came to look empty.
 *
 * Always go through this helper instead of using `session.user.id` directly.
 */
export async function resolveLecturerId(userId: string): Promise<string | null> {
  if (!userId) return null;
  const lecturer = await prisma.lecturer.findUnique({
    where: { userId },
    select: { id: true },
  });
  return lecturer?.id ?? null;
}

/**
 * Whether this tutor may reach one of the optional portal areas.
 *
 * THE SIDEBAR IS NOT THE GATE. LecturerShell hides the entries and refuses the
 * page, but that is presentation — a tutor with an old bookmark, a shared link
 * or browser history reaches the route directly, and the route is what has to
 * say no. Same division of labour as `requireCapability` on the admin side.
 *
 * Fails OPEN for a user with no Lecturer row: that is a data problem the
 * individual routes already handle, and turning it into a silent refusal here
 * would present as an outage nobody could diagnose.
 */
export async function lecturerHasFeature(userId: string, feature: LecturerFeature): Promise<boolean> {
  if (!userId) return false;
  const lecturer = await prisma.lecturer.findUnique({
    where: { userId },
    select: { features: true },
  });
  if (!lecturer) return true;
  return lecturerCan(lecturer.features, feature);
}
