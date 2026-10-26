import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getFile, keyFromUrl, storageConfigured } from "@/lib/storage";
import { buildTermsCertificatePdf, type TermsCertificatePhoto } from "@/lib/terms-certificate-pdf";
import { ACCEPTANCE_WITHOUT_RECORD, TERMS_VERSION_LABEL } from "@/lib/terms";

/**
 * The student's personal, downloadable copy of the Terms and Conditions
 * (Refund Policy included — sections 23–26), with their own photo and
 * acceptance record on it. Linked from /terms and the refund wall.
 */

async function fetchPhoto(photoUrl: unknown): Promise<TermsCertificatePhoto | null> {
  if (typeof photoUrl !== "string" || !photoUrl.trim()) return null;

  try {
    let bytes: Buffer | null = null;
    const key = keyFromUrl(photoUrl);

    if (key && storageConfigured()) {
      const upstream = await getFile(key);
      if (upstream) bytes = Buffer.from(await upstream.arrayBuffer());
    } else if (key) {
      // Local dev: uploads live on disk under public/uploads, not the bucket.
      bytes = await fs.readFile(path.join(process.cwd(), "public", "uploads", key)).catch(() => null);
    } else if (/^https?:\/\//i.test(photoUrl)) {
      const response = await fetch(photoUrl);
      if (response.ok) bytes = Buffer.from(await response.arrayBuffer());
    }

    if (!bytes || bytes.length === 0) return null;
    const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    return { bytes, kind: isPng ? "png" : "jpg" };
  } catch {
    // A broken or unreachable photo must not block the document itself.
    return null;
  }
}

export async function GET() {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const student = await prisma.student.findUnique({
    where: { userId: session.user.id },
    select: {
      studentCode: true,
      level: true,
      pathway: true,
      admission: true,
      userId: true,
      user: { select: { name: true, tenant: { select: { brandName: true } } } },
    },
  });

  if (!student) return NextResponse.json({ error: "Student profile not found" }, { status: 404 });

  const latest = await prisma.termsAcceptance.findFirst({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
  });

  const admission = (student.admission ?? null) as Record<string, unknown> | null;
  const photo = await fetchPhoto(admission?.photoUrl);

  const pdf = await buildTermsCertificatePdf({
    schoolName: student.user.tenant?.brandName ?? undefined,
    studentName: student.user.name || "Student",
    studentCode: student.studentCode,
    level: student.level,
    pathway: student.pathway,
    photo,
    acceptance: latest
      ? { accepted: true, version: latest.version, acceptedAt: latest.createdAt, context: latest.context }
      : { accepted: false, fallbackNotice: ACCEPTANCE_WITHOUT_RECORD },
    currentVersionLabel: TERMS_VERSION_LABEL,
  });

  const filenameSafeCode = (student.studentCode || "student").replace(/[^a-zA-Z0-9-]/g, "_");

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="Terms-and-Conditions-${filenameSafeCode}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
