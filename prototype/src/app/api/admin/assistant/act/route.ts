import { NextResponse } from "next/server";
import { requireAdmin, type AdminContext } from "@/lib/admin-roles";
import { cancelPlan, executePlan } from "@/lib/action-plans";

export const dynamic = "force-dynamic";

/**
 * The Confirm button.
 *
 * This is the ONLY route in the application that turns something the assistant
 * proposed into something the school did, and it is deliberately tiny: it
 * establishes who is asking and hands one id to `executePlan`. Every rule about
 * what may run, by whom, and how recently it was reviewed lives in
 * src/lib/action-plans.ts, where it can be read in one screen.
 *
 * WHAT IT DOES NOT ACCEPT is the point. There is no cohort in the request body,
 * no message text, no filters, no amount. A confirmation that carried the
 * payload would let an edited request run against a group nobody previewed —
 * the confirm step would be checking the browser's word against nothing. The
 * body is an id, and the id names a row written by the server.
 *
 * The status codes matter to the page and are chosen rather than defaulted:
 *   403  your role does not cover this  → the button should not have been there
 *   404  no such plan
 *   409  somebody already confirmed it  → do NOT offer a retry
 *   410  expired                        → ask again to get a fresh one
 *   500  failed part-way               → go and look before retrying
 */

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  const body = await request.json().catch(() => ({}));
  const planId = typeof body.planId === "string" ? body.planId : "";
  if (!planId) return NextResponse.json({ error: "Which action?" }, { status: 400 });

  if (!auth.ok) return auth.response;

  if (body.cancel === true) {
    const cancelled = await cancelPlan(planId, auth.admin);
    return NextResponse.json({ ok: cancelled });
  }

  const result = await executePlan(planId, auth.admin);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ ok: true, summary: result.summary, details: result.details });
}
