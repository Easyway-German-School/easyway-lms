import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readAssignment } from "@/lib/lecturer-assignment";
import { lecturerCan } from "@/lib/lecturer-features";
import { isPlayableVideo, toPlayableUrl, type LibraryVideo, type VideoKind } from "@/lib/video-library";
import { isEmbeddedVideo, needsIframe, parseEmbed } from "@/lib/media-embed";
import { reconcileRecordingsSoon } from "@/lib/class-recorder";

export const dynamic = "force-dynamic";

/**
 * Every recording and lesson video the tutor may watch back.
 *
 * The students have had the shelf-style library since it was built. The tutors
 * who taught those very classes had no way to open one — a tutor who wanted to
 * check what they had covered, or review a session they had missed, had
 * nothing. Auto-recording writes a Material row per class (see
 * src/lib/class-recorder.ts) and until now only students could read them.
 *
 * SCOPED TO WHAT THEY TEACH, NOT TO WHAT THEY UPLOADED. The obvious filter —
 * `lecturerId: theirs` — is wrong twice over: a class recording is written by
 * the recorder rather than by the tutor, so many carry no lecturer at all, and
 * a tutor covering B1 this term genuinely needs last term's B1 recordings that
 * somebody else took. The assignment is the right unit, and it is the same one
 * their roster, register and gradebook already use.
 *
 * Returned flat, like the student route, because shelving is a presentation
 * decision made client-side by `buildShelves`.
 */
export async function GET() {
  try {
    const session = await requireAuthSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const lecturer = await prisma.lecturer.findUnique({
      where: { userId: session.user.id },
      select: {
        id: true,
        features: true,
        branchId: true,
        level: true,
        sessionSlot: true,
        branchIds: true,
        levels: true,
        sessionSlots: true,
        classTypes: true,
        batches: true,
      },
    });

    if (!lecturer) {
      return NextResponse.json({ error: "No tutor profile found for this account" }, { status: 404 });
    }

    /**
     * The tutor checking their own Recordings page is exactly the same "is my
     * tape back yet" moment as a student opening the Watch shelf — but only the
     * student route ever nudged `reconcileRecordings()`. A tutor was left
     * relying entirely on the LiveKit webhook (fast, but not guaranteed) and a
     * cron that runs once a day (see vercel.json) — the worst possible night to
     * miss the fast path is the one where the tutor is refreshing this page
     * waiting to confirm it worked. Same fire-and-forget, same throttle.
     */
    reconcileRecordingsSoon();

    // The sidebar hides this; the route is what refuses it.
    if (!lecturerCan(lecturer.features, "recordings")) {
      return NextResponse.json(
        {
          error: "Not your area",
          message: "The school has not given you the recording library.",
        },
        { status: 403 },
      );
    }

    const assignment = readAssignment(lecturer);
    const levels = assignment.levels;

    /**
     * An unassigned tutor gets an empty shelf and a reason, not every video in
     * the school. Falling back to "no filter" would hand a brand-new tutor the
     * entire recorded history of every branch on their first sign-in.
     */
    if (levels.length === 0) {
      return NextResponse.json({
        videos: [],
        levels: [],
        unassigned: true,
        message: "The office has not assigned you a level yet, so there are no recordings to show.",
      });
    }

    const records = await prisma.material.findMany({
      where: {
        kind: { in: ["video", "recording"] },
        OR: [{ level: { in: levels } }, { course: { level: { in: levels } } }],
      },
      include: {
        course: { select: { title: true, level: true } },
        lecturer: { select: { id: true, user: { select: { name: true } } } },
      },
      orderBy: [{ recordedAt: "desc" }, { createdAt: "desc" }],
    });

    const videos: Array<LibraryVideo & { mine: boolean }> = records
      // Belt and braces: a row mis-tagged as a video the browser cannot play
      // would render an unplayable tile, which reads as a broken app.
      .filter((record) => isPlayableVideo(record.fileType))
      .map((record) => {
        // See lib/media-embed.ts — a tutor's linked video shows the same way
        // here as it does on the student shelf.
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
          /**
           * Watch position is a STUDENT concept and is deliberately not faked
           * here. `VideoProgress` hangs off a Student row, a tutor has none, and
           * inventing a zero would put a "Continue watching" shelf on this page
           * that never fills in however many times they watch something.
           */
          positionSeconds: 0,
          completed: false,
          embedUrl: iframed?.embedUrl ?? null,
          embedLabel: embed?.label ?? null,
          // The query above only ever matches level-tagged material; a
          // private recording carries no level and never appears here.
          isPrivate: false,
          /** Whether this tutor is the one who taught it — used to badge the tile. */
          mine: record.lecturer?.id === lecturer.id,
        };
      });

    return NextResponse.json({
      videos,
      levels,
      unassigned: false,
      mineCount: videos.filter((video) => video.mine).length,
    });
  } catch (error) {
    console.error("Failed to load the tutor video library", error);
    return NextResponse.json({ error: "Failed to load the video library" }, { status: 500 });
  }
}
