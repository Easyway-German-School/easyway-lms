import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/admin-roles";
import { recorderFleetMode } from "@/lib/recorder";
import { applyControlRequest, readControl, writeControl } from "@/lib/recorder-control";

export const dynamic = "force-dynamic";

/**
 * Steer the recorder fleet: pause, days off, start room for a class now.
 * Writes a small file the scheduler reads every five minutes (so a change takes effect within about five minutes).
 * There is deliberately no way here to delete a server: that could lose a recording that is in progress.
 */
export async function POST(request: Request) {
  const gate = await requireCapability("materials");
  if (!gate.ok) return gate.response;

  if (!recorderFleetMode()) {
    return NextResponse.json({ error: "The recorder fleet is not switched on, so there is nothing to control." }, { status: 409 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const user = gate.session.user as { name?: string | null; email?: string | null };
  const by = user.name || user.email || "an admin";
  const result = applyControlRequest(await readControl(), body, by, new Date());
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  try {
    await writeControl(result.control);
  } catch (error) {
    console.error("Could not save the recorder control file", error);
    return NextResponse.json({ error: "Could not save the change. Nothing was changed." }, { status: 502 });
  }
  console.info("Recorder control changed", { by, control: result.control });
  return NextResponse.json({ control: result.control });
}
