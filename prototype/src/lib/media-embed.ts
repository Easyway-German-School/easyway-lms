/**
 * Videos the school does not host.
 *
 * Tutors already teach from YouTube — a Deutsch-lernen channel, a clip of a
 * Bahnhof announcement, their own unlisted upload. Before this, the only way to
 * get one into the student library was to download it and re-upload 300 MB
 * through a Nigerian connection, so in practice it was pasted into WhatsApp and
 * the library never saw it.
 *
 * A link is stored as an ordinary Material row: `filePath` holds the URL the
 * tutor pasted and `fileType` is `video/embed`, which means the existing
 * `isPlayableVideo` check (it tests the `video/` prefix) already lets these
 * through every shelf and query without a single one of them being taught about
 * links. Only the player has to know the difference, because an <iframe> is not
 * a <video>.
 *
 * No prisma import: the tutor's upload form validates a pasted URL in the
 * browser with the same function the API trusts on the way in.
 */

/** What `Material.fileType` carries for a linked video. */
export const EMBED_FILE_TYPE = "video/embed";

export function isEmbeddedVideo(fileType?: string | null): boolean {
  return String(fileType ?? "").toLowerCase() === EMBED_FILE_TYPE;
}

export type EmbedProvider = "youtube" | "vimeo" | "drive" | "loom" | "direct";

export type ParsedEmbed = {
  provider: EmbedProvider;
  /** The URL to put in an iframe `src` (or a <video> src, when `direct`). */
  embedUrl: string;
  /** The link as pasted, kept so "open on YouTube" can still go to the real page. */
  sourceUrl: string;
  /** Provider-derived poster image, when one can be known without an API key. */
  thumbnailUrl: string | null;
  /** For the tutor's form: what we recognised it as, in words. */
  label: string;
};

/**
 * The eleven-character id in any of YouTube's URL shapes.
 *
 * Deliberately not one mega-regex. YouTube has accumulated watch?v=, youtu.be,
 * /embed/, /shorts/ and /live/, and a single pattern trying to cover all of
 * them is the kind of thing that silently matches the wrong capture group.
 */
function youtubeId(url: URL): string | null {
  const host = url.hostname.replace(/^www\./, "");

  if (host === "youtu.be") {
    const id = url.pathname.slice(1).split("/")[0];
    return id.length === 11 ? id : null;
  }

  if (host !== "youtube.com" && host !== "m.youtube.com" && host !== "music.youtube.com") return null;

  const v = url.searchParams.get("v");
  if (v && v.length === 11) return v;

  const match = url.pathname.match(/^\/(?:embed|shorts|live|v)\/([A-Za-z0-9_-]{11})/);
  return match ? match[1] : null;
}

function vimeoId(url: URL): string | null {
  if (!url.hostname.replace(/^www\./, "").endsWith("vimeo.com")) return null;
  const match = url.pathname.match(/\/(\d{6,})/);
  return match ? match[1] : null;
}

function driveId(url: URL): string | null {
  if (url.hostname.replace(/^www\./, "") !== "drive.google.com") return null;
  const path = url.pathname.match(/\/file\/d\/([A-Za-z0-9_-]+)/);
  if (path) return path[1];
  const id = url.searchParams.get("id");
  return id || null;
}

function loomId(url: URL): string | null {
  if (!url.hostname.replace(/^www\./, "").endsWith("loom.com")) return null;
  const match = url.pathname.match(/\/(?:share|embed)\/([A-Za-z0-9]+)/);
  return match ? match[1] : null;
}

/**
 * Turn a pasted link into something playable, or null if it is not a video
 * link at all.
 *
 * Returning null rather than throwing because the caller on both sides wants
 * the same thing from a bad link: tell the tutor, do not save it.
 */
export function parseEmbed(rawUrl: string): ParsedEmbed | null {
  const trimmed = String(rawUrl ?? "").trim();
  if (!trimmed) return null;

  let url: URL;
  try {
    // A tutor pastes "youtube.com/watch?v=…" as often as the full thing.
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }

  // http:// embeds are refused by every browser on an https page (mixed
  // content), so the iframe would be blank with only a console warning to
  // explain it. Upgrading is safe: every provider below serves https.
  if (url.protocol === "http:") url.protocol = "https:";

  const sourceUrl = url.toString();

  const yt = youtubeId(url);
  if (yt) {
    return {
      provider: "youtube",
      // `rel=0` keeps the end screen on this channel; `modestbranding` drops
      // the watermark. Neither stops a student wandering off, but the class
      // video should not end on a wall of unrelated recommendations.
      embedUrl: `https://www.youtube-nocookie.com/embed/${yt}?rel=0&modestbranding=1`,
      sourceUrl,
      thumbnailUrl: `https://img.youtube.com/vi/${yt}/hqdefault.jpg`,
      label: "YouTube",
    };
  }

  const vimeo = vimeoId(url);
  if (vimeo) {
    return {
      provider: "vimeo",
      embedUrl: `https://player.vimeo.com/video/${vimeo}`,
      sourceUrl,
      thumbnailUrl: null,
      label: "Vimeo",
    };
  }

  const drive = driveId(url);
  if (drive) {
    return {
      provider: "drive",
      embedUrl: `https://drive.google.com/file/d/${drive}/preview`,
      sourceUrl,
      thumbnailUrl: null,
      label: "Google Drive",
    };
  }

  const loom = loomId(url);
  if (loom) {
    return {
      provider: "loom",
      embedUrl: `https://www.loom.com/embed/${loom}`,
      sourceUrl,
      thumbnailUrl: null,
      label: "Loom",
    };
  }

  /**
   * A bare file on someone else's server — a school Dropbox, a ministry site.
   * This one plays in a real <video>, so it keeps the scrubbing, the speed
   * control and the resume position that an iframe cannot give us.
   */
  if (/\.(mp4|webm|ogg|ogv|m4v|mov)(\?|$)/i.test(url.pathname)) {
    return {
      provider: "direct",
      embedUrl: sourceUrl,
      sourceUrl,
      thumbnailUrl: null,
      label: "Direct video file",
    };
  }

  return null;
}

/**
 * Whether the player must use an iframe.
 *
 * `direct` is the exception: it is a real video file living elsewhere, so it
 * goes in a <video> element and keeps progress tracking.
 */
export function needsIframe(provider: EmbedProvider): boolean {
  return provider !== "direct";
}
