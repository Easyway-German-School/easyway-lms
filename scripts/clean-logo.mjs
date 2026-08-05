/**
 * Cleans the leftover background out of the logo artwork.
 *
 * The source lockup was supplied on a solid black background. Whoever keyed it
 * out flood-filled from the outside, so every *enclosed* region kept its black:
 * the counters of a, e, g, o, y, S in "Easyway German Language School", plus a
 * few specks in the tassel of the emblem. On a white page those read as ink
 * blots; on a dark page they read as holes.
 *
 * Two regions, two rules, because the artwork is two different things:
 *
 *   x >= WORDMARK_X   The type. Every opaque pixel here measured as an exact
 *                     blend of black and the brand orange, so the black is
 *                     un-multiplied back out: coverage t = red / orange.red,
 *                     the pixel becomes full-strength orange, and the alpha
 *                     carries t. Counters go fully transparent and the
 *                     anti-aliased rims stay smooth instead of leaving a
 *                     grey halo.
 *
 *   x <  WORDMARK_X   The emblem. Full of legitimately dark paint (the teal
 *                     banner, the deep-blue ocean), so colour alone cannot say
 *                     what is background — the pocket between the tassel cord
 *                     and the cap is within a few points of the deep ocean
 *                     blue. Instead the darkness is flood-filled inwards from
 *                     the transparent surround. The emblem is a sticker with an
 *                     unbroken white outline, so nothing that belongs to the
 *                     artwork can be reached that way; only the leaked-in
 *                     pockets can.
 *
 * Idempotent: a second run finds nothing left to do.
 *
 *   node scripts/clean-logo.mjs
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(HERE, "..", "public");

/** The brand orange the type is set in, measured off the artwork. */
const ORANGE = { r: 235, g: 85, b: 15 };

/** Left edge of the type, in px, on the 1200px-wide lockup. */
const WORDMARK_X = 375;

/**
 * Emblem flood: fully clear anything at or below DARK_CORE, feather up to
 * DARK_EDGE so the pocket rim does not end in a hard dark line.
 */
const DARK_CORE = 90;
const DARK_EDGE = 150;

/** A pixel this transparent counts as outside, and seeds the flood. */
const OUTSIDE_ALPHA = 32;

/**
 * The flood also starts from any near-black pixel, because the two pockets by
 * the tassel are sealed off from the outside by the cord and never would be
 * reached otherwise. Nothing in the artwork is painted this black, and the
 * requirement that it also be neutral keeps the deep ocean blue out.
 */
const BLACK_SEED = 60;
const SEED_NEUTRAL_TOLERANCE = 30;

function cleanWordmark(data, width, height, wordmarkX) {
  let cleared = 0;
  for (let y = 0; y < height; y++) {
    for (let x = wordmarkX; x < width; x++) {
      const i = (y * width + x) * 4;
      const alpha = data[i + 3];
      if (alpha === 0) continue;

      const coverage = Math.min(1, data[i] / ORANGE.r);
      if (coverage > 0.995) continue;

      data[i] = ORANGE.r;
      data[i + 1] = ORANGE.g;
      data[i + 2] = ORANGE.b;
      data[i + 3] = Math.round(alpha * coverage);
      cleared++;
    }
  }
  return cleared;
}

function cleanEmblem(data, width, height, limitX) {
  const seen = new Uint8Array(width * height);
  const queue = [];

  let cleared = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < limitX; x++) {
      const p = y * width + x;
      const i = p * 4;

      if (data[i + 3] < OUTSIDE_ALPHA) {
        seen[p] = 1;
        queue.push(p);
        continue;
      }

      const brightest = Math.max(data[i], data[i + 1], data[i + 2]);
      const darkest = Math.min(data[i], data[i + 1], data[i + 2]);
      if (brightest < BLACK_SEED && brightest - darkest <= SEED_NEUTRAL_TOLERANCE) {
        seen[p] = 1;
        queue.push(p);
        data[i + 3] = 0;
        cleared++;
      }
    }
  }

  while (queue.length) {
    const p = queue.pop();
    const x = p % width;
    const y = (p - x) / width;

    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= limitX || ny >= height) continue;

      const q = ny * width + nx;
      if (seen[q]) continue;

      const i = q * 4;
      const brightest = Math.max(data[i], data[i + 1], data[i + 2]);
      if (brightest >= DARK_EDGE) continue;

      seen[q] = 1;
      queue.push(q);

      // A ceiling rather than a multiplier, so a re-run is a no-op instead of
      // eroding the feather a little further every time.
      const keep = Math.max(0, (brightest - DARK_CORE) / (DARK_EDGE - DARK_CORE));
      const faded = Math.min(data[i + 3], Math.round(255 * keep));
      if (faded === data[i + 3]) continue;
      data[i + 3] = faded;
      cleared++;
    }
  }
  return cleared;
}

async function clean(file, { wordmarkX }) {
  const src = path.join(PUBLIC_DIR, file);
  const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;

  const emblemWidth = wordmarkX === null ? width : wordmarkX;
  const cleared = cleanEmblem(data, width, height, emblemWidth)
    + (wordmarkX === null ? 0 : cleanWordmark(data, width, height, wordmarkX));

  await sharp(data, { raw: { width, height, channels: 4 } }).png({ compressionLevel: 9 }).toFile(src);
  console.log(`${file}: ${cleared} px cleaned (${width}x${height})`);
}

await clean("logo.png", { wordmarkX: WORDMARK_X });
// The emblem-only files have no type on them, so they get the emblem rule alone.
for (const file of ["logo-mark.png", "icon-512.png", "icon-192.png", "apple-icon.png", "favicon-32.png"]) {
  await clean(file, { wordmarkX: null });
}
