/**
 * Cuts Becca out of the studio backdrop she was rendered on.
 *
 * The supplied artwork is a product shot, not a character asset: she stands on
 * a display plinth against a pale grey sweep. Dropped into the app as-is she
 * reads as a photograph pasted onto the page — a rectangle of somebody else's
 * background sitting inside our teal panel — which is exactly what it looked
 * like. A CSS mask is not a fix for this: a mask fades a rectangle out at the
 * edges, so the backdrop nearest her is precisely the part it keeps.
 *
 * So the background is removed for real, once, at build-asset time rather than
 * on every render.
 *
 * TWO THINGS ARE IN THE WAY, AND THEY NEED DIFFERENT TREATMENT:
 *
 *   The sweep      Pale and neutral (measured ~216,221,227). Flood-filled
 *                  inwards from the border, so only background CONNECTED to
 *                  the outside is removed — the white of her eyes and the
 *                  highlights on her bag are enclosed by her and can never be
 *                  reached, which is the whole reason this is a flood and not
 *                  a colour-key.
 *
 *   The plinth     Its top face is a warm cream (~219,210,205) that the same
 *                  neutral test catches, but its dark rim (~60,54,56) is not
 *                  light at all and would survive. Rather than add a second
 *                  rule for it, everything below the soles of her shoes is
 *                  simply discarded: nothing of her exists down there. The
 *                  soles are found by looking for the lowest strongly-pink
 *                  pixel, since her shoes are the same hot pink as her dress
 *                  — an anchor in the artwork itself rather than a magic row
 *                  number that a re-rendered asset would silently break.
 *
 * The edge is FEATHERED rather than cut binary. A hard threshold leaves every
 * rim pixel — each one a blend of her and the sweep — fully opaque, which is
 * the pale halo that makes an amateur cutout look like an amateur cutout.
 * Alpha instead ramps across the blend, so the silhouette stays smooth against
 * any colour we later put behind her.
 *
 * Idempotent in effect: it always re-derives from the source JPEG, so a second
 * run produces the same PNG rather than eroding the one before it.
 *
 *   node scripts/clean-mascot.mjs
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MASCOT_DIR = path.join(HERE, "..", "public", "mascot");

const SOURCE = path.join(MASCOT_DIR, "becca.jpg");
const OUTPUT = path.join(MASCOT_DIR, "becca.png");
const BUST = path.join(MASCOT_DIR, "becca-bust.png");

/**
 * How far down the full-length cut-out the bust crop reaches.
 *
 * Most places she appears are small — 64px in the signup header, 64 in the
 * goal picker, 80 on the journey map. A full-length figure in a 64px box puts
 * her face at about fifteen pixels, which is a smudge with hair on it; the
 * djinn she replaced had the same problem and solved it by cropping its
 * viewBox to the character. This is that same fix, done to the asset: head,
 * shoulders and the waving hand, which is all of her that carries expression.
 */
const BUST_DEPTH = 0.46;

/**
 * Anything this bright and this colourless is the sweep. Both numbers are
 * measured off the artwork, not guessed: the sweep runs 216-235 with its
 * channels within ~11 of each other, and nothing painted on her is neutral
 * except enclosed highlights the flood cannot reach.
 */
const LIGHT_CORE = 202;
/** Below this it is her, however grey it looks. Between the two, it is a blend. */
const LIGHT_EDGE = 150;
const SAT_MAX = 32;

/** Kept below the soles so the shoe's own shadow does not get sliced off. */
const SOLE_MARGIN = 8;

/**
 * A sealed-off pocket of sweep this big is background; anything smaller is
 * hers and is left alone.
 *
 * Measured, not guessed. The pockets the border flood cannot reach — behind
 * her waving hand, between her arm and her waist, between her legs, and the
 * slice of plinth passing behind her heels — are 514px and up. The largest
 * light-neutral thing that actually belongs to her is her teeth at 368px,
 * then an eye white at 193px. 450 sits in that gap.
 *
 * The gap is real but not wide, so HEAD_BOX below is a second, independent
 * guard rather than a redundant one: it protects the eyes and teeth by
 * position no matter what happens to their pixel counts, which is what makes
 * this safe to re-run against a re-rendered Becca. Every pocket that must be
 * removed lies outside that box — the nearest, behind her raised hand, is
 * well to the left of her face.
 */
const MIN_POCKET = 450;

/**
 * Where her face is, as fractions of the cut-out so a bigger render still
 * lands in the same place. Nothing inside it is ever cleared.
 */
const HEAD_BOX = { x0: 0.33, x1: 0.68, y0: 0, y1: 0.32 };

/**
 * The plinth's rim is dark (~60,54,56) where its top face is cream, so the
 * light test walks straight past it and leaves an ellipse arcing behind her
 * heels. Rather than loosen the light test everywhere — which would start
 * eating her hair — the bottom of the frame gets one extra pass that treats
 * ANY colourless pixel as background, bright or dark. It is safe precisely
 * there and nowhere else: the only things of hers this low are her shoes
 * (hot pink) and her ankles (warm brown), and neither is colourless.
 */
const BASE_STRIP = 0.07;

/**
 * Tighter than SAT_MAX, because down here the flood is passing right by her
 * ankles. The rim pixels where her skin meets the sweep measure 16-19; the
 * plinth measures 5-14. Twenty splits them without eating into her.
 */
const STRIP_SAT = 15;

/** How pink is pink enough to be her dress or her shoes. */
function isPink(r, g, b) {
  return r > 150 && r - g > 60 && b - g > 20;
}

/**
 * 1 = certainly sweep, 0 = certainly her, between = the anti-aliased rim.
 */
function backgroundness(r, g, b) {
  const darkest = Math.min(r, g, b);
  const saturation = Math.max(r, g, b) - darkest;
  if (saturation > SAT_MAX) return 0;
  if (darkest >= LIGHT_CORE) return 1;
  if (darkest <= LIGHT_EDGE) return 0;
  return (darkest - LIGHT_EDGE) / (LIGHT_CORE - LIGHT_EDGE);
}

const { data, info } = await sharp(SOURCE).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width, height } = info;

// --- 1. Find the soles, and drop the plinth ------------------------------
let soles = 0;
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    if (isPink(data[i], data[i + 1], data[i + 2]) && y > soles) soles = y;
  }
}
const floor = Math.min(height, soles + SOLE_MARGIN);
for (let y = floor; y < height; y++) {
  for (let x = 0; x < width; x++) data[(y * width + x) * 4 + 3] = 0;
}

// --- 2. Flood the sweep inwards from the border --------------------------
const seen = new Uint8Array(width * height);
const queue = [];

function consider(x, y) {
  if (x < 0 || y < 0 || x >= width || y >= floor) return;
  const p = y * width + x;
  if (seen[p]) return;
  const i = p * 4;
  const cover = backgroundness(data[i], data[i + 1], data[i + 2]);
  if (cover <= 0) return; // Her. The flood stops here.
  seen[p] = 1;
  data[i + 3] = Math.round(data[i + 3] * (1 - cover));
  queue.push(p);
}

for (let x = 0; x < width; x++) {
  consider(x, 0);
  consider(x, floor - 1);
}
for (let y = 0; y < floor; y++) {
  consider(0, y);
  consider(width - 1, y);
}

while (queue.length) {
  const p = queue.pop();
  const x = p % width;
  const y = (p - x) / width;
  consider(x + 1, y);
  consider(x - 1, y);
  consider(x, y + 1);
  consider(x, y - 1);
}

// --- 2b. Sweep the plinth rim out of the bottom of the frame -------------
{
  const stripTop = Math.floor(floor * (1 - BASE_STRIP));
  const strip = [];
  /**
   * Its OWN visited set, deliberately — not the border flood's.
   *
   * Sharing `seen` silently broke this: every pixel the border flood had
   * already cleared was marked seen, so the strip flood bounced off the
   * transparent surround it needed to travel through and never reached the
   * rim at all. It has to be able to spread through cleared space.
   */
  const walked = new Uint8Array(width * floor);
  const consideredStrip = (x, y) => {
    if (x < 0 || y < stripTop || x >= width || y >= floor) return;
    const p = y * width + x;
    if (walked[p]) return;
    const i = p * 4;
    if (data[i + 3] === 0) { walked[p] = 1; strip.push(p); return; }
    const darkest = Math.min(data[i], data[i + 1], data[i + 2]);
    if (Math.max(data[i], data[i + 1], data[i + 2]) - darkest > STRIP_SAT) return; // Her.
    walked[p] = 1;
    data[i + 3] = 0;
    strip.push(p);
  };

  for (let x = 0; x < width; x++) {
    consideredStrip(x, stripTop);
    consideredStrip(x, floor - 1);
  }
  for (let y = stripTop; y < floor; y++) {
    consideredStrip(0, y);
    consideredStrip(width - 1, y);
  }
  while (strip.length) {
    const p = strip.pop();
    const x = p % width;
    const y = (p - x) / width;
    consideredStrip(x + 1, y);
    consideredStrip(x - 1, y);
    consideredStrip(x, y + 1);
    consideredStrip(x, y - 1);
  }
}

// --- 3. Clear the pockets the border flood could not reach ---------------
//
// A flood from the outside only removes background CONNECTED to the outside,
// which is the property that protects her eyes and teeth — and equally the
// reason the sweep survives wherever she encloses it: behind her raised hand,
// between arm and waist, between her legs. Each surviving region is measured
// on its own and cleared only if it is too big to be a facial feature and
// sits outside her face.
let pockets = 0;
const inHead = (x, y) =>
  x >= HEAD_BOX.x0 * width &&
  x <= HEAD_BOX.x1 * width &&
  y >= HEAD_BOX.y0 * floor &&
  y <= HEAD_BOX.y1 * floor;

for (let start = 0; start < width * floor; start++) {
  if (seen[start]) continue;
  const i = start * 4;
  if (data[i + 3] < 8) { seen[start] = 1; continue; }
  if (backgroundness(data[i], data[i + 1], data[i + 2]) <= 0) continue;

  const region = [start];
  const members = [];
  seen[start] = 1;
  let guarded = false;

  while (region.length) {
    const p = region.pop();
    members.push(p);
    const x = p % width;
    const y = (p - x) / width;
    if (inHead(x, y)) guarded = true;

    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= floor) continue;
      const q = ny * width + nx;
      if (seen[q]) continue;
      const j = q * 4;
      if (data[j + 3] < 8) { seen[q] = 1; continue; }
      if (backgroundness(data[j], data[j + 1], data[j + 2]) <= 0) continue;
      seen[q] = 1;
      region.push(q);
    }
  }

  if (guarded || members.length < MIN_POCKET) continue;
  for (const p of members) {
    const j = p * 4;
    data[j + 3] = Math.round(data[j + 3] * (1 - backgroundness(data[j], data[j + 1], data[j + 2])));
  }
  pockets++;
}

// --- 4. Trim to what is left, and write ----------------------------------
let top = floor, bottom = 0, left = width, right = 0;
for (let y = 0; y < floor; y++) {
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
  height: Math.min(floor, bottom + 3) - Math.max(0, top - 2),
};

const full = sharp(data, { raw: { width, height, channels: 4 } });
await full.clone().extract(cropped).png({ compressionLevel: 9 }).toFile(OUTPUT);

const bust = {
  left: cropped.left,
  top: cropped.top,
  width: cropped.width,
  height: Math.round(cropped.height * BUST_DEPTH),
};
await full.clone().extract(bust).png({ compressionLevel: 9 }).toFile(BUST);

const cleared = seen.reduce((total, flag) => total + flag, 0);
console.log(
  `becca.png written — ${cropped.width}x${cropped.height}\n` +
    `becca-bust.png written — ${bust.width}x${bust.height}\n` +
    `(soles at y=${soles}, ${pockets} enclosed pockets cleared, ` +
    `${cleared} background px removed from ${width}x${height})`,
);
