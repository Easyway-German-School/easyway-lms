/**
 * Strips the display plinth off the newer Becca pose renders.
 *
 * Unlike the original studio JPEG (see `clean-mascot.mjs`), these renders
 * arrived already background-removed — real alpha, clean edges, her hair and
 * the soft rim-glow around her both intact. What survived that removal is the
 * one thing touching her that isn't background: the white-and-charcoal
 * display base under her feet. It was never reachable by whatever removed
 * the rest, because it's connected to her — her sole sits directly on it.
 *
 * A ROW CUTOFF (find her lowest pink pixel, discard everything below) is NOT
 * enough here, and the first version of this script that tried it left the
 * plinth's far rim behind: the base is an ellipse viewed at an angle, so its
 * back edge sits HIGHER on screen than the point directly under her own
 * standing foot. Clearing strictly below her sole misses that.
 *
 * What actually distinguishes the plinth from her is COLOUR, not position:
 * its cream top and charcoal rim are both low-saturation, while everything
 * of hers down there — hot pink shoes, warm brown ankles — is not.
 *
 * The first version of this pass ported `clean-mascot.mjs`'s flood-from-the-
 * border approach unchanged, and it left a triangle of the plinth's top
 * surface behind, visible between her ankles in a standing pose. That flood
 * needed connectivity to an edge or an already-transparent pixel because
 * clean-mascot.mjs was separating "outside the studio backdrop" from
 * "enclosed pocket of it" using two different rules. There is only one rule
 * here — colourless-or-not — so connectivity was never actually doing
 * anything except failing to reach a patch her own legs sealed off on every
 * side. Every pixel in the strip is tested on its own colour, full stop.
 *
 *   node scripts/clean-mascot-poses.mjs
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MASCOT_DIR = path.join(HERE, "..", "public", "mascot");

const JOBS = [
  { source: "C:/Users/HP/Downloads/b860bd23-2778-420a-ab3b-c37aaa548253.png", out: "becca-celebrating.png" },
  { source: "C:/Users/HP/Downloads/5a70781a-1e18-4b98-acc0-207bfa0c66bd.png", out: "becca-thinking.png" },
  { source: "C:/Users/HP/Downloads/90d179de-a238-4452-bbaf-7a93e2109482.png", out: "becca-pointing-right.png" },
  { source: "C:/Users/HP/Downloads/434e5975-e025-4840-91e3-adf07b978955.png", out: "becca-pointing-left.png" },
];

/**
 * The plinth runs from roughly 86% down to the bottom edge in these renders
 * (measured). 25% gives real margin above that without reaching high enough
 * to risk her dress or dark hair, which is what SAT_MAX is really guarding.
 */
const BASE_STRIP = 0.25;

/**
 * Measured: the plinth's cream top and charcoal rim both sit under 25
 * (readings of 4-24 across the strip). Her pink shoes read 178-233; her
 * skin, even in shadow, reads well above this. 30 leaves margin either way.
 */
const SAT_MAX = 30;

/**
 * Isolated fleck cleanup — a handful of stray pixels (a shadow catch-light,
 * a rendering fleck) that sit fully surrounded by transparency, disconnected
 * from her. The saturation pass above only looks at the bottom strip and
 * only at colour, so it neither reaches nor would necessarily catch one of
 * these; this instead looks at the WHOLE image and cares only about size —
 * anything opaque smaller than this many pixels, wherever it is, cannot be
 * a piece of a character rendered at 500-1500px and gets dropped.
 */
const MIN_ISLAND = 40;

for (const { source, out } of JOBS) {
  const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const stripTop = Math.floor(height * (1 - BASE_STRIP));

  let cleared = 0;
  for (let y = stripTop; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i + 3] === 0) continue;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (Math.max(r, g, b) - Math.min(r, g, b) > SAT_MAX) continue; // Hers.
      data[i + 3] = 0;
      cleared++;
    }
  }

  // --- Drop isolated flecks anywhere in the frame ---------------------
  {
    const seen = new Uint8Array(width * height);
    for (let start = 0; start < width * height; start++) {
      if (seen[start]) continue;
      const i0 = start * 4;
      if (data[i0 + 3] < 8) { seen[start] = 1; continue; }
      const region = [start];
      seen[start] = 1;
      let head = 0;
      while (head < region.length) {
        const p = region[head++];
        const x = p % width;
        const y = (p - x) / width;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const q = ny * width + nx;
          if (seen[q]) continue;
          seen[q] = 1;
          if (data[q * 4 + 3] < 8) continue;
          region.push(q);
        }
      }
      if (region.length < MIN_ISLAND) {
        for (const p of region) data[p * 4 + 3] = 0;
      }
    }
  }

  let top = height, bottom = 0, left = width, right = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] < 8) continue;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
      if (x < left) left = x;
      if (x > right) right = x;
    }
  }

  const cropped = {
    left: Math.max(0, left - 2),
    top: Math.max(0, top - 2),
    width: Math.min(width, right + 3) - Math.max(0, left - 2),
    height: Math.min(height, bottom + 3) - Math.max(0, top - 2),
  };

  const dest = path.join(MASCOT_DIR, out);
  await sharp(data, { raw: { width, height, channels: 4 } })
    .extract(cropped)
    .png({ compressionLevel: 9 })
    .toFile(dest);

  console.log(`${out}: ${cropped.width}x${cropped.height} (${cleared} plinth px cleared)`);
}
