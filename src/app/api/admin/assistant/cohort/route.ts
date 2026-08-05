import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";
import { notify, KIND } from "@/lib/notify";

export const dynamic = "force-dynamic";

/**
 * Doing something to the people the assistant just found.
 *
 * WHY THIS IS THE HALF THAT MATTERS. An assistant that can answer "eighteen
 * Lagos B1 students have not paid and have not been seen in three weeks" and
 * then leaves you to find those eighteen by hand has not saved anybody
 * anything — it has added a step. The point of the lookup is the phone call
 * that follows it, so the rows come back selectable and this is where the
 * selection turns into an action.
 *
 * WHAT IT WILL NOT DO. It sends notifications and it exports. It does not
 * promote, does not mark paid, does not change a level, does not delete. Every
 * one of those is available on its own page, one student at a time, with the
 * confirmations that belong to it — and a bulk write driven by a list a
 * language model assembled is exactly the wrong place to discover that the
 * model misread "not paid" as "not fully paid". Reversible actions only.
 *
 * THE IDS ARE RE-CHECKED. The browser sends student ids, and the browser is
 * not trusted: every id is looked up again here, and anything that is not a
 * real student of this school is dropped rather than passed to notify().
 */

const MAX_RECIPIENTS = 500;

export async function POST(request: Request) {
  // `emails` rather than `students`: this sends messages to people. A Secretary
  // may look their cohort up and export it without being able to message the
  // whole school, which is the capability the office actually separates.
  const gate = await requireCapability("emails");
  if (!gate.ok) return gate.response;

  const body = await request.json().catch(() => ({}));
  const ids = Array.isArray(body.studentIds)
    ? (body.studentIds as unknown[]).filter((id): id is string => typeof id === "string").slice(0, MAX_RECIPIENTS)
    : [];
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const link = typeof body.link === "string" && body.link.startsWith("/") ? body.link : "/dashboard";

  if (ids.length === 0) return NextResponse.json({ error: "Select at least one student" }, { status: 400 });
  if (!title || !message) return NextResponse.json({ error: "A title and a message are required" }, { status: 400 });
  if (title.length > 120) return NextResponse.json({ error: "That title is too long" }, { status: 400 });
  if (message.length > 2000) return NextResponse.json({ error: "That message is too long" }, { status: 400 });

  // Never trust the list that came back. A stale tab, an edited request or a
  // cohort assembled before a student was withdrawn all end here.
  const real = await prisma.student.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });

  if (real.length === 0) {
    return NextResponse.json({ error: "None of those students exist any more" }, { status: 400 });
  }

  const result = await notify({
    to: { studentIds: real.map((student) => student.id) },
    title,
    message,
    kind: KIND.announcement,
    severity: "info",
    link,
    // Deliberately NOT deduped. The office chases the same unpaid balance more
    // than once on purpose, and a silent drop of the second chase would look
    // like the portal had sent it.
  });

  return NextResponse.json({
    ok: true,
    requested: ids.length,
    delivered: result.created,
    skipped: ids.length - real.length,
  });
}
