"use client";

import { useEffect, useRef, useState } from "react";
import type { LibraryVideo } from "@/lib/video-library";

/**
 * A poster frame for a video that has no uploaded thumbnail.
 *
 * There is no thumbnailing pipeline here, and adding ffmpeg to the server for
 * one image would be a lot of moving parts. Instead the browser is asked for
 * the frame at three seconds via a media fragment (`#t=3`) with
 * `preload="metadata"` — it fetches the header and one frame, not the file. A
 * real uploaded thumbnail always wins when there is one.
 */
export default function VideoThumb({
  video,
  className = "",
  previewOnHover = false,
}: {
  video: LibraryVideo;
  className?: string;
  previewOnHover?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;
    if (previewing) {
      element.currentTime = Math.max(3, (video.positionSeconds || 0));
      void element.play().catch(() => {
        // Autoplay refused (or the file is still loading) — the still frame is
        // a perfectly good fallback, so this is not worth surfacing.
      });
    } else {
      element.pause();
    }
  }, [previewing, video.positionSeconds]);

  if (video.thumbnailUrl && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={video.thumbnailUrl}
        alt=""
        onError={() => setFailed(true)}
        className={`h-full w-full object-cover ${className}`}
      />
    );
  }

  return (
    <video
      ref={videoRef}
      src={`${video.fileUrl}#t=3`}
      preload="metadata"
      muted
      playsInline
      onMouseEnter={previewOnHover ? () => setPreviewing(true) : undefined}
      onMouseLeave={previewOnHover ? () => setPreviewing(false) : undefined}
      className={`h-full w-full object-cover ${className}`}
    />
  );
}
