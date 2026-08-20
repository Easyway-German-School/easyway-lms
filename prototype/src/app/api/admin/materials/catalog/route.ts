import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/admin-roles";
import { prisma } from "@/lib/prisma";
import { isEmbeddedVideo, parseEmbed } from "@/lib/media-embed";
import { isPlayableVideo, toPlayableUrl } from "@/lib/video-library";

export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await requireCapability("materials");
  if (!gate.ok) return gate.response;

  try {
    const rows = await prisma.material.findMany({
      where: { kind: { in: ["video", "recording"] } },
      orderBy: [{ recordedAt: "desc" }, { createdAt: "desc" }],
      take: 2000,
      select: {
        id: true,
        title: true,
        description: true,
        filePath: true,
        fileType: true,
        fileSize: true,
        kind: true,
        level: true,
        series: true,
        episodeNumber: true,
        durationSeconds: true,
        recordedAt: true,
        createdAt: true,
        course: { select: { title: true, level: true } },
        lecturer: { select: { user: { select: { name: true } } } },
        recording: { select: { status: true, variant: true, roomName: true, keepForever: true } },
        privateClasses: { select: { id: true }, take: 1 },
        classSessions: { select: { branch: { select: { name: true } } }, take: 1 },
      },
    });

    const videos = rows.filter((row) => isPlayableVideo(row.fileType)).map((row) => {
      const embed = isEmbeddedVideo(row.fileType) ? parseEmbed(row.filePath) : null;
      const privateClass = row.privateClasses.length > 0;
      const recording = row.kind === "recording" || Boolean(row.recording);
      const category = privateClass ? "private" : recording ? "recording" : embed ? "external" : "course";

      return {
        id: row.id,
        title: row.title,
        description: row.description,
        url: embed?.embedUrl ?? toPlayableUrl(row.filePath),
        sourceUrl: embed?.sourceUrl ?? null,
        provider: embed?.label ?? (recording ? "LiveKit" : "EasyWay storage"),
        category,
        categoryLabel: privateClass ? "Private class" : recording ? "Live recording" : embed ? "External embed" : "Course library",
        audience: recording ? "Online class recording" : privateClass ? "Private student" : "Course library (delivery not tagged)",
        kind: row.kind,
        level: row.level ?? row.course?.level ?? null,
        courseTitle: row.course?.title ?? null,
        branch: row.classSessions[0]?.branch?.name ?? null,
        lecturer: row.lecturer?.user?.name ?? null,
        series: row.series,
        episodeNumber: row.episodeNumber,
        durationSeconds: row.durationSeconds,
        fileSize: row.fileSize,
        recordingStatus: row.recording?.status ?? null,
        recordingVariant: row.recording?.variant ?? null,
        keepForever: row.recording?.keepForever ?? false,
        recordedAt: row.recordedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      };
    });

    return NextResponse.json({ videos, totals: {
      all: videos.length,
      recording: videos.filter((video) => video.category === "recording").length,
      private: videos.filter((video) => video.category === "private").length,
      external: videos.filter((video) => video.category === "external").length,
      course: videos.filter((video) => video.category === "course").length,
    } });
  } catch (error) {
    console.error("Admin video catalog failed", error);
    return NextResponse.json({ error: "Could not load the video catalog" }, { status: 500 });
  }
}