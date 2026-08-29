"use client";

/**
 * WHO IS TALKING, WHO IS WAITING, AND WHO MAY SPEAK — on the tiles themselves.
 *
 * All three of these facts already existed in the classroom. The problem was
 * where they were said: the floor was announced in a banner above the video,
 * and the hand queue in a side panel that is closed by default and invisible on
 * a phone. So the tutor had to read a name in one place and find the matching
 * rectangle in another, twice a minute, while teaching.
 *
 * These put the answer on the face it is about. The green light is one element
 * that TRAVELS between tiles rather than one per tile switching on and off —
 * `layoutId` is what makes framer-motion animate it across the grid — because a
 * light that moves is a thing you can follow out of the corner of your eye, and
 * a light that blinks somewhere else is a thing you have to search for.
 */

import { motion } from "framer-motion";
import { HandIcon } from "@/components/icons";
import { useAudioLevel, type AudioLevelStore } from "./useAudioLevels";

/**
 * Bar weights, not a flat row.
 *
 * A meter whose bars all move together reads as a progress bar. Weighting them
 * — tall in the middle, short at the edges — makes one level look like a
 * waveform, which is what the shape is telling you: somebody is making a sound.
 * There is deliberately no per-bar frequency data behind it. The analyser
 * reports one volume, and five bars pretending to be a spectrum analyser would
 * be a drawing of information we do not have.
 */
const BAR_WEIGHTS = [0.55, 0.85, 1, 0.8, 0.5];

export function SpeakingWave({
  store,
  identity,
  size = "sm",
}: {
  store: AudioLevelStore;
  identity: string;
  size?: "sm" | "lg";
}) {
  const level = useAudioLevel(store, identity);
  const big = size === "lg";

  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-end gap-[2px] ${big ? "h-5" : "h-3.5"}`}
    >
      {BAR_WEIGHTS.map((weight, index) => {
        // 14% is the resting height. Bars that collapse to nothing when the
        // room goes quiet make the meter disappear, and a meter that vanishes
        // between sentences looks like the connection dropped.
        const height = Math.max(0.14, Math.min(1, level * weight * 1.35));
        return (
          <span
            key={index}
            className={`block rounded-full bg-emerald-400 ${big ? "w-[3px]" : "w-[2px]"}`}
            style={{
              height: `${height * 100}%`,
              // Matches the store's tick, so the bars glide between readings
              // instead of stepping. Height rather than transform: these are
              // three pixels wide and a scaled 3px bar blurs. Opacity gets its
              // own, slower transition — without it, a level hovering right at
              // the 0.02 cutoff snapped between the two opacities every tick,
              // which read as a flicker even though the height was smooth.
              transition: "height 90ms linear, opacity 200ms ease-out",
              opacity: level > 0.02 ? 1 : 0.35,
            }}
          />
        );
      })}
    </span>
  );
}

/**
 * THE GREEN LIGHT.
 *
 * Exactly one of these is rendered in the whole classroom, inside whichever
 * tile currently holds the floor. Because every instance shares a `layoutId`,
 * moving it from one tile to another animates it across the screen rather than
 * teleporting — which is the entire feature. The tutor sees the light leave one
 * cubicle and arrive at another; nobody has to read a name to know the turn
 * changed.
 *
 * `layout` on the inner span keeps the pill's own width animating when the
 * label changes length, so a short name growing into a long one does not snap.
 */
export function FloorLight({ label, tone }: { label: string; tone: "floor" | "speaking" }) {
  const granted = tone === "floor";

  return (
    <motion.div
      layoutId="classroom-floor-light"
      transition={{ type: "spring", stiffness: 320, damping: 30 }}
      className={`pointer-events-none absolute left-2 top-2 z-10 flex items-center gap-1.5 rounded-full px-2.5 py-1 shadow-lg backdrop-blur-sm ${
        granted ? "bg-emerald-500 text-white" : "bg-emerald-500/25 text-emerald-100"
      }`}
    >
      <span className="relative flex h-2 w-2 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-300 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-300" />
      </span>
      <motion.span layout className="whitespace-nowrap text-[10px] font-bold uppercase tracking-wide">
        {label}
      </motion.span>
    </motion.div>
  );
}

/**
 * A raised hand, on the face that raised it.
 *
 * The number is the queue position, and it is the whole reason this is not just
 * an icon: "third" is what stops a student raising their hand again, and it is
 * what lets a tutor honour the order without opening the panel to check it.
 */
export function HandFlag({ position }: { position: number | null }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.6, y: -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.6 }}
      className="pointer-events-none absolute right-2 top-2 z-10 flex items-center gap-1 rounded-full bg-amber-400 px-2 py-1 text-slate-900 shadow-lg"
    >
      <HandIcon className="h-3 w-3" strokeWidth={2.4} />
      {position ? <span className="text-[10px] font-bold leading-none">{position}</span> : null}
    </motion.div>
  );
}
