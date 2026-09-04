import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import bcryptjs from "bcryptjs";
import { assignStudentCode } from "@/lib/student-code";
import { notifyAdminsOfRegistration } from "@/lib/admin-alerts";
import { sendRegistrationConfirmation } from "@/lib/registration-email";
import { sendParentAccountCreatedEmail } from "@/lib/parent-account-email";
import { linkLeadOnSignup } from "@/lib/leads";
import { ensureChargeForLevel } from "@/lib/tuition-charges";
import { isOnlineBranch } from "@/lib/online-branch";
import { checkRateLimit, clientIp, rateLimitResponse } from "@/lib/rate-limit";
import { currentTenantId, setTenantScope } from "@/lib/tenant/context";
import { resolveTenantId } from "@/lib/tenant/resolve";
import { OFFERED_LEVELS } from "@/lib/levels";
import { TIME_SLOTS } from "@/lib/class-times";
import { TERMS_CONTEXT, TERMS_VERSION } from "@/lib/terms";
import { REGISTRATION_FEE } from "@/lib/payment";
import { validateSignupAccess, verifyInviteSig } from "@/lib/signup-access";
import { recordRegistrationFeeFromRef } from "@/lib/paystack-verify";

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
      termsAccepted,
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
      // Signup access proof — see the gate below. One of: a returning-student
      // token, a paid Paystack ref (new student), or a first-party invite
      // signature.
      signupToken,
      paystackRef,
      inviteSig,
      // The optional 4th step of the signup wizard: a parent/guardian account
      // to create and link alongside this student's, in the same submit. See
      // the parent-account block near the end of this handler.
      parent,
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
    // Level used to fall back to "A1" whenever this was missing or garbled,
    // which meant a student who never touched the level dropdown was silently
    // enrolled as a beginner instead of being told the field mattered. It is
    // validated below (against the same OFFERED_LEVELS the rest of the app
    // draws its level lists from) and the request is rejected rather than
    // defaulted when it is missing or not a real level.
    const normalizedLevel = typeof level === "string" ? level.trim().toUpperCase() : "";
    const levelValid = (OFFERED_LEVELS as readonly string[]).includes(normalizedLevel);
    const normalizedPathway = typeof pathway === "string" && pathway.trim() ? pathway : "Language training";
    const normalizedBatch = typeof batch === "string" && batch.trim() ? batch : "";
    const normalizedClassType = String(classType ?? "").toLowerCase() === "private" ? "private" : "group";
    // Same story as level: this used to fall back to "morning" for any missing
    // or invalid value, so a student who never opened the session dropdown got
    // enrolled into a slot they never chose. A private student genuinely has
    // nothing to choose here — they book their own times with their tutor, the
    // signup form hides the field for them — so validation below is skipped
    // only for classType "private". The DB column is a non-nullable
    // String @default("morning") that other code (the timetable, the
    // community room a student lands in) matches against directly, so a
    // private signup still needs *some* valid slot in storage; it lands on
    // "morning" rather than an empty string nothing downstream expects.
    const rawSessionSlot = typeof sessionSlot === "string" ? sessionSlot.trim().toLowerCase() : "";
    const sessionSlotValid = (TIME_SLOTS as readonly string[]).includes(rawSessionSlot);
    const normalizedSessionSlot = sessionSlotValid ? rawSessionSlot : "morning";

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

    /**
     * ── SIGNUP ACCESS GATE ─────────────────────────────────────────────────
     *
     * Public signup is only ever reached from the enrolment funnel: a
     * returning student carries a one-time `token`, a new student a Paystack
     * `?ref=` for a registration-fee charge they already paid on the
     * marketing site. The `/auth/signup` page hides the form without one, but
     * that is UX — THIS is the check that stops someone POSTing straight to
     * this endpoint to mint an account (and skip the registration fee).
     *
     * Staff never come through here: `role: "lecturer"` is refused above and
     * parent signup is its own route.
     *
     * A `403` here is deliberately generic — a probe should not learn whether
     * it was a bad token, a spent token, or a dud ref.
     */
    const accessDenied = () =>
      NextResponse.json(
        {
          error:
            "This signup link is invalid or has already been used. Please use the enrolment form on our website.",
        },
        { status: 403, headers: buildCorsHeaders(request) },
      );

    const signupTokenValue = typeof signupToken === "string" ? signupToken.trim() : "";
    const paystackRefValue = typeof paystackRef === "string" ? paystackRef.trim() : "";
    const inviteSigValue = typeof inviteSig === "string" ? inviteSig.trim() : "";

    let accessSource: "token" | "ref" | "invite-sig" = "token";
    let accessRefAmountNaira: number | undefined;
    let accessRefCurrency: string | undefined;

    if (inviteSigValue && !signupTokenValue && !paystackRefValue) {
      // First-party lead-invite link (src/lib/leads.ts) — a signature over the
      // prefilled params, keyed by SIGNUP_INVITE_SIGNING_SECRET.
      const okSig = verifyInviteSig(
        {
          email: normalizedEmail,
          name: normalizedName,
          level: typeof level === "string" ? level : undefined,
          branchId: normalizedBranchId ?? undefined,
          sessionSlot: typeof sessionSlot === "string" ? sessionSlot : undefined,
        },
        inviteSigValue,
      );
      if (!okSig) return accessDenied();
      accessSource = "invite-sig";
    } else {
      const gate = await validateSignupAccess({ token: signupTokenValue, ref: paystackRefValue });
      if (!gate.valid) return accessDenied();

      accessSource = gate.source === "ref" ? "ref" : "token";
      accessRefAmountNaira = gate.refAmountNaira;
      accessRefCurrency = gate.refCurrency;

      // The proof was issued FOR an email; the account being created must use
      // it, or a leaked-but-unused link is a free account for whoever finds it.
      if (gate.email && gate.email.toLowerCase() !== normalizedEmail) {
        return NextResponse.json(
          { error: "This signup link was issued for a different email address." },
          { status: 403, headers: buildCorsHeaders(request) },
        );
      }
    }
    // ──────────────────────────────────────────────────────────────────────

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

    if (normalizedRole === "STUDENT" && !levelValid) {
      return NextResponse.json(
        { error: "Please select a valid level" },
        { status: 400 }
      );
    }

    // PhotoCapture on the signup form refuses to submit without a photo, but
    // that's a UX courtesy like the terms gate below — a request that skips
    // the browser form entirely (a raw POST) must still be refused, not
    // silently create an account with no photo.
    if (normalizedRole === "STUDENT" && !normalizedAdmission.photoUrl) {
      return NextResponse.json(
        { error: "Please upload a profile photo." },
        { status: 400 }
      );
    }

    // Group students pick one of the house sittings; a private student agrees
    // their own times with their tutor and never sees this question, so it is
    // not required for them.
    if (normalizedRole === "STUDENT" && normalizedClassType !== "private" && !sessionSlotValid) {
      return NextResponse.json(
        { error: "Please select a session" },
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

    // The client-side gate (TermsGate on the signup form) is a UX courtesy,
    // not the enforcement — a crafted request that skips it must still be
    // refused, the same way a crafted request cannot skip the level check
    // above. `=== true` on purpose: anything else (missing, "yes", 1) is not
    // acceptance.
    if (normalizedRole === "STUDENT" && termsAccepted !== true) {
      return NextResponse.json(
        { error: "Please accept the Terms and Conditions to create your account." },
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
          // `User` is a global model, so nothing stamps this for us — see the
          // note on the same line in the admin tutor route. Without it a
          // student signs up successfully and then holds a session with no
          // tenant, which locks them out of their own portal.
          tenantId: currentTenantId(),
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
            branch: branchRow,
            classType: normalizedClassType,
          });
          // Close the enquiry this signup came from, so the office stops
          // chasing someone who has already enrolled.
          await linkLeadOnSignup(normalizedEmail, created.id);

          // Open the tuition ledger for their starting level. Best-effort like
          // the code assignment above — the backfill script repairs a missing
          // charge, and receivables falls back to the per-level figure until
          // one exists. See src/lib/tuition-charges.ts.
          try {
            await ensureChargeForLevel({
              studentId: created.id,
              level: normalizedLevel,
              origin: "signup",
            });
          } catch (chargeError) {
            console.error("Tuition charge creation failed on signup:", chargeError);
          }

          /**
           * Spend the access proof now the account exists.
           *
           * Best-effort, like everything else in this block: the signup has
           * already succeeded, so a missed consumption is a line for the
           * office to reconcile, never a registration that gets rolled back.
           *
           *   token       flip the invite to used (guarded on used:false so a
           *               double-submit second request is a no-op).
           *   ref         write the consumption marker AND credit the ₦5,000
           *               already paid on the marketing site, so the portal
           *               does not ask this student to pay the registration
           *               fee a second time.
           *   invite-sig  nothing to consume — the signature stays valid, but
           *               the email it is bound to now has an account, so a
           *               replay just hits "Email already registered".
           */
          try {
            if (accessSource === "token" && signupTokenValue) {
              await prisma.signupToken.updateMany({
                where: { token: signupTokenValue, used: false },
                data: { used: true, usedAt: new Date(), usedByUserId: user.id },
              });
            } else if (accessSource === "ref" && paystackRefValue) {
              await prisma.signupToken.create({
                data: {
                  paystackRef: paystackRefValue,
                  email: normalizedEmail,
                  name: normalizedName,
                  studentType: "new",
                  source: "wordpress-ref",
                  used: true,
                  usedAt: new Date(),
                  usedByUserId: user.id,
                  tenantId: currentTenantId(),
                },
              });
              await recordRegistrationFeeFromRef({
                studentId: created.id,
                reference: paystackRefValue,
                amountNaira: accessRefAmountNaira ?? REGISTRATION_FEE,
                currency: accessRefCurrency ?? "NGN",
                pathwayName: normalizedPathway,
              });
            }
          } catch (consumeError) {
            console.error("Signup access proof consumption failed:", consumeError);
          }
        }
      } catch (codeError) {
        console.error("Student code assignment failed:", codeError);
      }

      // The legal record of this exact moment: what they agreed to, and the
      // wording as it stood then. Best-effort, like the code assignment above
      // — a signup that already succeeded must not be undone by this failing,
      // but losing it silently would defeat the reason it is written at all.
      try {
        await prisma.termsAcceptance.create({
          data: {
            userId: user.id,
            studentId,
            context: TERMS_CONTEXT.signup,
            version: TERMS_VERSION,
            ip: clientIp(request.headers),
            userAgent: request.headers.get("user-agent") || undefined,
          },
        });
      } catch (termsError) {
        console.error("Terms acceptance recording failed:", termsError);
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

      /**
       * The optional 4th step: "add a parent/guardian to monitor this
       * account." Entirely skippable — most signups carry no `parent` at
       * all — and, like the two side effects above, unable to fail the
       * signup that already succeeded.
       *
       * Two shapes:
       *   - the parent's email is new: a second, linked account is created
       *     with a generated password, mailed to them.
       *   - the parent's email already belongs to a PARENT account with no
       *     child linked yet: that account is linked rather than duplicated
       *     — `Parent.userId` is unique, so one login cannot own two Parent
       *     rows. An email that already belongs to anything else (a
       *     student, an admin, or a parent already watching a different
       *     child) is left alone; this form is not how somebody else's
       *     account gets claimed or reassigned.
       */
      if (studentId && parent && typeof parent === "object") {
        try {
          const parentName = typeof (parent as any).name === "string" ? (parent as any).name.trim() : "";
          const parentEmail =
            typeof (parent as any).email === "string" ? (parent as any).email.trim().toLowerCase() : "";
          const parentPhone = typeof (parent as any).phone === "string" ? (parent as any).phone.trim() : "";

          if (parentName && parentEmail && parentEmail !== normalizedEmail) {
            const existingParentUser = await prisma.user.findUnique({
              where: { email: parentEmail },
              include: { parent: true },
            });

            if (!existingParentUser) {
              const temporaryPassword = crypto.randomBytes(9).toString("base64url");
              const hashedParentPassword = await bcryptjs.hash(temporaryPassword, 10);

              await prisma.user.create({
                data: {
                  email: parentEmail,
                  name: parentName,
                  password: hashedParentPassword,
                  role: "PARENT",
                  tenantId: currentTenantId(),
                  parent: {
                    create: {
                      phone: parentPhone || null,
                      childName: normalizedName,
                      childEmail: normalizedEmail,
                      children: {
                        create: {
                          studentId,
                          tenantId: currentTenantId(),
                        },
                      },
                    },
                  },
                },
              });

              await sendParentAccountCreatedEmail({
                parentName,
                parentEmail,
                temporaryPassword,
                studentName: normalizedName,
              });
            } else if (existingParentUser.role === "PARENT" && existingParentUser.parent) {
              await prisma.parent.update({
                where: { userId: existingParentUser.id },
                data: {
                  childName: normalizedName,
                  childEmail: normalizedEmail,
                  children: {
                    connectOrCreate: {
                      where: { parentId_studentId: { parentId: existingParentUser.parent.id, studentId } },
                      create: { studentId, tenantId: currentTenantId() },
                    },
                  },
                },
              });
            }
            // Any other existing-account shape (a student, an admin, or a
            // parent already linked elsewhere) is left untouched — see the
            // doc-comment above.
          }
        } catch (parentError) {
          console.error("Linked parent account creation failed:", parentError);
        }
      }
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
