import { NextResponse, type NextRequest } from "next/server";
import { recordBackupRun, type BackupKind } from "@/lib/backup-health";

/**
 * Where the backup jobs check in.
 *
 * The jobs themselves run on GitHub Actions rather than here, deliberately —
 * a Vercel function has 60 seconds and a 4.5MB response ceiling, and a
 * `pg_dump` of a school that keeps growing will breach both, on some ordinary
 * Tuesday, without warning. What the app keeps is only the record that a run
 * happened, which is what the staleness alarm reads.
 *
 * Authenticated with CRON_SECRET, the same shared secret the scheduled routes
 * use. Worth being clear about what that protects: this endpoint only writes
 * BackupRun rows, so the damage an attacker with the secret could do is to
 * report backups that never happened — which would silence the alarm. That is
 * a real attack on the recovery plan, and it is the reason CRON_SECRET belongs
 * in the "rotate immediately" list in docs/SECURITY.md rather than being
 * treated as a low-value token.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 });
  }

  const kind = String((body as Record<string, unknown>).kind || "");
  if (!["database", "objects", "drill"].includes(kind)) {
    return NextResponse.json(
      { error: "kind must be one of: database, objects, drill" },
      { status: 400 },
    );
  }

  const status = String((body as Record<string, unknown>).status || "");
  if (!["success", "failed"].includes(status)) {
    return NextResponse.json(
      { error: "status must be success or failed" },
      { status: 400 },
    );
  }

  const input = body as Record<string, unknown>;
  const run = await recordBackupRun({
    kind: kind as BackupKind,
    status: status as "success" | "failed",
    snapshotId: typeof input.snapshotId === "string" ? input.snapshotId : null,
    sizeBytes: typeof input.sizeBytes === "number" ? input.sizeBytes : null,
    detail: input.detail ?? null,
    error: typeof input.error === "string" ? input.error.slice(0, 2000) : null,
  });

  return NextResponse.json({ ok: true, id: run.id });
}
