import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";

export const dynamic = "force-dynamic";

/**
 * One-off: apply the `AssignmentSubmission.editCount` column directly
 * through the app's own (Vercel-injected) database connection.
 *
 * This exists because nobody driving this deploy — neither the agent nor
 * the admin clicking the link — ever needs to hold the real production
 * connection string: Vercel wires it into the running app already, and this
 * route just borrows that. Safe to visit more than once; the SQL is the
 * same idempotent statement that ships in
 * prisma/migrations/20261022120000_assignment_submission_edit_count/.
 *
 * Delete this route once it has been run against production — it is not
 * meant to stay as a general "run arbitrary SQL" backdoor.
 */
export async function GET() {
  const gate = await requireCapability("security");
  if (!gate.ok) return gate.response;

  try {
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "AssignmentSubmission" ADD COLUMN IF NOT EXISTS "editCount" INTEGER NOT NULL DEFAULT 0;',
    );
    const rows = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'AssignmentSubmission' AND column_name = 'editCount';`,
    );
    return NextResponse.json({ ok: true, columnPresent: rows.length > 0 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
