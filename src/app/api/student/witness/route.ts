import { NextResponse } from "next/server";

import { requireAuthSession } from "@/lib/auth";
import { parseWitnessBody, recordPortalWitness } from "@/lib/portal-witness";

export const dynamic = "force-dynamic";

/**
 * The student's shell reports what it actually rendered. See lib/portal-witness.ts.
 *
 * Fire-and-forget from the browser, so it never fails loudly: a witness that
 * can break the page it is watching is worse than none. An unusable body is a
 * 400, an unrecordable one is swallowed into the incident register.
 */
export async function POST(request: Request) {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const input = parseWitnessBody(await request.json().catch(() => null));
  if (!input) return NextResponse.json({ error: "Bad witness report" }, { status: 400 });

  try {
    const result = await recordPortalWitness(session.user.id as string, input);
    return NextResponse.json({ ok: true, recorded: result.recorded, judged: result.judgement?.kind ?? null });
  } catch (error) {
    const { captureError } = await import("@/lib/capture-error");
    await captureError("portal-witness", error, { routePath: "/api/student/witness", method: "POST" });
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
