import { NextResponse } from "next/server";
import { AccessToken } from "livekit-server-sdk";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAttendLive, deriveStudentAccess } from "@/lib/access";
import { requiredDepositFor, tuitionFeeFor, isReceivedPayment, isRegistrationFeePayment } from "@/lib/payment";
import { isOnlineBranch, initialVideoQualityFor, readOnlineProfile } from "@/lib/online-branch";
import { ensureRecordingStarted } from "@/lib/class-recorder";
import { creditGate } from "@/lib/usage/guard";
import {
  announceLiveSession,
  liveSessionByCode,
  liveSessionForStudent,
  mayJoinPrivateRoom,
  openLiveSession,
  recordAttendance,
  LIVE_HEARTBEAT_MS,
} from "@/lib/live-presence";
import {
  cohortRoomName,
  initialQualityFor,
  missingLiveKitConfig,
  privateRoomName,
  roomDisplayName,
  type QualityMode,
  type RoomRole,
} from "@/lib/live-classroom";
import { lecturerCan } from "@/lib/lecturer-features";

export const dynamic = "force-dynamic";

/**
 * Everything the classroom page needs to open a room, in one request:
 * which provider, which room, a token scoped to what this person may do, and
 * the quality to start at.
 *
 * The token is minted here and nowhere else. It is short-lived and carries the
 * permissions — a student's token simply cannot mute the room, so there is no
 * client-side check to get around.
 */
export async function GET(request: Request) {
  try {
    const session = await requireAuthSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Live-class participant-minutes are a metered pass-through of the SFU
    // bill. If this school's credit is exhausted and enforcement is on, the
    // room is not issued. Default-off, so no existing tenant is affected.
    const gated = await creditGate();
    if (gated) return gated;

    const url = new URL(request.url);
    const requestedPrivateClassId = url.searchParams.get("privateClassId");
    const joinCode = url.searchParams.get("code");

    const [student, lecturer] = await Promise.all([
      prisma.student.findUnique({
        where: { userId: session.user.id },
        include: { payments: true, branch: { select: { id: true, name: true, mode: true } } },
      }),
      prisma.lecturer.findUnique({
        where: { userId: session.user.id },
        include: { branch: { select: { id: true, name: true, mode: true } } },
      }),
    ]);

    if (!student && !lecturer) {
      return NextResponse.json({ error: "No class profile found for this account" }, { status: 404 });
    }

    const role: RoomRole = lecturer ? "tutor" : "student";
    const isAdmin = String(session.user.role ?? "").toLowerCase() === "admin";

    /**
     * NOT EVERY TUTOR TAKES THE VIDEO CALL.
     *
     * The school decides who does, per tutor, and this is where that decision
     * is enforced rather than merely displayed. Hiding the sidebar entry stops
     * the honest route in; a token is a key to a live room with students in it,
     * so it has to be refused here too — an old bookmark or a shared link is
     * otherwise enough to walk into somebody else's lesson with tutor
     * permissions, which include muting the room.
     *
     * Checked before the private-class branch below deliberately: a tutor
     * without `live_classes` should not reach a private room either, and that
     * check is about membership rather than about whether they run calls at all.
     */
    if (lecturer && !lecturerCan(lecturer.features, "live_classes")) {
      return NextResponse.json(
        {
          error: "Not your area",
          message: "The school has not given you live classes. Ask the office if this is wrong.",
        },
        { status: 403 },
      );
    }

    /**
     * A join code is a SHORTCUT, NOT A KEY.
     *
     * It resolves which room the person meant — the whole point is the student
     * on somebody else's laptop, or the one whose email never arrived — and then
     * every authorization check below runs exactly as it would have. Treating a
     * six-character code as proof of membership would hand the room to anyone
     * who overheard it read out.
     */
    const codedSession = joinCode ? await liveSessionByCode(joinCode) : null;
    if (joinCode && !codedSession) {
      return NextResponse.json(
        { error: "No live class", message: "That code does not match a class that is live right now." },
        { status: 404 },
      );
    }

    const privateClassId = codedSession?.privateClassId ?? requestedPrivateClassId;

    /**
     * THE PRIVATE ROOM CHECK.
     *
     * `privateClassId` arrives in a query string, and until this existed that
     * was the only thing between a signed-in student and somebody else's
     * one-to-one lesson: pass an id, get a token. Ids are not secrets — they
     * appear in the tutor's own page markup — so this was a real way into a
     * private conversation. Membership is now checked against the booking and
     * the guest list before anything is minted.
     */
    if (privateClassId) {
      const allowed = await mayJoinPrivateRoom({
        privateClassId,
        studentId: student?.id ?? null,
        lecturerId: lecturer?.id ?? null,
        isAdmin,
      });
      if (!allowed) {
        return NextResponse.json(
          {
            error: "Not your class",
            message: "This is a private class you have not been invited to.",
          },
          { status: 403 },
        );
      }
    }

    // A student who still owes the deposit does not get a token at all. The
    // paywall on the page is the polite version of this; this is the one that
    // matters, because a token is a key to the room.
    if (student && !lecturer) {
      /**
       * A campus student has no video room, and a token is a key to one.
       *
       * Hiding the tab in the sidebar is presentation; this is the check that
       * decides. A student registered for physical classes who reaches this
       * endpoint — by typing the URL, or on a stale page — gets no token,
       * because the room they would join belongs to a different cohort.
       *
       * `private` is the exception: a one-to-one student takes their class
       * wherever their tutor books it, including over video. Note that this
       * now leans on a VERIFIED privateClassId — the membership check above
       * has already run — rather than on the caller simply claiming one.
       */
      if (!canAttendLive(student.deliveryMode, student.classType) && !privateClassId) {
        return NextResponse.json(
          {
            error: "Not an online class",
            deliveryMode: student.deliveryMode,
            message:
              "You are registered for classes on campus, so there is no live room for your class. Ask the branch office if you would like to move to online/hybrid.",
          },
          { status: 403 },
        );
      }

      const feeLookup = { level: student.level, branch: student.branch?.name ?? null, classType: student.classType, pathway: student.pathway };
      const totalPaid = student.payments
        .filter((payment) => isReceivedPayment(payment.status) && !isRegistrationFeePayment(payment.description))
        .reduce((sum, payment) => sum + payment.amount, 0);
      const access = deriveStudentAccess({
        totalPaid,
        tuitionFee: tuitionFeeFor(feeLookup),
        requiredDeposit: requiredDepositFor(feeLookup),
        classesStartedAt: student.classesStartedAt,
        enrolledAt: student.createdAt,
        paymentGraceUntil: student.paymentGraceUntil,
      });

      if (!access.hasAccess) {
        return NextResponse.json(
          {
            error: "Locked",
            locked: true,
            message:
              access.lockReason === "unsettled_balance"
                ? `Settle your tuition balance of ₦${access.outstandingBalance.toLocaleString()} to rejoin live classes.`
                : `Pay your deposit of ₦${access.requiredDeposit.toLocaleString()} to join live classes.`,
            access,
          },
          { status: 403 },
        );
      }
    }

    const branch = lecturer?.branch ?? student?.branch ?? null;
    const level = lecturer?.level ?? student?.level ?? "A1";
    const sessionSlot = lecturer?.sessionSlot ?? student?.sessionSlot ?? "morning";

    let roomName = privateClassId
      ? privateRoomName(privateClassId)
      : cohortRoomName({ branchName: branch?.name, level, sessionSlot });
    let displayName = privateClassId
      ? codedSession?.title ?? "Private class"
      : roomDisplayName({ branchName: branch?.name, level, sessionSlot });

    /**
     * A STUDENT MAY NOT WALK INTO A ROOM NOBODY IS TEACHING IN.
     *
     * Not a policy so much as an honesty fix. The room name is derived, so it
     * has always existed at three in the morning and looked exactly like a
     * lesson in progress — an empty grey grid the student concludes is broken.
     * Telling them "nothing is running yet, here is when it is" is the truth,
     * and it is also the only place we can offer them the alternative (the
     * recording of the last one) instead of a dead end.
     *
     * Tutors are exempt: somebody has to be first into the room.
     */
    let liveSession = null;
    if (role === "student" && student) {
      liveSession = await liveSessionForStudent({
        id: student.id,
        branchId: student.branchId,
        level: student.level,
        sessionSlot: student.sessionSlot,
        classType: student.classType,
      });

      if (!liveSession) {
        return NextResponse.json(
          {
            error: "Not live",
            notLive: true,
            message: "Your tutor has not started the class yet. We will buzz you the moment they do.",
            roomName,
            displayName,
          },
          { status: 409 },
        );
      }

      /**
       * Follow the session, not the derivation.
       *
       * A student invited to a one-to-one, or to a catch-up their tutor opened
       * outside the usual sitting, must land in THAT room — the room their own
       * branch+level+slot derives to is a different class, and sending them
       * there is how you get one student sitting alone wondering where everyone
       * is while the lesson happens next door.
       */
      roomName = liveSession.roomName;
      displayName = liveSession.title;
    }

    /**
     * The tutor arriving is what OPENS the class — the same event that starts
     * the recording. One join does four things: it opens the row, mints the
     * join code, rings the roster, and starts the capture. Nothing here is a
     * button, because the one class a tutor forgets to press the button for is
     * the one a student needed.
     */
    if (role === "tutor") {
      const opened = await openLiveSession({
        roomName,
        title: displayName,
        kind: privateClassId ? "private" : "cohort",
        branchId: branch?.id ?? null,
        level,
        sessionSlot,
        privateClassId: privateClassId ?? null,
        lecturerId: lecturer?.id ?? null,
        startedByUserId: session.user.id,
        // A private booking's own student is on the guest list automatically.
        // The tutor adding others is a separate, explicit act.
        inviteStudentIds: privateClassId ? await studentIdsForPrivateClass(privateClassId) : undefined,
      });

      liveSession = { ...opened, invited: false, inviteStatus: null };

      // Only on the FIRST open — `announceLiveSession` dedupes on the session
      // id, so a reload does not ring forty phones a second time.
      announceLiveSession(
        opened,
        opened.kind === "private" ? { studentIds: await studentIdsForPrivateClass(privateClassId!) } : {},
      );
    } else if (liveSession && student) {
      /**
       * Turning up answers the call, so the tutor's roster stops showing this
       * student as still ringing — and, for a cohort class nobody was rung
       * for, this is the ONLY record that they attended at all. It used to run
       * behind `liveSession.invited`, which meant the ordinary case of forty
       * students walking into their own timetabled lesson left no trace.
       */
      await recordAttendance(liveSession.id, student.id);
    }

    // Online students told us their connection at signup; start them there
    // rather than making them discover Data Saver during a frozen lesson.
    // Everyone else starts Balanced, which is safe on a campus network.
    const onlineProfile = student ? readOnlineProfile(student.admission) : {};
    const preferredQuality: QualityMode = isOnlineBranch(branch)
      ? initialVideoQualityFor(onlineProfile.connection)
      : "medium";
    // A tutor is pinned to Sharp regardless of what the branch would suggest —
    // the room is subscribed to them, so their layer is everyone's ceiling.
    const initialQuality: QualityMode = initialQualityFor(role, preferredQuality);

    const context = {
      roomName,
      displayName,
      role,
      level,
      sessionSlot,
      branchName: branch?.name ?? null,
      isOnlineBranch: isOnlineBranch(branch),
      initialQuality,
      participantName: session.user.name || session.user.email || "Student",
      // What the page needs to show the code, keep the session warm, and tell
      // the student who they are about to be in a room with.
      liveSessionId: liveSession?.id ?? null,
      joinCode: liveSession?.joinCode ?? null,
      startedAt: liveSession?.startedAt ?? null,
      tutorName: liveSession?.lecturerName ?? null,
      isPrivate: Boolean(privateClassId),
      heartbeatMs: LIVE_HEARTBEAT_MS,
    };

    /**
     * A HALF-CONFIGURED DEPLOYMENT SAYS SO, LOUDLY, BEFORE ANYONE JOINS.
     *
     * This used to hand back `provider: "jitsi"` and let the page quietly open
     * somebody else's video service — see the long note in `live-classroom.ts`
     * for what that cost us. The check now fails the request, and the message
     * is different depending on who is reading it: staff get the variable name,
     * because they are the ones who can fix it in ninety seconds; a student
     * gets told the truth without being handed the school's plumbing.
     */
    const missingConfig = missingLiveKitConfig();
    if (missingConfig.length > 0) {
      console.error(
        `Live classroom is not configured — missing ${missingConfig.join(", ")}. No class can start until these are set.`,
      );
      const staff = role === "tutor" || isAdmin;
      return NextResponse.json(
        {
          ...context,
          error: "Classroom not configured",
          misconfigured: true,
          missing: staff ? missingConfig : undefined,
          message: staff
            ? `The live classroom cannot start: ${missingConfig.join(", ")} ${
                missingConfig.length === 1 ? "is" : "are"
              } not set on this deployment. Add ${missingConfig.length === 1 ? "it" : "them"} to the environment and redeploy.`
            : "The live classroom is temporarily unavailable. The school has been alerted — please check back shortly or watch the recording of your last class.",
          token: null,
          url: null,
        },
        { status: 503 },
      );
    }

    const token = new AccessToken(process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!, {
      // The User id, so a participant is traceable back to an account for
      // attendance and moderation. Names are not unique; ids are.
      identity: session.user.id,
      name: context.participantName,
      // Long enough for a full class plus a reconnect, short enough that a
      // leaked token is not a standing invitation.
      ttl: "4h",
      metadata: JSON.stringify({ role, level }),
    });

    token.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      /**
       * Needed for hand-raise, and only for that.
       *
       * A raised hand has to survive a student joining ten minutes late, so it
       * lives in the participant's own attributes rather than in a fire-and-
       * forget data message. This is the permission to write those. It lets a
       * participant edit their OWN attributes and nobody else's, which is
       * exactly the scope wanted — the tutor-only powers stay in `roomAdmin`.
       */
      canUpdateOwnMetadata: true,
      // Only a tutor can mute others, remove a participant, or end the class.
      roomAdmin: role === "tutor",
    });

    /**
     * Deliberately not awaited: a slow or failing egress service must not delay
     * the tutor's own token by so much as a round trip. `ensureRecordingStarted`
     * swallows its errors and is idempotent, so a reload does not start a
     * second capture.
     *
     * Private one-to-one classes ARE recorded too, as of the class-notes
     * feature: this is the tutor's-tutor's-own capture becoming that
     * student's transcript, vocabulary and personalised recap afterwards —
     * see [[project-class-notes-pipeline]]. This used to be excluded outright
     * on consent grounds; the product decision is now to record, on the
     * understanding that a private session being recorded should be visibly
     * communicated to both sides, not just true in a database column. The
     * privacy half of that decision is enforced downstream, not here: a
     * private `ClassRecording` carries `privateClassId`, its `Material`
     * never gets `level` set, and `/api/student/videos` only ever surfaces it
     * to the one enrolled student — see the module comment on
     * `ClassRecording.privateClassId` in schema.prisma.
     */
    if (role === "tutor") {
      const { currentTenantId } = await import("@/lib/tenant/context");
      const tenantId = currentTenantId();
      void ensureRecordingStarted({
        roomName,
        tenantId,
        branchId: branch?.id ?? null,
        branchName: branch?.name ?? null,
        level,
        sessionSlot,
        startedByUserId: session.user.id,
        privateClassId: privateClassId ?? null,
      });
    }

    return NextResponse.json({
      ...context,
      provider: "livekit",
      token: await token.toJwt(),
      url: process.env.LIVEKIT_URL,
    });
  } catch (error) {
    console.error("Live session setup failed", error);
    return NextResponse.json({ error: "Could not set up the classroom" }, { status: 500 });
  }
}

/** The booked student, who is on the guest list by definition. */
async function studentIdsForPrivateClass(privateClassId: string): Promise<string[]> {
  const booking = await prisma.privateClass.findUnique({
    where: { id: privateClassId },
    select: { studentId: true },
  });
  return booking ? [booking.studentId] : [];
}
