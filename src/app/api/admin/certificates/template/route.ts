import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";
import { parseCertificateTemplate } from "@/lib/certificate-template";

export const dynamic = "force-dynamic";

/**
 * The wording, signatories and colours printed on every certificate.
 *
 * Gated on `students` rather than `materials`: a certificate is a statement
 * about a named student's result, and the people who should be able to change
 * what it says are the people who already hold the student records.
 */

/** One row per school. Created lazily so a fresh install needs no seed. */
async function loadRow() {
  return prisma.certificateTemplate.findFirst({ where: { key: "default" } });
}

export async function GET() {
  const gate = await requireCapability("students");
  if (!gate.ok) return gate.response;

  const row = await loadRow();

  return NextResponse.json({
    // Always a complete template: the parser merges whatever is stored over the
    // defaults, so a school that has never opened the editor — and a row saved
    // before a field existed — both render a finished document.
    template: parseCertificateTemplate(row?.settings),
    updatedAt: row?.updatedAt?.toISOString() ?? null,
    updatedBy: row?.updatedBy ?? null,
    customised: Boolean(row),
  });
}

export async function PUT(request: Request) {
  const gate = await requireCapability("students");
  if (!gate.ok) return gate.response;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "A template object is required" }, { status: 400 });
  }

  /**
   * Narrowed through the parser before it is stored, not after.
   *
   * The editor posts the whole template back, so without this an admin — or
   * anything else holding a session — could write arbitrary keys into the JSON
   * column and they would sit there forever. Parsing first means only known
   * fields survive, and the stored row is always renderable.
   */
  const template = parseCertificateTemplate((body as { template?: unknown }).template ?? body);

  const existing = await loadRow();
  const row = existing
    ? await prisma.certificateTemplate.update({
        where: { id: existing.id },
        data: { settings: template, updatedBy: gate.admin.email },
      })
    : await prisma.certificateTemplate.create({
        data: { key: "default", settings: template, updatedBy: gate.admin.email },
      });

  return NextResponse.json({
    template,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
    customised: true,
  });
}

/** Reset to the school's printed original. */
export async function DELETE() {
  const gate = await requireCapability("students");
  if (!gate.ok) return gate.response;

  const existing = await loadRow();
  if (existing) {
    // The row is dropped rather than blanked so `customised` goes back to
    // false — "never edited" and "edited back to the defaults" are different
    // facts, and the editor says which one it is looking at.
    await prisma.certificateTemplate.delete({ where: { id: existing.id } });
  }

  return NextResponse.json({ template: parseCertificateTemplate(null), customised: false });
}
