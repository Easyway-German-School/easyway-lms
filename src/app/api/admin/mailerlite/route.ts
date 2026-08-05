import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { adminHasCapability } from "@/lib/admin-roles";
import { checkMailerLite, checkMailerSend, listGroups } from "@/lib/mailerlite";
import { syncStudentsToMailerLite } from "@/lib/mailerlite-sync";
import { activeTransport } from "@/lib/mailer";

/**
 * MailerLite status and roster sync, for admins holding the emails capability.
 *
 * The sync writes to a live marketing list with thousands of real contacts on
 * it, so POST defaults to a dry run and only performs a real sync when it is
 * asked to in as many words.
 */

export const dynamic = "force-dynamic";

async function requireEmailAdmin() {
  const session = (await getServerSession(authOptions as any)) as any;
  if (!session?.user?.id) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (!(await adminHasCapability(session.user.id, "emails"))) {
    return { error: NextResponse.json({ error: "Your admin role does not cover email" }, { status: 403 }) };
  }
  return { userId: session.user.id as string };
}

export async function GET() {
  const auth = await requireEmailAdmin();
  if (auth.error) return auth.error;

  const [marketing, transactional, groups] = await Promise.all([
    checkMailerLite(),
    checkMailerSend(),
    listGroups(),
  ]);

  return NextResponse.json({
    transport: activeTransport(),
    marketing,
    transactional,
    groups: groups.ok ? groups.groups : [],
    groupsError: groups.ok ? null : groups.error,
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireEmailAdmin();
  if (auth.error) return auth.error;

  try {
    const body = await req.json().catch(() => ({}));
    // Anything other than an explicit confirm is a rehearsal.
    const dryRun = body?.confirm !== true;

    const result = await syncStudentsToMailerLite({ dryRun });
    return NextResponse.json(result);
  } catch (error) {
    console.error("MailerLite sync failed:", error);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
