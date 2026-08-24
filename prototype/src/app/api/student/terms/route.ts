import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ACCEPTANCE_WITHOUT_RECORD, TERMS_VERSION, TERMS_VERSION_LABEL } from "@/lib/terms";

/**
 * What THIS student agreed to, and when — read by the Profile page's legal
 * card and by the refund wall on Payments, so both surfaces quote the same
 * record rather than each guessing at it separately.
 */
export async function GET() {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const latest = await prisma.termsAcceptance.findFirst({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
  });

  if (!latest) {
    // Nobody with an account today signed up before this gate existed for
    // nothing to have accepted — see ACCEPTANCE_WITHOUT_RECORD in terms.ts,
    // which is section 30 quoted rather than paraphrased.
    return NextResponse.json({
      accepted: false,
      fallbackNotice: ACCEPTANCE_WITHOUT_RECORD,
      currentVersion: TERMS_VERSION,
      currentVersionLabel: TERMS_VERSION_LABEL,
    });
  }

  return NextResponse.json({
    accepted: true,
    context: latest.context,
    version: latest.version,
    acceptedAt: latest.createdAt.toISOString(),
    currentVersion: TERMS_VERSION,
    currentVersionLabel: TERMS_VERSION_LABEL,
    upToDate: latest.version === TERMS_VERSION,
  });
}
