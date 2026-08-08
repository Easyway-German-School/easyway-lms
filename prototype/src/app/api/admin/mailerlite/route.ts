import { NextRequest, NextResponse } from "next/server";
import { requireCapability } from "@/lib/admin-roles";
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
  const gate = await requireCapability("emails");
  if (!gate.ok) return gate.response;
  return { userId: gate.session.user.id as string };
}

export async function GET() {
  const auth = await requireEmailAdmin();
  if (auth instanceof NextResponse) return auth;

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
  if (auth instanceof NextResponse) return auth;

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
