import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcryptjs from "bcryptjs";

async function branchTableExists() {
  try {
    const rows = await prisma.$queryRaw<Array<{ name: string }>>`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'Branch'
    `;
    return rows.some((row) => row.name === "Branch");
  } catch {
    return false;
  }
}

function buildCorsHeaders(request: NextRequest) {
  const origin = request.headers.get("origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin === "*" ? "*" : origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Vary": "Origin",
  };
}

export async function OPTIONS(request: NextRequest) {
  return NextResponse.json({}, { status: 204, headers: buildCorsHeaders(request) });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const {
      email,
      password,
      name,
      role,
      branchId,
      level,
      pathway,
      batch,
      // Admission extra fields
      gender,
      dob,
      religion,
      profession,
      caste,
      bloodGroup,
      address,
      phone,
      city,
      state: stateField,
      country,
      motherTongue,
      birthPlace,
      idNumber,
      idProofUrl,
      photoUrl,
      parentIdProofUrl,
      idProofFileName,
      photoFileName,
      parentIdProofFileName,
      // previous school
      prevSchoolName,
      prevSchoolAddress,
      prevSchoolClass,
      prevPassoutYear,
      // admission detail
      studentType,
      classApplied,
      section,
      subjects,
      activity,
      medium,
      // parent
      fatherName,
      fatherPhone,
      fatherOccupation,
      motherName,
      motherPhone,
      motherOccupation,
      emergencyContactName,
      emergencyContactInfo,
      // parent login + transport + referral
      allowParentLogin,
      transportRoute,
      heardFrom,
    } = body || {};

    const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    const normalizedName = typeof name === "string" ? name.trim() : "";
    const normalizedPassword = typeof password === "string" ? password : "";
    const normalizedRole = role === "lecturer" ? "LECTURER" : "STUDENT";
    const normalizedBranchId = typeof branchId === "string" && branchId.trim() ? branchId : null;
    const normalizedLevel = typeof level === "string" && level.trim() ? level : "A1";
    const normalizedPathway = typeof pathway === "string" && pathway.trim() ? pathway : "Goethe exam mastery";
    const normalizedBatch = typeof batch === "string" && batch.trim() ? batch : "";

    // Build admission payload to persist as JSON
    const normalizedAdmission: Record<string, unknown> = {
      gender: typeof gender === "string" ? gender : undefined,
      dob: typeof dob === "string" ? dob : undefined,
      religion: typeof religion === "string" ? religion : undefined,
      profession: typeof profession === "string" ? profession : undefined,
      caste: typeof caste === "string" ? caste : undefined,
      bloodGroup: typeof bloodGroup === "string" ? bloodGroup : undefined,
      address: typeof address === "string" ? address : undefined,
      phone: typeof phone === "string" ? phone : undefined,
      city: typeof city === "string" ? city : undefined,
      state: typeof stateField === "string" ? stateField : undefined,
      country: typeof country === "string" ? country : undefined,
      motherTongue: typeof motherTongue === "string" ? motherTongue : undefined,
      birthPlace: typeof birthPlace === "string" ? birthPlace : undefined,
      idNumber: typeof idNumber === "string" ? idNumber : undefined,
      idProofUrl: typeof idProofUrl === "string" ? idProofUrl : undefined,
      photoUrl: typeof photoUrl === "string" ? photoUrl : undefined,
      parentIdProofUrl: typeof parentIdProofUrl === "string" ? parentIdProofUrl : undefined,
      idProofFileName: typeof idProofFileName === "string" ? idProofFileName : undefined,
      photoFileName: typeof photoFileName === "string" ? photoFileName : undefined,
      parentIdProofFileName: typeof parentIdProofFileName === "string" ? parentIdProofFileName : undefined,
      prevSchoolName: typeof prevSchoolName === "string" ? prevSchoolName : undefined,
      prevSchoolAddress: typeof prevSchoolAddress === "string" ? prevSchoolAddress : undefined,
      prevSchoolClass: typeof prevSchoolClass === "string" ? prevSchoolClass : undefined,
      prevPassoutYear: typeof prevPassoutYear === "string" ? prevPassoutYear : undefined,
      studentType: typeof studentType === "string" ? studentType : undefined,
      classApplied: typeof classApplied === "string" ? classApplied : undefined,
      section: typeof section === "string" ? section : undefined,
      subjects: Array.isArray(subjects) ? subjects : typeof subjects === "string" ? [subjects] : undefined,
      activity: typeof activity === "string" ? activity : undefined,
      medium: typeof medium === "string" ? medium : undefined,
      fatherName: typeof fatherName === "string" ? fatherName : undefined,
      fatherPhone: typeof fatherPhone === "string" ? fatherPhone : undefined,
      fatherOccupation: typeof fatherOccupation === "string" ? fatherOccupation : undefined,
      motherName: typeof motherName === "string" ? motherName : undefined,
      motherPhone: typeof motherPhone === "string" ? motherPhone : undefined,
      motherOccupation: typeof motherOccupation === "string" ? motherOccupation : undefined,
      emergencyContactName: typeof emergencyContactName === "string" ? emergencyContactName : undefined,
      emergencyContactInfo: typeof emergencyContactInfo === "string" ? emergencyContactInfo : undefined,
      allowParentLogin: typeof allowParentLogin === "boolean" ? allowParentLogin : undefined,
      transportRoute: typeof transportRoute === "string" ? transportRoute : undefined,
      heardFrom: typeof heardFrom === "string" ? heardFrom : undefined,
      batch: normalizedBatch,
    };

    if (!normalizedEmail || !normalizedPassword || !normalizedName) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const hasBranchTable = await branchTableExists();

    if (normalizedRole === "STUDENT" && !normalizedBranchId && hasBranchTable) {
      return NextResponse.json(
        { error: "Student branch selection is required" },
        { status: 400 }
      );
    }

    if (normalizedRole === "STUDENT" && !normalizedPathway) {
      return NextResponse.json(
        { error: "Please select a learning pathway" },
        { status: 400 }
      );
    }

    if (normalizedPathway === "Ausbildung (vocational training)" && !normalizedAdmission.profession) {
      return NextResponse.json(
        { error: "Please select an Ausbildung focus for vocational training" },
        { status: 400 }
      );
    }

    if (normalizedPassword.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters" },
        { status: 400 }
      );
    }

    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (existingUser) {
      return NextResponse.json(
        { error: "Email already registered" },
        { status: 409, headers: buildCorsHeaders(request) }
      );
    }

    const hashedPassword = await bcryptjs.hash(normalizedPassword, 10);

    let user;

    try {
      user = await prisma.user.create({
        data: {
          email: normalizedEmail,
          name: normalizedName,
          password: hashedPassword,
          role: normalizedRole,
          student: normalizedRole === "STUDENT" ? {
            create: ({
              level: normalizedLevel,
              pathway: normalizedPathway,
              outcome: "Goethe C1 readiness + German work placement support",
              branchId: hasBranchTable ? normalizedBranchId : null,
              // store admission payload as JSON
              admission: normalizedAdmission,
            } as any),
          } : undefined,
          lecturer: normalizedRole === "LECTURER" ? {
            create: {
              specialization: typeof body?.specialization === "string" ? body.specialization.trim() : null,
              bio: typeof body?.bio === "string" ? body.bio.trim() : null,
              phone: typeof body?.phone === "string" ? body.phone.trim() : null,
            },
          } : undefined,
        },
      });
    } catch (prismaError: any) {
      if (prismaError?.code === "P2002" && prismaError?.meta?.target?.includes("email")) {
        return NextResponse.json(
          { error: "Email already registered" },
          { status: 409, headers: buildCorsHeaders(request) }
        );
      }
      throw prismaError;
    }

    return NextResponse.json(
      {
        message: "User created successfully",
        user: { id: user.id, email: user.email, name: user.name },
      },
      { status: 201, headers: buildCorsHeaders(request) }
    );
  } catch (error) {
    console.error("Sign up error:", error);
    return NextResponse.json(
      {
        error: "Unable to create account right now. Please try again in a moment.",
        detail: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500, headers: buildCorsHeaders(request) }
    );
  }
}
