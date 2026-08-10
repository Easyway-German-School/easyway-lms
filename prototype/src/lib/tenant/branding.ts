/**
 * What a tenant looks like.
 *
 * The white-label columns have existed on `Tenant` since the platform layer
 * landed, and until now nothing read a single one of them: a school could be
 * given a brand name, a logo and a colour, and the product would go on calling
 * itself EasyWay in EasyWay orange. Columns that nothing reads are not a
 * feature that is nearly finished, they are a promise the demo cannot keep.
 *
 * EVERY FIELD FALLS BACK TO EASYWAY'S OWN. The live tenant has all three
 * columns null, so the defaults below must reproduce exactly what the product
 * rendered before this file existed — otherwise wiring up white-labelling is
 * indistinguishable from restyling the customer who is actually paying.
 */

export type Branding = {
  name: string;
  logoUrl: string;
  markUrl: string;
  /**
   * The monogram shown when no artwork loads at all. Carried rather than
   * derived from `name`, because deriving it gets EasyWay's own wrong: word
   * initials of "Easyway German Language School" give "EG", and the product has
   * always shown "EW". A default brand should never be a guess.
   */
  initials: string;
  /** Null when the tenant has not chosen one, which means "leave the CSS alone". */
  primaryColor: string | null;
};

/**
 * The name here is the school's full one, matching layout.tsx, the manifest and
 * every email — NOT the shortened form on the emblem. The emblem was shortened
 * to fit its banner, which is a layout constraint and not a rename, and this
 * string is what feeds `alt` text and the no-artwork fallback.
 */
export const DEFAULT_BRANDING: Branding = {
  name: "Easyway German Language School",
  logoUrl: "/logo.png",
  markUrl: "/logo-mark.png",
  initials: "EW",
  primaryColor: null,
};

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * Only a hex literal is accepted, and this is a security boundary rather than
 * fussiness.
 *
 * The value ends up inside a CSS custom property. A tenant field that reaches
 * a stylesheet unvalidated is a stored-CSS-injection hole: `red;} :root{...` or
 * a `url(...)` that phones home on every page load would both be honoured by
 * the browser. Anything that is not six hex digits is discarded and the tenant
 * simply keeps the default palette.
 */
export function isSafeColor(value: string | null | undefined): value is string {
  return typeof value === "string" && HEX.test(value.trim());
}

/**
 * A logo URL is accepted only as a same-origin path or an https URL.
 *
 * `javascript:` and `data:` in an <img src> are the obvious reasons. The less
 * obvious one is plain http, which on an https page is blocked as mixed content
 * — so accepting it produces a tenant whose logo silently never appears and
 * whose console shows an error nobody in their office will read.
 */
export function isSafeLogo(value: string | null | undefined): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  const url = value.trim();
  if (url.startsWith("/") && !url.startsWith("//")) return true;
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------- */

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const raw = hex.trim().slice(1);
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((c) => c + c)
          .join("")
      : raw;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

/**
 * Mix towards white or black by a ratio, in plain sRGB.
 *
 * Deliberately not HSL. Lightening in HSL moves a saturated orange through a
 * washed-out peach, because raising L alone desaturates as it approaches white;
 * mixing towards white keeps the hue's character, which is what "the same brand
 * colour, lighter" is understood to mean by the person who picked it.
 */
function mix(hex: string, towards: 0 | 255, ratio: number): string {
  const { r, g, b } = hexToRgb(hex);
  const blend = (channel: number) =>
    Math.round(channel + (towards - channel) * ratio)
      .toString(16)
      .padStart(2, "0");
  return `#${blend(r)}${blend(g)}${blend(b)}`;
}

function rgba(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * The CSS a tenant's chosen colour turns into.
 *
 * `--accent-strong` is left alone on purpose. It is the teal that pairs with
 * the orange throughout the product, and deriving a second colour from a single
 * customer-picked one produces the sort of pairing that makes a product look
 * generated rather than designed. One colour is what the field asks for and one
 * colour is what it sets.
 *
 * THE DOUBLED `:root:root` IS NOT A TYPO. globals.css sets these same
 * properties on `:root` and `.theme-light` (both 0,1,0) and on
 * `html.theme-dark` and `html.theme-custom` (both 0,1,1). Matching those
 * specificities would leave the outcome decided by whichever rule the bundler
 * emitted last — a source-order race that works in dev and can flip in a
 * production build. Repeating the selector puts these at 0,2,0 and 0,3,0,
 * above every one of them, without editing the theme system at all.
 */
export function brandingCss(primaryColor: string | null): string {
  if (!isSafeColor(primaryColor)) return "";

  const base = primaryColor.trim();

  return `
:root:root {
  --accent: ${base};
  --accent-ink: ${mix(base, 0, 0.3)};
  --accent-soft: ${rgba(base, 0.12)};
}
:root:root.theme-dark, :root:root.theme-custom {
  --accent: ${mix(base, 255, 0.12)};
  --accent-ink: ${mix(base, 255, 0.55)};
  --accent-soft: ${rgba(base, 0.18)};
}`.trim();
}
