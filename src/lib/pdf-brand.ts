import { rgb, type PDFDocument, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { LOGO_MARK_PNG_BASE64, STAMP_PNG_BASE64 } from "@/lib/brand-assets";

/**
 * Shared look for the school's generated PDFs (payment receipt, enrolment
 * letter): one palette, one set of contact details, the embedded artwork, and
 * the few drawing helpers both documents need that `pdf-lib`'s standard fonts
 * cannot do on their own (the Naira sign, wrapped text, amounts in words).
 */

export const NAVY = rgb(0.157, 0.208, 0.478); // #28357A — the paper receipt book's ink
export const ORANGE = rgb(0.949, 0.416, 0.106); // #F26A1B — the logo's orange
export const RED = rgb(0.71, 0.125, 0.165); // #B5202A — the "EASYWAY" wordmark on the letterhead
export const INK = rgb(0.1, 0.1, 0.12);
export const MUTED = rgb(0.4, 0.42, 0.5);
export const HAIRLINE = rgb(0.84, 0.86, 0.92);
export const GREEN = rgb(0.09, 0.5, 0.28);

export const SCHOOL_CONTACT = {
  address: "23, Unity Road, off Toyin Street, Ikeja - Lagos, Nigeria",
  addressShort: "23 Unity Road, Off Toyin Street, Ikeja, Lagos, Nigeria.",
  website: "www.easywaylanguageschool.com",
  email: "info@easywaylanguageschool.com",
  phones: "+234 708 900 2534, 0813 534 1671",
  phoneShort: "+234 708 900 2534",
  signatory: "Sogbesan Rebecca",
  signatoryTitle: "Administrative Officer",
};

/**
 * The embedded stamp and signature belong to Easyway. Another tenant's
 * documents must never carry them, so callers gate on this.
 */
export function isEasywayBrand(schoolName?: string | null): boolean {
  return !schoolName || /easy\s*way/i.test(schoolName);
}

export type BrandArt = { mark: PDFImage; stamp: PDFImage };

export async function embedBrandArt(doc: PDFDocument): Promise<BrandArt> {
  const [mark, stamp] = await Promise.all([
    doc.embedPng(Buffer.from(LOGO_MARK_PNG_BASE64, "base64")),
    doc.embedPng(Buffer.from(STAMP_PNG_BASE64, "base64")),
  ]);
  return { mark, stamp };
}

export function wrapLines(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Pill / rounded rectangle. `pdf-lib`'s drawRectangle has no corner radius, so
 * this goes through an SVG path (y axis is flipped there — drawSvgPath
 * anchors at the top-left of the shape).
 */
export function roundedRect(
  page: PDFPage,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  opts: { fill?: ReturnType<typeof rgb>; border?: ReturnType<typeof rgb>; borderWidth?: number; opacity?: number },
): void {
  const radius = Math.min(r, h / 2, w / 2);
  const path =
    `M ${radius} 0 H ${w - radius} A ${radius} ${radius} 0 0 1 ${w} ${radius} V ${h - radius} ` +
    `A ${radius} ${radius} 0 0 1 ${w - radius} ${h} H ${radius} A ${radius} ${radius} 0 0 1 0 ${h - radius} ` +
    `V ${radius} A ${radius} ${radius} 0 0 1 ${radius} 0 Z`;
  page.drawSvgPath(path, {
    x,
    y: y + h,
    color: opts.fill,
    borderColor: opts.border,
    borderWidth: opts.border ? (opts.borderWidth ?? 1) : 0,
    opacity: opts.opacity,
    borderOpacity: opts.opacity,
  });
}

/**
 * The Naira sign. The standard-14 fonts are WinAnsi and have no U+20A6 (it
 * throws rather than drop it), so draw an "N" and strike it through twice.
 */
export function nairaSignWidth(font: PDFFont, size: number): number {
  return font.widthOfTextAtSize("N", size);
}

export function drawNairaSign(page: PDFPage, x: number, y: number, size: number, font: PDFFont, color: ReturnType<typeof rgb>): void {
  page.drawText("N", { x, y, size, font, color });
  const w = nairaSignWidth(font, size);
  const thickness = Math.max(0.6, size * 0.055);
  for (const frac of [0.3, 0.44]) {
    page.drawLine({
      start: { x: x - size * 0.06, y: y + size * frac },
      end: { x: x + w + size * 0.06, y: y + size * frac },
      thickness,
      color,
    });
  }
}

export function formatMoneyDigits(amount: number, decimals = 2): string {
  return amount.toLocaleString("en-NG", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** Width of a money figure as drawMoney will lay it out — for right/centre alignment. */
export function moneyWidth(amount: number, currency: string, font: PDFFont, size: number): number {
  const digits = formatMoneyDigits(amount);
  if (currency.toUpperCase() === "NGN") return nairaSignWidth(font, size) + size * 0.18 + font.widthOfTextAtSize(digits, size);
  return font.widthOfTextAtSize(`${currency.toUpperCase()} ${digits}`, size);
}

export function drawMoney(
  page: PDFPage,
  x: number,
  y: number,
  amount: number,
  currency: string,
  font: PDFFont,
  size: number,
  color: ReturnType<typeof rgb>,
): number {
  const digits = formatMoneyDigits(amount);
  if (currency.toUpperCase() === "NGN") {
    drawNairaSign(page, x, y, size, font, color);
    const dx = nairaSignWidth(font, size) + size * 0.18;
    page.drawText(digits, { x: x + dx, y, size, font, color });
    return dx + font.widthOfTextAtSize(digits, size);
  }
  const text = `${currency.toUpperCase()} ${digits}`;
  page.drawText(text, { x, y, size, font, color });
  return font.widthOfTextAtSize(text, size);
}

const ONES = [
  "", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
  "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

function underThousand(n: number): string {
  const parts: string[] = [];
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds) parts.push(`${ONES[hundreds]} hundred`);
  if (rest) {
    const tail = rest < 20 ? ONES[rest] : `${TENS[Math.floor(rest / 10)]}${rest % 10 ? `-${ONES[rest % 10]}` : ""}`;
    parts.push(hundreds ? `and ${tail}` : tail);
  }
  return parts.join(" ");
}

/** "Four hundred and five thousand Naira only" — the line a paper receipt writes out by hand. */
export function amountInWords(amount: number, currency = "NGN"): string {
  const whole = Math.max(0, Math.round(amount));
  const unit = currency.toUpperCase() === "NGN" ? "Naira" : currency.toUpperCase();
  if (whole === 0) return `Zero ${unit} only`;

  const scales: Array<[number, string]> = [
    [1_000_000_000, "billion"],
    [1_000_000, "million"],
    [1_000, "thousand"],
  ];
  let remaining = whole;
  const parts: string[] = [];
  for (const [size, name] of scales) {
    const chunk = Math.floor(remaining / size);
    if (chunk) {
      parts.push(`${underThousand(chunk)} ${name}`);
      remaining -= chunk * size;
    }
  }
  if (remaining) {
    // "Five hundred thousand and fifty" — a trailing sub-hundred reads with "and".
    const tail = underThousand(remaining);
    parts.push(parts.length && remaining < 100 ? `and ${tail}` : tail);
  }
  const sentence = parts.join(" ");
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)} ${unit} only`;
}

/** "2nd of October, 2026" — the letter's date style, as on the school's own letters. */
export function ordinalDate(date: Date): string {
  const day = date.getDate();
  const suffix = day % 10 === 1 && day !== 11 ? "st" : day % 10 === 2 && day !== 12 ? "nd" : day % 10 === 3 && day !== 13 ? "rd" : "th";
  const month = date.toLocaleDateString("en-GB", { month: "long" });
  return `${day}${suffix} of ${month}, ${date.getFullYear()}`;
}
