import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { LECTURER_STATUS_META, readLecturerStatus } from "@/lib/lecturer-status";
import { lecturerFeatures } from "@/lib/lecturer-features";

export const dynamic = "force-dynamic";

/**
 * "Does this tutor still work here?" — asked by the portal shell on every page.
 *
 * Sign-in already refuses an inactive tutor, but sessions are JWTs with a
 * 30-day life: somebody marked inactive on Monday keeps a working session
 * until the token lapses. This is what closes that window for a session that
 * already exists, and it is deliberately tiny — one indexed lookup, no joins —
 * because it runs on every navigation inside the portal.
 */
export async function GET() {
  const session = await requireAuthSession();

  const userId = session?.user?.id;
  const role = String(session?.user?.role ?? "").toLowerCase();

  // "inactive_lecturer" is what the session callback downgrades a revoked
  // tutor to. This route has to accept it — it is the one endpoint whose job
  // is to report that state back to the portal so it can sign them out.
  if (!userId || (role !== "lecturer" && role !== "inactive_lecturer")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const lecturer = await prisma.lecturer.findUnique({
    where: { userId },
    // `features` rides along rather than getting its own endpoint: the shell
    // already calls this on every navigation, so the sidebar can be filtered
    // for free. A second request would double the portal's chattiest call to
    // answer a question this one is already in the right place to answer.
    select: { status: true, statusNote: true, features: true },
  });

  // No Lecturer row is a data problem, not a revocation — the individual
  // routes already handle it, and locking the portal here would turn it into
  // an outage nobody could diagnose.
  const status = readLecturerStatus(lecturer?.status);

  return NextResponse.json({
    status,
    statusNote: lecturer?.statusNote ?? null,
    active: LECTURER_STATUS_META[status].canSignIn,
    // Null column means every area, so a tutor who predates this field keeps
    // the portal they had. See src/lib/lecturer-features.ts.
    features: lecturerFeatures(lecturer?.features),
  });
}
