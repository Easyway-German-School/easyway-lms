import bcryptjs from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability, ADMIN_ROLE_LABELS } from "@/lib/admin-roles";
import { generateTempPassword } from "@/lib/student-password";
import { sendAdminWelcomeEmail } from "@/lib/admin-welcome-email";

export const dynamic = "force-dynamic";

const EDITABLE_AMOUNT_FIELDS = [
  "discountPercent",
  "discountFlat",
  "discountCapAmount",
  "commissionPercent",
  "commissionFlat",
] as const;

/** Edit a code's reward config, label, or status (active/paused/revoked). */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireCapability("payments");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "A request body is required" }, { status: 400 });
  }

  /**
   * (Re)send the partner's login email with a fresh generated password —
   * the fix for a partner whose account was created before this existed, or
   * who was never actually emailed because nobody had a way to set their
   * password from this side. A new password replaces the old one; the admin
   * can no longer see or relay the original either way.
   */
  if ((body as Record<string, unknown>).sendLoginEmail === true) {
    const code = await prisma.promoCode.findUnique({
      where: { id },
      select: { ownerUser: { select: { id: true, name: true, email: true } } },
    });
    if (!code?.ownerUser) {
      return NextResponse.json({ error: "This code has no linked partner account" }, { status: 404 });
    }

    const generatedPassword = generateTempPassword();
    await prisma.user.update({
      where: { id: code.ownerUser.id },
      data: { password: await bcryptjs.hash(generatedPassword, 10), passwordClaimed: true },
    });

    let welcomeEmailStatus: "queued" | "suppressed" | "failed" = "failed";
    try {
      const welcomeEmail = await sendAdminWelcomeEmail({
        name: code.ownerUser.name ?? "",
        email: code.ownerUser.email,
        temporaryPassword: generatedPassword,
        roleLabel: ADMIN_ROLE_LABELS.influencer,
      });
      welcomeEmailStatus = welcomeEmail.status === "suppressed" ? "suppressed" : "queued";
    } catch (error) {
      console.error("Partner login email could not be queued:", { email: code.ownerUser.email, error });
    }

    return NextResponse.json({
      ok: true,
      welcomeEmailStatus,
      // Only handed back when there's no email to carry it.
      ...(welcomeEmailStatus === "queued" ? {} : { generatedPassword }),
    });
  }

  const data: Record<string, number | string | null> = {};

  for (const field of EDITABLE_AMOUNT_FIELDS) {
    if (!(field in body)) continue;
    const raw = (body as Record<string, unknown>)[field];
    if (raw === null || raw === "") {
      data[field] = null;
      continue;
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) {
      return NextResponse.json({ error: `${field} must be a non-negative number` }, { status: 400 });
    }
    data[field] = Math.round(n);
  }

  if ("label" in body) {
    const label = (body as Record<string, unknown>).label;
    data.label = typeof label === "string" && label.trim() ? label.trim() : null;
  }

  if ("notes" in body) {
    const notes = (body as Record<string, unknown>).notes;
    data.notes = typeof notes === "string" && notes.trim() ? notes.trim() : null;
  }

  if ("partnerType" in body) {
    const partnerType = (body as Record<string, unknown>).partnerType;
    if (partnerType !== "influencer" && partnerType !== "travel_agent" && partnerType !== "ambassador" && partnerType !== "other") {
      return NextResponse.json({ error: "partnerType must be influencer, travel_agent, ambassador or other" }, { status: 400 });
    }
    data.partnerType = partnerType;
  }

  for (const field of ["payoutBankName", "payoutAccountNumber", "payoutAccountName"] as const) {
    if (!(field in body)) continue;
    const raw = (body as Record<string, unknown>)[field];
    data[field] = typeof raw === "string" && raw.trim() ? raw.trim() : null;
  }

  if ("status" in body) {
    const status = (body as Record<string, unknown>).status;
    if (status !== "active" && status !== "paused" && status !== "revoked") {
      return NextResponse.json({ error: "status must be active, paused or revoked" }, { status: 400 });
    }
    data.status = status;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  try {
    await prisma.promoCode.update({ where: { id }, data });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Admin promo-codes PATCH failed:", error);
    return NextResponse.json({ error: "Unable to update the code" }, { status: 400 });
  }
}
