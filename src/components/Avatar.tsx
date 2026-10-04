"use client";

import { useId, type ReactNode } from "react";

import {
  BACKGROUNDS,
  HAIR_COLORS,
  SKIN_TONES,
  TOP_COLORS,
  avatarOrDefault,
  type AvatarConfig,
} from "@/lib/avatar";

/**
 * Draws a student's avatar. Pure SVG, one 100x100 box, flat colours — no
 * image to load, nothing to cache, crisp at 24px in a chat row and at 160px on
 * the profile.
 *
 * Painted back to front: backdrop, hair that sits BEHIND the head, ears, neck,
 * outfit, head, face, hair that sits IN FRONT of it, then accessories. The
 * head is an ellipse centred at (50,46); every face feature is placed against
 * that, so a new style only has to respect those numbers.
 */

const INK = "#1B1410";
const MOUTH = "#8A2F2F";

/** A darker or lighter shade of a hex colour, for shading without more palette entries. */
function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const channel = (shift: number) => {
    const c = (n >> shift) & 255;
    const next = amount < 0 ? c * (1 + amount) : c + (255 - c) * amount;
    return Math.max(0, Math.min(255, Math.round(next)));
  };
  return `#${((1 << 24) | (channel(16) << 16) | (channel(8) << 8) | channel(0)).toString(16).slice(1)}`;
}

function BackHair({ style, color }: { style: AvatarConfig["hair"]; color: string }) {
  switch (style) {
    case "afro":
      return <circle cx="50" cy="35" r="27" fill={color} />;
    case "puffs":
      return (
        <>
          <circle cx="28.5" cy="27" r="11" fill={color} />
          <circle cx="71.5" cy="27" r="11" fill={color} />
        </>
      );
    case "braids":
      return (
        <g stroke={color} strokeWidth="5" strokeLinecap="round" fill="none">
          <path d="M33 38 C28 56 27 76 26 94" />
          <path d="M37 40 C34 58 33 78 32 96" />
          <path d="M67 38 C72 56 73 76 74 94" />
          <path d="M63 40 C66 58 67 78 68 96" />
        </g>
      );
    case "long":
      return <path d="M31 44 C27 28 38 19 50 19 C62 19 73 28 69 44 L73 86 C60 91 40 91 27 86 Z" fill={color} />;
    case "bun":
      return <circle cx="50" cy="19.5" r="8.5" fill={color} />;
    default:
      return null;
  }
}

function FrontHair({ style, color }: { style: AvatarConfig["hair"]; color: string }) {
  switch (style) {
    case "bald":
      return null;
    case "buzz":
      return <path d="M33.5 44 C32.5 30 41 25 50 25 C59 25 67.5 30 66.5 44 C63.5 37 58 34 50 34 C42 34 36.5 37 33.5 44 Z" fill={color} />;
    case "fade":
      return <path d="M32.5 46 C29.5 28 40 21.5 50 21.5 C60 21.5 70.5 28 67.5 46 C65.5 38 60 32.5 50 32 C40 32.5 34.5 38 32.5 46 Z" fill={color} />;
    case "afro":
      return <path d="M34 41 C35 29 42 24.5 50 24.5 C58 24.5 65 29 66 41 C61 35.5 56 34 50 34 C44 34 39 35.5 34 41 Z" fill={color} />;
    case "puffs":
      return <path d="M33.5 43 C33.5 30 41.5 25 50 25 C58.5 25 66.5 30 66.5 43 C62 37 57 34.5 50 34.5 C43 34.5 38 37 33.5 43 Z" fill={color} />;
    case "twists":
      return (
        <>
          <path d="M33 44 C32 30 41 24.5 50 24.5 C59 24.5 68 30 67 44 C63.5 37 58 34 50 34 C42 34 36.5 37 33 44 Z" fill={color} />
          {[
            [37, 25.5],
            [44.5, 22.5],
            [52.5, 22],
            [60, 24.5],
            [31.5, 33],
            [68.5, 33],
          ].map(([x, y]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r="4.2" fill={color} stroke={shade(color, -0.25)} strokeWidth="0.8" />
          ))}
        </>
      );
    case "braids":
      return (
        <>
          <path d="M32.5 45 C30.5 29 40 23 50 23 C60 23 69.5 29 67.5 45 C65 37 59 33 50 33 C41 33 35 37 32.5 45 Z" fill={color} />
          <path d="M50 24 L50 33" stroke={shade(color, -0.3)} strokeWidth="1.2" strokeLinecap="round" />
        </>
      );
    case "long":
      return <path d="M33.5 45 C33.5 31 42 25 52 25 C60 25 66.5 30.5 66.5 42 C59 36 49.5 34 41 38.5 C37.5 40.5 35 42.5 33.5 45 Z" fill={color} />;
    case "bun":
      return <path d="M33.5 44 C33 30 41 25 50 25 C59 25 67 30 66.5 44 C63.5 37 58 34 50 34 C42 34 36.5 37 33.5 44 Z" fill={color} />;
    case "headwrap":
      return (
        <>
          <path d="M30.5 41 C28.5 25 40 15.5 52 16 C64 16.5 72 26 69.5 41 C62 34 39 33 30.5 41 Z" fill={color} />
          <ellipse cx="57" cy="15" rx="13" ry="8" transform="rotate(-18 57 15)" fill={color} />
          <path d="M44 14.5 C50 9 60 8.5 68 13" stroke={shade(color, 0.45)} strokeWidth="1.6" strokeLinecap="round" fill="none" />
          <path d="M33 38 C42 31.5 58 31 68 37" stroke={shade(color, 0.4)} strokeWidth="1.4" strokeLinecap="round" fill="none" />
          <path d="M36 30 C46 24 58 24 66 29" stroke={shade(color, -0.3)} strokeWidth="1.2" strokeLinecap="round" fill="none" />
        </>
      );
    case "cap":
      return (
        <>
          <path d="M31 40.5 C30.5 25 40 19.5 50 19.5 C60 19.5 69.5 25 69 40.5 Z" fill={color} />
          <path d="M50 20 L50 39" stroke={shade(color, -0.2)} strokeWidth="0.9" />
          <circle cx="50" cy="19.5" r="1.8" fill={shade(color, -0.25)} />
          <path d="M48 38.5 C60 36 73 37.5 79 41.5 C72 45.5 59 43.5 48 42 Z" fill={shade(color, -0.22)} />
        </>
      );
    default:
      return null;
  }
}

function Eyes({ style }: { style: AvatarConfig["eyes"] }) {
  const dot = (cx: number, r = 2.3) => (
    <g key={cx}>
      <circle cx={cx} cy="46" r={r} fill={INK} />
      <circle cx={cx + 0.8} cy="45.2" r="0.8" fill="#fff" />
    </g>
  );
  const arc = (cx: number) => (
    <path key={cx} d={`M${cx - 2.8} 47 Q${cx} 43 ${cx + 2.8} 47`} stroke={INK} strokeWidth="1.9" strokeLinecap="round" fill="none" />
  );

  switch (style) {
    case "happy":
      return <>{arc(43)}{arc(57)}</>;
    case "sleepy":
      return (
        <g stroke={INK} strokeWidth="1.9" strokeLinecap="round" fill="none">
          <path d="M40.3 46.5 H45.7" />
          <path d="M54.3 46.5 H59.7" />
          <path d="M40.8 48.3 Q43 49.4 45.2 48.3" strokeWidth="0.9" opacity="0.5" />
          <path d="M54.8 48.3 Q57 49.4 59.2 48.3" strokeWidth="0.9" opacity="0.5" />
        </g>
      );
    case "wink":
      return <>{dot(43)}{arc(57)}</>;
    case "wide":
      return (
        <>
          {[43, 57].map((cx) => (
            <g key={cx}>
              <circle cx={cx} cy="46" r="3.7" fill="#fff" stroke={INK} strokeWidth="0.9" />
              <circle cx={cx + 0.4} cy="46.3" r="2" fill={INK} />
              <circle cx={cx + 1.1} cy="45.3" r="0.7" fill="#fff" />
            </g>
          ))}
        </>
      );
    default:
      return <>{dot(43)}{dot(57)}</>;
  }
}

function Brows({ style, color }: { style: AvatarConfig["brows"]; color: string }) {
  const stroke = { stroke: color, strokeWidth: 1.7, strokeLinecap: "round" as const, fill: "none" };
  switch (style) {
    case "none":
      return null;
    case "straight":
      return (
        <g {...stroke}>
          <path d="M39.5 40.5 H46.5" />
          <path d="M53.5 40.5 H60.5" />
        </g>
      );
    case "raised":
      return (
        <g {...stroke}>
          <path d="M39.5 39.5 Q43 36 46.5 38.5" />
          <path d="M53.5 38.5 Q57 36 60.5 39.5" />
        </g>
      );
    default:
      return (
        <g {...stroke}>
          <path d="M39.5 40.5 Q43 38.3 46.5 40" />
          <path d="M53.5 40 Q57 38.3 60.5 40.5" />
        </g>
      );
  }
}

function Mouth({ style }: { style: AvatarConfig["mouth"] }) {
  switch (style) {
    case "grin":
      return (
        <g>
          <path d="M43 56.5 Q50 67 57 56.5 Z" fill={MOUTH} />
          <path d="M44.4 56.9 Q50 58.8 55.6 56.9 L55 59.2 Q50 61 45 59.2 Z" fill="#fff" />
        </g>
      );
    case "tongue":
      return (
        <g>
          <path d="M43 56.5 Q50 67 57 56.5 Z" fill={MOUTH} />
          <path d="M46.5 61.6 Q50 59.6 53.5 61.6 Q52.5 66.2 50 66.2 Q47.5 66.2 46.5 61.6 Z" fill="#F07A8D" />
        </g>
      );
    case "smirk":
      return <path d="M44.5 58.5 Q50.5 61.5 57 56.5" stroke={MOUTH} strokeWidth="1.9" strokeLinecap="round" fill="none" />;
    case "neutral":
      return <path d="M45.5 58.5 H54.5" stroke={MOUTH} strokeWidth="1.9" strokeLinecap="round" />;
    default:
      return <path d="M44 57 Q50 63 56 57" stroke={MOUTH} strokeWidth="1.9" strokeLinecap="round" fill="none" />;
  }
}

function Outfit({ top, color, skin, patternId }: { top: AvatarConfig["top"]; color: string; skin: string; patternId: string }) {
  const shirt = "M16 101 C16 82 29 74 42 72 Q50 83 58 72 C71 74 84 82 84 101 Z";
  const dark = shade(color, -0.22);
  const light = shade(color, 0.5);
  const neckSkin = shade(skin, -0.12);

  switch (top) {
    case "hoodie":
      return (
        <g>
          <path d="M16 101 C16 82 29 74 42 72 Q50 83 58 72 C71 74 84 82 84 101 Z" fill={color} />
          <path d="M34.5 73.5 Q50 90 65.5 73.5 Q68.5 70 63 70.5 Q50 80 37 70.5 Q31.5 70 34.5 73.5 Z" fill={dark} />
          <path d="M45.5 82.5 L44.5 93" stroke={light} strokeWidth="1.5" strokeLinecap="round" />
          <path d="M54.5 82.5 L55.5 93" stroke={light} strokeWidth="1.5" strokeLinecap="round" />
          <path d="M30 101 Q50 91 70 101" stroke={dark} strokeWidth="1.2" fill="none" opacity="0.6" />
        </g>
      );
    case "collar":
      return (
        <g>
          <path d="M16 101 C16 82 29 74 42 72 L50 85 L58 72 C71 74 84 82 84 101 Z" fill={color} />
          <path d="M41 71.5 L50 85 L43.5 87 L35.5 74.5 Z" fill="#fff" />
          <path d="M59 71.5 L50 85 L56.5 87 L64.5 74.5 Z" fill="#fff" />
          <path d="M50 85 V101" stroke={dark} strokeWidth="1" opacity="0.5" />
          <circle cx="50" cy="92" r="0.9" fill={dark} />
          <circle cx="50" cy="97" r="0.9" fill={dark} />
        </g>
      );
    case "jersey":
      return (
        <g>
          <path d="M16 101 C16 82 29 74 42 72 Q50 83 58 72 C71 74 84 82 84 101 Z" fill={color} />
          <path d="M42 72 Q50 83 58 72" stroke="#fff" strokeWidth="2.2" fill="none" />
          <path d="M17.2 90 C17.7 87.5 18.3 85.5 19.3 83.5 L28 87 C26.5 89 25.5 91 25 93 Z" fill="#fff" opacity="0.9" />
          <path d="M82.8 90 C82.3 87.5 81.7 85.5 80.7 83.5 L72 87 C73.5 89 74.5 91 75 93 Z" fill="#fff" opacity="0.9" />
          <text x="50" y="97" textAnchor="middle" fontSize="12" fontWeight="800" fill="#fff" fontFamily="system-ui, sans-serif">
            10
          </text>
        </g>
      );
    case "tank":
      return (
        <g>
          <path d="M16 101 C16 85 28 77 40 74 L60 74 C72 77 84 85 84 101 Z" fill={skin} />
          <path d="M16 101 C16 85 28 77 40 74 L60 74 C72 77 84 85 84 101 Z" fill={neckSkin} opacity="0.35" />
          <path d="M29 101 L33 80 C34.5 75 39 72.5 42 72 Q50 85 58 72 C61 72.5 65.5 75 67 80 L71 101 Z" fill={color} />
        </g>
      );
    case "ankara":
      return (
        <g>
          <clipPath id={patternId}>
            <path d={shirt} />
          </clipPath>
          <path d={shirt} fill={color} />
          <g clipPath={`url(#${patternId})`} fill="#fff" opacity="0.8">
            {[
              [26, 85],
              [38, 92],
              [50, 99],
              [62, 92],
              [74, 85],
              [32, 98],
              [68, 98],
              [50, 84],
            ].map(([x, y]) => (
              <path key={`${x}-${y}`} d={`M${x} ${y - 3.2} L${x + 3.2} ${y} L${x} ${y + 3.2} L${x - 3.2} ${y} Z`} />
            ))}
            {[
              [44, 90],
              [56, 90],
              [32, 80],
              [68, 80],
            ].map(([x, y]) => (
              <circle key={`c-${x}-${y}`} cx={x} cy={y} r="1.4" fill={dark} opacity="0.9" />
            ))}
          </g>
        </g>
      );
    default:
      return <path d={shirt} fill={color} />;
  }
}

function Extra({ extra, hairColor }: { extra: AvatarConfig["extra"]; hairColor: string }) {
  switch (extra) {
    case "glasses":
      return (
        <g stroke={INK} strokeWidth="1.5" fill="rgba(255,255,255,0.14)" strokeLinejoin="round">
          <rect x="36.5" y="41.5" width="11" height="9" rx="3.2" />
          <rect x="52.5" y="41.5" width="11" height="9" rx="3.2" />
          <path d="M47.5 45.5 H52.5" fill="none" />
          <path d="M36.5 44.5 L33.5 43.5 M63.5 44.5 L66.5 43.5" fill="none" />
        </g>
      );
    case "round":
      return (
        <g stroke={shade(INK, 0.1)} strokeWidth="1.5" fill="rgba(255,255,255,0.14)">
          <circle cx="43" cy="46" r="5.6" />
          <circle cx="57" cy="46" r="5.6" />
          <path d="M48.6 45.2 Q50 44.2 51.4 45.2" fill="none" />
        </g>
      );
    case "shades":
      return (
        <g>
          <path d="M35.5 42.5 H64.5 L63.5 47.5 Q62.5 51.5 58 51.5 Q53.5 51.5 52.5 47.5 Q50 46 47.5 47.5 Q46.5 51.5 42 51.5 Q37.5 51.5 36.5 47.5 Z" fill={INK} />
          <path d="M38.5 44 L41.5 44 M54.5 44 L57.5 44" stroke="#fff" strokeWidth="1" strokeLinecap="round" opacity="0.55" />
        </g>
      );
    case "headphones":
      return (
        <g>
          <path d="M31.5 46 C30 22 70 22 68.5 46" stroke="#171717" strokeWidth="3.4" strokeLinecap="round" fill="none" />
          <rect x="27.2" y="43.5" width="7" height="13" rx="3.5" fill="#171717" />
          <rect x="65.8" y="43.5" width="7" height="13" rx="3.5" fill="#171717" />
          <rect x="28.6" y="46" width="2.4" height="8" rx="1.2" fill={hairColor === "#FF7A1A" ? "#fff" : "#FF7A1A"} />
          <rect x="69" y="46" width="2.4" height="8" rx="1.2" fill={hairColor === "#FF7A1A" ? "#fff" : "#FF7A1A"} />
        </g>
      );
    case "earrings":
      return (
        <g fill="#F5B82E" stroke="#B8860B" strokeWidth="0.5">
          <circle cx="33" cy="54" r="2" />
          <circle cx="67" cy="54" r="2" />
        </g>
      );
    default:
      return null;
  }
}

export type AvatarProps = {
  /** A saved config, or anything — an unusable value falls back to a face derived from `seed`. */
  config?: unknown;
  /** Stable text for the fallback face — usually the student's name. */
  seed?: string;
  /** Pixel size. The avatar is always square; round it with `rounded`. */
  size?: number;
  /** Round (chat, profile) or a soft square (tiles). */
  shape?: "circle" | "squircle";
  className?: string;
  title?: string;
  /** Something laid over the bottom-right corner — a status dot, an edit pencil. */
  children?: ReactNode;
};

export default function Avatar({ config, seed = "", size = 40, shape = "circle", className = "", title, children }: AvatarProps) {
  const a = avatarOrDefault(config, seed);
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");

  const skin = SKIN_TONES[a.skin];
  const hair = HAIR_COLORS[a.hairColor];
  const topColor = TOP_COLORS[a.topColor];
  const browColor = a.hair === "headwrap" || a.hair === "cap" || a.hair === "bald" ? shade(skin, -0.55) : shade(hair, -0.1);

  return (
    <span
      className={`relative inline-block shrink-0 ${className}`}
      style={{ width: size, height: size }}
      role="img"
      aria-label={title ?? "Avatar"}
    >
      <span className={`block h-full w-full overflow-hidden ${shape === "circle" ? "rounded-full" : "rounded-[28%]"}`}>
        <svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true" focusable="false">
          <rect width="100" height="100" fill={BACKGROUNDS[a.bg]} />
          <circle cx="50" cy="112" r="58" fill="#fff" opacity="0.13" />

          {/* The figure is drawn on a roomy 100-unit canvas; this scales it up so
              the face fills the circle, the way a chat avatar has to. */}
          <g transform="translate(50 57) scale(1.18) translate(-50 -57)">
            <BackHair style={a.hair} color={hair} />

            <circle cx="33" cy="47.5" r="4.2" fill={skin} />
            <circle cx="67" cy="47.5" r="4.2" fill={skin} />
            <rect x="44" y="58" width="12" height="20" rx="4" fill={shade(skin, -0.14)} />

            <Outfit top={a.top} color={topColor} skin={skin} patternId={`${uid}p`} />

            <ellipse cx="50" cy="46" rx="17" ry="19.5" fill={skin} />
            <circle cx="40" cy="54" r="3.6" fill="#E8556D" opacity="0.16" />
            <circle cx="60" cy="54" r="3.6" fill="#E8556D" opacity="0.16" />

            <path d="M49.2 48.5 Q52.2 52.8 49 53.4" stroke={shade(skin, -0.28)} strokeWidth="1.3" strokeLinecap="round" fill="none" />
            <Eyes style={a.eyes} />
            <Brows style={a.brows} color={browColor} />
            <Mouth style={a.mouth} />

            <FrontHair style={a.hair} color={hair} />
            <Extra extra={a.extra} hairColor={hair} />
          </g>
        </svg>
      </span>
      {children}
    </span>
  );
}
