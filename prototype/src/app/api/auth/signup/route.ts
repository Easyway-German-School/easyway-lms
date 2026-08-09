import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcryptjs from "bcryptjs";
import { assignStudentCode } from "@/lib/student-code";
import { notifyAdminsOfRegistration } from "@/lib/admin-alerts";
import { sendRegistrationConfirmation } from "@/lib/registration-email";
import { linkLeadOnSignup } from "@/lib/leads";
import { isOnlineBranch } from "@/lib/online-branch";
import { checkRateLimit, clientIp, rateLimitResponse } from "@/lib/rate-limit";
import { setTenantScope } from "@/lib/tenant/context";
import { resolveTenantId } from "@/lib/tenant/resolve";

/**
 * Whether there is a Branch table to select from.
 *
 * This used to ask `sqlite_master`, from back when the database was SQLite and
 * a fresh checkout might not have the table yet. After the move to Postgres
 * that query does not merely return nothing — `sqlite_master` does not exist,
 * so it THROWS, the catch swallowed it, and this returned false every single
 * time in production. The branch-required check below is guarded by it, which
 * means that check has silently not run since the migration: a student could
 * register with no branch at all, and branch is what decides their tuition
 * price, their timetable and whose roster they appear on.
 *
 * Counting rows through Prisma asks the same question in a way that does not
 * depend on which engine is underneath.
 */
async function branchTableExists() {
  try {
    await prisma.branch.count();
    return true;
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
    /**
     * Which school this person is registering at, decided by the hostname they
     * arrived on. Set before anything else in the handler so that the User, the
     * Student, the student code and the office alert are all written against
     * the same tenant — a signup that half-lands in one school and half in
     * another is worse than one that fails.
     */
    setTenantScope(await resolveTenantId(request));

    /**
     * Registration is open to the public, so it is metered by IP.
     *
     * Ten an hour is generous for the real case — a family or a cyber café
     * enrolling several students in one sitting stays well inside it — and
     * ruinous for a script, because each account that gets through writes a
     * User, a Student, a student code and an alert email to the office.
     */
    const ip = clientIp(request.headers);
    const limit = checkRateLimit(`signup:ip:${ip}`, {
      windowMs: 60 * 60 * 1000,
      max: 10,
    });

    if (!limit.ok) {
      return rateLimitResponse(
        limit,
        "Too many registration attempts from this connection. Please try again later.",
        buildCorsHeaders(request),
      );
    }

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
      sessionSlot,
      classType,
      deliveryMode,
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
    // Public signup creates students and nothing else.
    //
    // This route used to mint a LECTURER on request. The admin console showed
    // an "invite code" that was supposed to guard it, but nothing here ever
    // read that code — anyone who could POST this endpoint could give
    // themselves a tutor account, and with it every student roster in the
    // school. Tutors are created by an admin at /admin/lecturer-invite.
    if (role === "lecturer") {
      return NextResponse.json(
        { error: "Tutor accounts are created by the school office. Please contact your branch." },
        { status: 403, headers: buildCorsHeaders(request) },
      );
    }
    const normalizedRole = "STUDENT" as const;
    const normalizedBranchId = typeof branchId === "string" && branchId.trim() ? branchId : null;
    const normalizedLevel = typeof level === "string" && level.trim() ? level : "A1";
    const normalizedPathway = typeof pathway === "string" && pathway.trim() ? pathway : "Language training";
    const normalizedBatch = typeof batch === "string" && batch.trim() ? batch : "";
    const normalizedSessionSlot = ["morning", "afternoon", "evening"].includes(
      String(sessionSlot ?? "").toLowerCase(),
    )
      ? String(sessionSlot).toLowerCase()
      : "morning";
    const normalizedClassType = String(classType ?? "").toLowerCase() === "private" ? "private" : "group";

    /**
     * How this student attends: physical | hybrid | online.
     *
     * Decided against the BRANCH, not taken on trust from the form. The live
     * classroom, the recordings and the video library all hang off this, so a
     * crafted request must not be able to hand a campus student the online
     * product — or, just as bad, strand an online student without the one way
     * they have of attending at all.
     */
    const branchRow = normalizedBranchId
      ? await prisma.branch.findUnique({
          where: { id: normalizedBranchId },
          select: { name: true, mode: true },
        })
      : null;
    const requestedDeliveryMode = String(deliveryMode ?? "").toLowerCase();
    const normalizedDeliveryMode = isOnlineBranch(branchRow)
      ? "online"
      : requestedDeliveryMode === "hybrid"
        ? "hybrid"
        : "physical";

    // Only present on an online signup. Left undefined for a campus student so
    // their admission record does not gain an empty object.
    const onlineProfile = (body as Record<string, unknown> | null)?.online;
    const normalizedOnlineProfile =
      onlineProfile && typeof onlineProfile === "object"
        ? {
            timezone: typeof (onlineProfile as any).timezone === "string" ? (onlineProfile as any).timezone : undefined,
            device: typeof (onlineProfile as any).device === "string" ? (onlineProfile as any).device : undefined,
            connection: typeof (onlineProfile as any).connection === "string" ? (onlineProfile as any).connection : undefined,
          }
        : undefined;

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
      // Online cohort answers (timezone / device / connection). Nested rather
      // than flattened so `readOnlineProfile` has one place to look and these
      // keys can never collide with an admission field added later.
      online: normalizedOnlineProfile,
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
          student: {
            create: ({
              level: normalizedLevel,
              pathway: normalizedPathway,
              sessionSlot: normalizedSessionSlot,
              classType: normalizedClassType,
              deliveryMode: normalizedDeliveryMode,
              outcome: "C1 readiness + German work placement support",
              branchId: hasBranchTable ? normalizedBranchId : null,
              // store admission payload as JSON
              admission: normalizedAdmission,
            } as any),
          },
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

    // Issue the official student code. Deliberately after the user exists and
    // outside the create call: a failure here must not cost someone their
    // account, and the backfill script can repair a missing code later.
    let studentCode: string | null = null;
    // Kept outside the try so the office alert can deep-link to this exact
    // person rather than dropping whoever it is on the roster to be searched
    // for. Null when the lookup failed, and the alert falls back to the list.
    let studentId: string | null = null;
    if (normalizedRole === "STUDENT") {
      try {
        const created = await prisma.student.findUnique({
          where: { userId: user.id },
          select: { id: true },
        });
        if (created) {
          studentId = created.id;
          studentCode = await assignStudentCode(created.id, {
            level: normalizedLevel,
            batch: (normalizedAdmission as any)?.batch,
          });
          // Close the enquiry this signup came from, so the office stops
          // chasing someone who has already enrolled.
          await linkLeadOnSignup(normalizedEmail, created.id);
        }
      } catch (codeError) {
        console.error("Student code assignment failed:", codeError);
      }

      // The office needs to know a registration landed. Queued, not sent
      // inline, so a slow mail provider cannot delay the signup response.
      const branchName = branchRow?.name ?? null;

      await notifyAdminsOfRegistration({
        studentId,
        studentName: normalizedName,
        studentEmail: normalizedEmail,
        studentCode,
        level: normalizedLevel,
        sessionSlot: normalizedSessionSlot,
        pathway: normalizedPathway,
        branchName,
        classType: normalizedClassType,
      });

      /**
       * And the student, who until now was told nothing at all.
       *
       * Last of the three side effects and, like the other two, unable to fail
       * the signup: the account exists, the code is issued and the office has
       * been told. Anything that goes wrong here is a courtesy that did not
       * arrive, not a registration that did not happen.
       */
      await sendRegistrationConfirmation({
        studentName: normalizedName,
        studentEmail: normalizedEmail,
        studentCode,
        level: normalizedLevel,
        sessionSlot: normalizedSessionSlot,
        pathway: normalizedPathway,
        branchName,
        classType: normalizedClassType,
        deliveryMode: normalizedDeliveryMode,
      });
    }

    return NextResponse.json(
      {
        message: "User created successfully",
        user: { id: user.id, email: user.email, name: user.name },
        studentCode,
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
