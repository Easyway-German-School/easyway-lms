import sharp from "sharp";
import { readFile, writeFile } from "node:fs/promises";

/**
 * Put the school's NAME on the emblem's blue banner, where the motto used to be.
 *
 *   node scripts/relabel-logo-banner.mjs
 *
 * WHY THE NAME AND NOT THE MOTTO. The emblem is what a student stares at while
 * a page loads on a slow connection, and it was the only place in the product
 * that did not say whose school this is. "...For Global Language Excellence"
 * is true of every language school on earth; the name is not.
 *
 * WHY THIS IS A SCRIPT AND NOT A ONE-OFF EDIT. The artwork gets re-exported —
 * it already has once, and the leftover black keying had to be undone by
 * scripts/clean-logo.mjs. Anything done to it by hand in an image editor is
 * something that has to be remembered and redone. This runs from the source
 * PNG every time and is idempotent: it repaints the banner interior before
 * writing, so running it twice does not stack two labels.
 *
 * ---------------------------------------------------------------------------
 * THE TWO THINGS THAT MAKE THIS FIDDLY
 *
 * 1. THE BANNER IS NOT A RECTANGLE. It is the base of an open book, with
 *    tapered ends and a soft outer stroke. So the repaint covers only the
 *    INTERIOR box measured below — wide enough to bury the old motto, narrow
 *    enough never to touch the shaped edges. The numbers come from probing the
 *    actual pixels, not from eyeballing the design.
 *
 * 2. TEXT WIDTH CANNOT BE GUESSED. Whatever font this machine resolves for
 *    "Arial Black" is not necessarily the one the next machine resolves, and a
 *    label that overflows the banner is worse than the motto it replaced. So
 *    the text is rendered once at a nominal size, its real ink is MEASURED, and
 *    it is re-rendered at the size that actually fits. Two passes, no guessing,
 *    same result on any machine.
 */

const SOURCE = "public/logo-mark.png";

/**
 * The safe interior of the banner, in source pixels.
 *
 * Measured by walking the raw buffer for the dark-teal fill: the band runs
 * x 9-501 and y 401-499 at its widest, and these numbers sit comfortably
 * inside that on every edge.
 */
const BAND = { x: 22, y: 407, width: 468, height: 86 };

/** The banner's own fill, sampled from the artwork rather than picked. */
const BANNER_FILL = { r: 1, g: 77, b: 99 };

const TEXT = "EASYWAY GERMAN LANGUAGE SCHOOL";

/** How much of the band the text may occupy. The rest is breathing room. */
const MAX_TEXT_WIDTH = BAND.width * 0.94;
const MAX_TEXT_HEIGHT = BAND.height * 0.62;

/**
 * Fonts to ask for, in order. librsvg falls through the list, so naming
 * several condensed-ish bold faces means a machine missing one still gets a
 * sensible shape rather than a default serif.
 */
const FONT_STACK = "'Arial Black','Arial Bold','Helvetica Bold',Arial,Helvetica,sans-serif";

function textSvg(fontSize, letterSpacing, width, height) {
  // Rendered on its own transparent canvas so the ink can be measured without
  // the emblem's own pixels confusing the bounding box.
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
       <text x="50%" y="50%"
             text-anchor="middle" dominant-baseline="central"
             font-family="${FONT_STACK}" font-weight="900"
             font-size="${fontSize}" letter-spacing="${letterSpacing}"
             fill="#ffffff">${TEXT}</text>
     </svg>`,
  );
}

/** The bounding box of everything non-transparent in a rendered buffer. */
async function inkExtents(buffer) {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let left = info.width;
  let right = -1;
  let top = info.height;
  let bottom = -1;

  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const alpha = data[(y * info.width + x) * info.channels + 3];
      if (alpha < 24) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }

  if (right < 0) return { width: 0, height: 0 };
  return { width: right - left + 1, height: bottom - top + 1 };
}

async function main() {
  const source = await readFile(SOURCE);
  const meta = await sharp(source).metadata();
  if (meta.width !== 512 || meta.height !== 512) {
    throw new Error(
      `Expected a 512x512 mark, got ${meta.width}x${meta.height}. The band coordinates were measured against 512 and would land in the wrong place.`,
    );
  }

  /**
   * Pass one: render at a nominal size purely to learn this machine's metrics.
   *
   * The probe canvas is enormous on purpose. Thirty characters of Arial Black
   * at 100px is over two thousand pixels wide, and a canvas that clips the text
   * makes `inkExtents` report the CANVAS width instead of the text width — a
   * measurement that is silently too small, which then scales the label up
   * until it overflows the banner. Measuring the thing you clipped is a
   * confident wrong answer, so give it room it cannot possibly need.
   */
  const PROBE = 100;
  const SPACING = 1.5;
  const probe = await sharp(textSvg(PROBE, SPACING, 12_000, 600)).png().toBuffer();
  const probed = await inkExtents(probe);
  if (probed.width === 0) {
    throw new Error("No text rendered — this machine has no usable font for the label.");
  }
  if (probed.width >= 12_000 - 4) {
    throw new Error("The probe canvas clipped the text — the measurement would be wrong.");
  }

  // Pass two: the largest size that fits both the width and the height budget.
  const byWidth = (MAX_TEXT_WIDTH / probed.width) * PROBE;
  const byHeight = (MAX_TEXT_HEIGHT / probed.height) * PROBE;
  let fontSize = Math.floor(Math.min(byWidth, byHeight));

  /**
   * Pass three: check the real thing, and shrink until it genuinely fits.
   *
   * Letter-spacing and hinting do not scale perfectly linearly, so pass two is
   * an estimate rather than a proof. This is the proof — and it is worth having
   * because the failure it catches is a label that runs off both ends of the
   * banner, which looks like nobody checked.
   */
  let label;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    label = await sharp(textSvg(fontSize, SPACING * (fontSize / PROBE), BAND.width, BAND.height))
      .png()
      .toBuffer();
    const drawn = await inkExtents(label);
    if (drawn.width <= MAX_TEXT_WIDTH && drawn.height <= BAND.height) break;
    fontSize -= 1;
  }

  const fill = await sharp({
    create: {
      width: BAND.width,
      height: BAND.height,
      channels: 4,
      background: { ...BANNER_FILL, alpha: 1 },
    },
  })
    .png()
    .toBuffer();

  const out = await sharp(source)
    .composite([
      // Bury the motto first, then write over the flat fill. Doing it in one
      // composite would leave the old italic text showing through.
      { input: fill, left: BAND.x, top: BAND.y },
      { input: label, left: BAND.x, top: BAND.y },
    ])
    .png()
    .toBuffer();

  await writeFile(SOURCE, out);
  console.log(`✓ ${SOURCE} — "${TEXT}" at ${fontSize}px`);

  /**
   * The app icons are the same emblem at other sizes, so they are regenerated
   * rather than left showing the old motto on the home screen of every phone
   * that installed this as an app.
   */
  const derived = [
    { file: "public/icon-512.png", size: 512 },
    { file: "public/icon-192.png", size: 192 },
    { file: "public/apple-icon.png", size: 180 },
    { file: "public/favicon-32.png", size: 32 },
  ];

  for (const { file, size } of derived) {
    await sharp(out).resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(file);
    console.log(`✓ ${file} (${size}px)`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
