/**
 * A poster image for a class recording.
 *
 * WHY A DRAWN CARD AND NOT A FRAME FROM THE VIDEO. Pulling a real frame needs
 * ffmpeg on the server, and the frame you get is a room of people mid-blink or,
 * three seconds in, an empty chair. A branded card is both cheaper and a better
 * tile: it says the level, the title and the date, which is what someone
 * scanning the library is actually looking for.
 *
 * WHAT THIS REPLACES. Without a stored poster, VideoThumb falls back to asking
 * the browser for the frame at `#t=3` with `preload="metadata"` — so every tile
 * in the Watch grid opens a range request against an MP4 just to draw itself.
 * That is a lot of mobile data for a thumbnail. A real poster always wins, and
 * this is what makes one exist.
 *
 * The key sits next to the recording (`…-thumb.jpg`), which puts it under
 * RECORDING_PREFIX and therefore in the recordings bucket — see storageForKey.
 * `putFile` routes on the key for exactly this reason; it used to call
 * objectStorage() directly, which sent posters to the general bucket and then
 * handed back a URL built from the wrong public base.
 *
 * sharp is only ever asked to rasterise SVG here — no decoding of anything a
 * user uploaded. It is a real dependency of this file rather than one borrowed
 * from Next's own tree, so it is declared in package.json.
 */

import sharp from "sharp";
import { putFile } from "@/lib/storage";

export function buildRecordingThumbnailKey(objectKey: string): string {
  return objectKey.replace(/\.[^/.]+$/, "") + "-thumb.jpg";
}

/**
 * The title and level land inside an SVG document, so a stray `&` or `<` in a
 * class name would produce a file sharp refuses to parse — and the caller would
 * see a recording with no poster and no obvious reason why.
 */
function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;",
  })[character]!);
}

function shorten(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
}

/**
 * How wide the title may be, and the type size that gets it there.
 *
 * The title starts at x=72 and the play badge occupies from x=998 (1090 - 92),
 * so there are 878px to work with. A fixed 66px was overflowing the canvas
 * outright: Arial Bold averages ~0.55em per character, which makes 66px good
 * for roughly 24 characters, and the old cap allowed 42. Titles here are built
 * by recordingTitle() from a level, a session slot and a date, so 24 is not
 * enough — "A1 Morning — Tue 21 Aug 2026" is already 28.
 *
 * So the size adapts to the length instead of the length being clipped to the
 * size, with a 34px floor. Below the floor we do fall back to truncating, since
 * type that small stops reading as a title at thumbnail scale.
 *
 * This is an estimate, not text metrics — sharp will not measure a glyph for us
 * without rendering it. It is deliberately conservative: erring narrow leaves a
 * little empty space, erring wide reintroduces the bug this replaces.
 */
const TITLE_WIDTH = 878;
const TITLE_MAX_SIZE = 66;
const TITLE_MIN_SIZE = 34;
const AVG_GLYPH_RATIO = 0.55;

function fitTitle(value: string): { text: string; fontSize: number } {
  const widest = Math.floor(TITLE_WIDTH / (TITLE_MIN_SIZE * AVG_GLYPH_RATIO));
  const text = shorten(value.trim(), widest);
  const ideal = TITLE_WIDTH / (Math.max(text.length, 1) * AVG_GLYPH_RATIO);
  return { text, fontSize: Math.round(Math.min(TITLE_MAX_SIZE, Math.max(TITLE_MIN_SIZE, ideal))) };
}

export async function createRecordingThumbnail(input: {
  objectKey: string;
  title: string;
  level?: string | null;
  recordedAt: Date;
}): Promise<string> {
  const title = fitTitle(input.title);
  const level = shorten((input.level || "CLASS").toUpperCase(), 10);
  const date = input.recordedAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const svg = `
    <svg width="1280" height="720" viewBox="0 0 1280 720" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="background" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#102a43"/>
          <stop offset="0.58" stop-color="#176b87"/>
          <stop offset="1" stop-color="#f28c28"/>
        </linearGradient>
        <linearGradient id="glow" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#ffffff" stop-opacity="0.18"/>
          <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <rect width="1280" height="720" fill="url(#background)"/>
      <circle cx="1080" cy="80" r="280" fill="#ffffff" opacity="0.08"/>
      <circle cx="1170" cy="650" r="220" fill="#102a43" opacity="0.18"/>
      <path d="M0 530 C260 420 430 650 720 510 S1050 390 1280 470 L1280 720 L0 720Z" fill="#102a43" opacity="0.26"/>
      <rect x="72" y="76" width="390" height="78" rx="39" fill="#ffffff" opacity="0.13"/>
      <text x="112" y="126" fill="#ffffff" font-family="Arial, sans-serif" font-size="34" font-weight="700" letter-spacing="4">EASYWAY LMS</text>
      <rect x="72" y="254" width="150" height="10" rx="5" fill="#f8c15c"/>
      <text x="72" y="340" fill="#ffffff" font-family="Arial, sans-serif" font-size="30" font-weight="700" letter-spacing="3">${escapeXml(level)} CLASS RECORDING</text>
      <text x="72" y="430" fill="#ffffff" font-family="Arial, sans-serif" font-size="${title.fontSize}" font-weight="700">${escapeXml(title.text)}</text>
      <rect x="72" y="500" width="520" height="2" fill="url(#glow)"/>
      <text x="72" y="560" fill="#e7f5f8" font-family="Arial, sans-serif" font-size="30">${escapeXml(date)}  •  REWATCH ANYTIME</text>
      <g transform="translate(1090 270)">
        <circle cx="0" cy="0" r="92" fill="#ffffff" opacity="0.16"/>
        <circle cx="0" cy="0" r="72" fill="#ffffff" opacity="0.9"/>
        <path d="M-18 -30 L35 0 L-18 30 Z" fill="#176b87"/>
      </g>
    </svg>`;
  const body = await sharp(Buffer.from(svg)).jpeg({ quality: 92, progressive: true, mozjpeg: true }).toBuffer();
  const key = buildRecordingThumbnailKey(input.objectKey);
  return putFile({ key, body, contentType: "image/jpeg" });
}