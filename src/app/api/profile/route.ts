import { getServerSession } from "next-auth";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { keyFromUrl } from "@/lib/storage";

function pathwayOutcome(pathway: string) {
  if (pathway === "Language training") {
    return "C1 readiness + German work placement support";
  }
  if (pathway === "Nursing career path") {
    return "Medical German competency for nursing career success";
  }
  if (pathway === "IT relocation track") {
    return "German workplace fluency for tech relocation and interviews";
  }
  return "Tailored German proficiency for your pathway";
}

function pathwayReadiness(pathway: string) {
  switch (pathway) {
    case "Language training":
      return 72;
    case "Nursing career path":
      return 64;
    case "IT relocation track":
      return 68;
    case "Ausbildung & Vocational Route":
      return 60;
    default:
      return 55;
  }
}

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

async function isEmailTaken(email: string, currentUserId: string) {
  const existing = await prisma.user.findFirst({
    where: {
      email,
      NOT: { id: currentUserId },
    },
  });
  return !!existing;
}

export async function GET() {
  const session = await requireAuthSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const student = await prisma.student.findUnique({
    where: { userId: session.user.id as string },
    include: { user: true },
  });

  if (!student) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  const admission = typeof student.admission === "object" && student.admission !== null ? student.admission : {};

  return NextResponse.json({
    name: student.user?.name || "Learner",
    email: student.user?.email || "",
    level: student.level,
    pathway: student.pathway,
    outcome: student.outcome,
    nextLive: student.nextLive,
    examReadiness: student.examReadiness,
    activePrograms: [],
    admission,
  });
}

export async function POST(request: NextRequest) {
  const session = await requireAuthSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const selectedPathway = normalizeString(body.currentCourse) || "Language training";
  const fullName = normalizeString(body.fullName);
  const email = normalizeString(body.email);
  const phone = normalizeString(body.phone);
  const gender = normalizeString(body.gender);
  const dateOfBirth = normalizeString(body.dateOfBirth);
  const address = normalizeString(body.address);
  const branch = normalizeString(body.branch);
  const preferredExam = normalizeString(body.preferredExam);
  const currentLevel = normalizeString(body.currentLevel) || "A1";
  const photoUrl = normalizeString(body.photoUrl);

  // Only accept URLs this app's own storage produced — a local /uploads/ path,
  // an /api/files/ key, or the configured bucket's own origin. keyFromUrl()
  // returns null for anything else, which is exactly the "not one of ours"
  // test: a student editing their profile could otherwise point their avatar
  // at any URL on the internet. It also fixes the bug this replaces — in
  // production uploadImage() hands back "/api/files/<key>", which the old
  // startsWith("/uploads/") check rejected, so every avatar save 400'd with
  // "must be uploaded, not linked".
  if (photoUrl && !keyFromUrl(photoUrl)) {
    return NextResponse.json(
      { error: "Profile photos must be uploaded through EasyWay, not linked." },
      { status: 400 },
    );
  }

  const student = await prisma.student.findUnique({
    where: { userId: session.user.id as string },
    include: { user: true, branch: true },
  });

  if (!student) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  if (email && email !== student.user.email) {
    if (await isEmailTaken(email, student.user.id)) {
      return NextResponse.json({ error: "Email is already in use" }, { status: 409 });
    }
  }

  const currentAdmission: Record<string, any> =
    typeof student.admission === "object" && student.admission !== null
      ? (student.admission as Record<string, any>)
      : {};

  const updated = await prisma.student.update({
    where: { userId: session.user.id as string },
    data: {
      level: currentLevel,
      pathway: selectedPathway,
      outcome: pathwayOutcome(selectedPathway),
      examReadiness: pathwayReadiness(selectedPathway),
      nextLive: `Live coaching session for ${selectedPathway} scheduled soon`,
      admission: {
        ...currentAdmission,
        phone: phone || currentAdmission.phone,
        address: address || currentAdmission.address,
        gender: gender || currentAdmission.gender,
        dob: dateOfBirth || currentAdmission.dob,
        preferredExam: preferredExam || currentAdmission.preferredExam || "Not decided yet",
        branch: branch || currentAdmission.branch || (student.branch ? student.branch.name : undefined),
        photoUrl: photoUrl || currentAdmission.photoUrl,
      },
      user: {
        update: {
          name: fullName || student.user.name,
          email: email || student.user.email,
        },
      },
    },
    include: { user: true },
  });

  return NextResponse.json({
    name: updated.user?.name || "Learner",
    email: updated.user?.email || "",
    level: updated.level,
    pathway: updated.pathway,
    outcome: updated.outcome,
    nextLive: updated.nextLive,
    examReadiness: updated.examReadiness,
    activePrograms: [],
    admission: updated.admission,
  });
}
