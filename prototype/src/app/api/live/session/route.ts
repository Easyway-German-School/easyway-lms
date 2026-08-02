import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { AccessToken } from "livekit-server-sdk";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAttendLive, deriveStudentAccess } from "@/lib/access";
import { requiredDepositFor, tuitionFeeFor } from "@/lib/payment";
import { isOnlineBranch, initialVideoQualityFor, readOnlineProfile } from "@/lib/online-branch";
import { ensureRecordingStarted } from "@/lib/class-recorder";
import {
  cohortRoomName,
  liveKitConfigured,
  privateRoomName,
  roomDisplayName,
  type QualityMode,
  type RoomRole,
} from "@/lib/live-classroom";

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
    const session = (await getServerSession(authOptions as any)) as any;
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(request.url);
    const privateClassId = url.searchParams.get("privateClassId");

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
       * wherever their tutor books it, including over video.
       */
      if (!canAttendLive(student.deliveryMode) && student.classType !== "private" && !privateClassId) {
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

      const feeLookup = { level: student.level, branch: student.branch?.name ?? null, classType: student.classType };
      const totalPaid = student.payments
        .filter((payment) => payment.status === "completed")
        .reduce((sum, payment) => sum + payment.amount, 0);
      const access = deriveStudentAccess({
        totalPaid,
        tuitionFee: tuitionFeeFor(feeLookup),
        requiredDeposit: requiredDepositFor(feeLookup),
      });

      if (!access.hasAccess) {
        return NextResponse.json(
          {
            error: "Locked",
            locked: true,
            message: `Pay your deposit of ₦${access.requiredDeposit.toLocaleString()} to join live classes.`,
            access,
          },
          { status: 403 },
        );
      }
    }

    const branch = lecturer?.branch ?? student?.branch ?? null;
    const level = lecturer?.level ?? student?.level ?? "A1";
    const sessionSlot = lecturer?.sessionSlot ?? student?.sessionSlot ?? "morning";

    const roomName = privateClassId
      ? privateRoomName(privateClassId)
      : cohortRoomName({ branchName: branch?.name, level, sessionSlot });
    const displayName = privateClassId
      ? "Private class"
      : roomDisplayName({ branchName: branch?.name, level, sessionSlot });

    // Online students told us their connection at signup; start them there
    // rather than making them discover Data Saver during a frozen lesson.
    // Everyone else starts Balanced, which is safe on a campus network.
    const onlineProfile = student ? readOnlineProfile(student.admission) : {};
    const initialQuality: QualityMode = isOnlineBranch(branch)
      ? initialVideoQualityFor(onlineProfile.connection)
      : "medium";

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
    };

    if (!liveKitConfigured()) {
      // No credentials yet — the page renders the Jitsi fallback instead. It
      // still gets the room name so both providers put the same cohort in the
      // same room, which matters during a switchover.
      return NextResponse.json({ ...context, provider: "jitsi", token: null, url: null });
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
      // Only a tutor can mute others, remove a participant, or end the class.
      roomAdmin: role === "tutor",
    });

    /**
     * The tutor arriving is what starts the recording.
     *
     * Not a button, because the one class a tutor forgets to record is the one
     * a student needed. Not a student arriving either — students turn up early
     * to an empty room, and we would capture ten minutes of nobody.
     *
     * Deliberately not awaited: a slow or failing egress service must not delay
     * the tutor's own token by so much as a round trip. `ensureRecordingStarted`
     * swallows its errors and is idempotent, so a reload does not start a
     * second capture.
     *
     * Private one-to-one classes are excluded. Recording a cohort lesson is a
     * service to the cohort; silently recording a private conversation is a
     * consent question the school should answer explicitly, not something to
     * switch on by default.
     */
    if (role === "tutor" && !privateClassId) {
      void ensureRecordingStarted({
        roomName,
        branchId: branch?.id ?? null,
        branchName: branch?.name ?? null,
        level,
        sessionSlot,
        startedByUserId: session.user.id,
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
