import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { deriveStudentAccess } from "@/lib/access";
import { requiredDepositFor, tuitionFeeFor, isReceivedPayment } from "@/lib/payment";
import { isPlayableVideo, toPlayableUrl, type LibraryVideo, type VideoKind } from "@/lib/video-library";
import { isEmbeddedVideo, needsIframe, parseEmbed } from "@/lib/media-embed";
import { reconcileRecordingsSoon } from "@/lib/class-recorder";
import { canDownloadOffline } from "@/lib/delivery";

export const dynamic = "force-dynamic";

/**
 * Every video this student may watch, with their own position in each.
 *
 * Returned flat rather than pre-shelved: the shelves are a presentation
 * decision (see `buildShelves`), and keeping them client-side means a filter
 * or a search re-shelves instantly instead of costing a round trip on a
 * connection that may not have one to spare.
 */
export async function GET() {
  try {
    const session = await requireAuthSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const student = await prisma.student.findUnique({
      where: { userId: session.user.id },
      include: { payments: true, branch: { select: { name: true } } },
    });

    if (!student) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    /**
     * Opening the shelf is the cue to go and collect anything still in the post.
     *
     * Fire-and-forget and throttled — see `reconcileRecordingsSoon`. The class
     * this student just left finishes encoding a few minutes after the room
     * empties, and this is the exact moment they come looking for it. Awaiting
     * it would make every student pay LiveKit's latency for one student's
     * missing tape, so we do not: the worst case is that it lands on the next
     * refresh instead of this one.
     */
    reconcileRecordingsSoon();

    const feeLookup = { level: student.level, branch: student.branch?.name ?? null, classType: student.classType };
    const totalPaid = student.payments
      .filter((payment) => isReceivedPayment(payment.status))
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
      const message =
        access.lockReason === "unsettled_balance"
          ? `Settle your tuition balance of ₦${access.outstandingBalance.toLocaleString()} to restore the video library.`
          : `Pay your deposit of ₦${access.requiredDeposit.toLocaleString()} to unlock the video library.`;
      return NextResponse.json(
        {
          videos: [],
          locked: true,
          message,
        },
        { status: 403 },
      );
    }

    // A video belongs to this student if it is tagged with their level, or it
    // hangs off a course at their level, or — a private recording, which
    // deliberately carries NO level (see class-recorder.ts) — it was booked
    // for them specifically via the `privateClasses` relation.
    const now = new Date();
    const records = await prisma.material.findMany({
      where: {
        kind: { in: ["video", "recording"] },
        OR: [
          { level: student.level },
          { course: { level: student.level } },
          { privateClasses: { some: { studentId: student.id } } },
        ],
        // The 2-week student window: once a recording's `studentExpiresAt` has
        // passed it drops off the shelf for students (staff keep it forever —
        // see src/lib/retention.ts). `keepForever` pins it here too. A lesson
        // video or document has no `recording` relation, so `NOT { recording:
        // { is: … } }` leaves it untouched.
        NOT: { recording: { is: { keepForever: false, studentExpiresAt: { lte: now } } } },
      },
      include: {
        course: { select: { title: true, level: true } },
        lecturer: { select: { user: { select: { name: true } } } },
        recording: { select: { privateClassId: true, studentExpiresAt: true, keepForever: true } },
      },
      orderBy: [{ recordedAt: "desc" }, { createdAt: "desc" }],
    });

    const progressRows = await prisma.videoProgress.findMany({
      where: { studentId: student.id, materialId: { in: records.map((record) => record.id) } },
    });
    const progressByMaterial = new Map(progressRows.map((row) => [row.materialId, row]));

    const videos: LibraryVideo[] = records
      // Belt and braces: a row mis-tagged as a video that the browser cannot
      // play would render an unplayable tile, which looks like a broken app.
      .filter((record) => isPlayableVideo(record.fileType))
      .map((record) => {
        const progress = progressByMaterial.get(record.id);
        // A linked video carries its URL in filePath; the player needs the
        // provider embed form instead, which is a different string.
        const embed = isEmbeddedVideo(record.fileType) ? parseEmbed(record.filePath) : null;
        const iframed = embed && needsIframe(embed.provider) ? embed : null;
        return {
          id: record.id,
          title: record.title,
          description: record.description,
          fileUrl: toPlayableUrl(record.filePath),
          thumbnailUrl: record.thumbnailPath ? toPlayableUrl(record.thumbnailPath) : null,
          durationSeconds: record.durationSeconds,
          kind: record.kind as VideoKind,
          level: record.level ?? record.course?.level ?? null,
          series: record.series,
          episodeNumber: record.episodeNumber,
          courseTitle: record.course?.title ?? null,
          lecturerName: record.lecturer?.user?.name ?? null,
          recordedAt: record.recordedAt?.toISOString() ?? null,
          createdAt: record.createdAt.toISOString(),
          positionSeconds: progress?.positionSeconds ?? 0,
          completed: progress?.completed ?? false,
          embedUrl: iframed?.embedUrl ?? null,
          embedLabel: embed?.label ?? null,
          isPrivate: Boolean(record.recording?.privateClassId),
          // Only a non-keep-forever recording actually expires for students.
          expiresAt:
            record.recording && !record.recording.keepForever
              ? record.recording.studentExpiresAt?.toISOString() ?? null
              : null,
        };
      });

    return NextResponse.json({
      videos,
      locked: false,
      level: student.level,
      // Whether this student is offered "save for offline" inside the app —
      // online, hybrid and private students are; physical group students get
      // the notes-offline upsell instead.
      canDownloadOffline: canDownloadOffline(student),
    });
  } catch (error) {
    console.error("Failed to load the video library", error);
    return NextResponse.json({ error: "Failed to load the video library" }, { status: 500 });
  }
}
