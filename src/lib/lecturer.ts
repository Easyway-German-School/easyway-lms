import { prisma } from "@/lib/prisma";

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
