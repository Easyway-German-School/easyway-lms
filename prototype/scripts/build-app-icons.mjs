/**
 * Builds the maskable home-screen icons from the master logo.
 *
 * WHY A SEPARATE ICON AT ALL. `logo-mark.png` is a sticker: the emblem sits
 * edge to edge and a teal banner reading "EASYWAY GERMAN LANGUAGE SCHOOL" runs
 * along the bottom. That is the right artwork for a page header and the wrong
 * one for a home screen, for two independent reasons.
 *
 *   The text is unreadable. A home-screen icon renders at roughly 48–64dp.
 *   Thirty characters across that is a grey smear — the same reason the
 *   favicon uses the emblem and not the horizontal lockup.
 *
 *   Android will cut into it. A maskable icon is cropped by the launcher to
 *   whatever shape it likes: a circle on Pixel, a squircle on Samsung, a
 *   rounded square elsewhere. The spec guarantees only the centre 80% survives.
 *   Feed it edge-to-edge art and the mortarboard loses its top corners and the
 *   banner disappears entirely. Declaring the existing icon `maskable` would
 *   have looked like a one-word fix and quietly mutilated the logo.
 *
 * So: crop the emblem away from the banner, drop it into the middle 62% of an
 * opaque brand-teal square, and let the launcher crop the teal instead of the
 * artwork. The full-bleed original stays in the manifest as `purpose: "any"`
 * for the contexts that do not crop.
 *
 * Run after changing the logo:  node scripts/build-app-icons.mjs
 * See also scripts/clean-logo.mjs, which prepares the source artwork.
 */

import sharp from "sharp";

const SOURCE = "public/logo-mark.png";

/**
 * Where the emblem stops and the banner begins, measured rather than guessed:
 * scanning rows, the proportion of dark-teal pixels jumps from 12% to 96%
 * between y=400 and y=408 as the solid banner starts. 404 is that edge.
 */
const BANNER_TOP = 404;

/** The brand teal. Opaque, because a maskable icon may not be transparent —
 *  the launcher masks the canvas, so a hole in it is a hole in the icon. */
const BACKGROUND = { r: 0x0d, g: 0x7c, b: 0x7e, alpha: 1 };

/**
 * How much of the canvas the artwork may occupy.
 *
 * The safe area is a circle of 80% diameter, so a square-ish emblem has to fit
 * INSIDE that circle, not inside an 80% square. At 62% the emblem's diagonal
 * comes to ~407px on a 512 canvas against the 410px the circle allows — which
 * is why this is 0.62 and not the 0.8 the "80% safe area" phrasing suggests.
 */
const CONTENT_SCALE = 0.62;

async function build(size) {
  const target = Math.round(size * CONTENT_SCALE);

  // Crop the banner off, then trim the transparent margin so the scale below
  // measures the artwork itself rather than the empty space around it.
  const emblem = await sharp(SOURCE)
    .extract({ left: 0, top: 0, width: 512, height: BANNER_TOP })
    .trim()
    .resize(target, target, { fit: "inside", withoutEnlargement: false })
    .toBuffer();

  const out = `public/icon-maskable-${size}.png`;
  await sharp({
    create: { width: size, height: size, channels: 4, background: BACKGROUND },
  })
    .composite([{ input: emblem, gravity: "centre" }])
    .png()
    .toFile(out);

  return out;
}

for (const size of [192, 512]) {
  console.log("wrote", await build(size));
}
