"use client";

import { useState } from "react";
import Mascot, { type MascotMood } from "@/components/Mascot";


/**
 * Every face, side by side. Development only.
 *
 * A character with eleven expressions cannot be reviewed one page at a time —
 * the whole question is whether `frowning` and `concerned` read as different
 * things, and whether the set looks like one character in eleven moods rather
 * than eleven drawings. That is only answerable with them all on screen.
 */
const MOODS: MascotMood[] = [
  "greeting", "happy", "cheerful", "smiling", "thinking", "curious",
  "proud", "frowning", "angry", "concerned", "celebrating",
  "tired", "presenting", "cocky", "stern",
];

export default function MascotGallery() {
  const [pointing, setPointing] = useState(false);
  const [walking, setWalking] = useState(false);

  // Never reachable in production: the route is removed before deploy.
  if (process.env.NODE_ENV === "production") return null;

  return (
    <div className="min-h-screen bg-[var(--background)] p-8 text-[var(--foreground)]">
      <h1 className="text-2xl font-bold">Mascot — every mood</h1>
      <div className="mt-4 flex gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={pointing} onChange={(e) => setPointing(e.target.checked)} /> pointing arm
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={walking} onChange={(e) => setWalking(e.target.checked)} /> walking
        </label>
      </div>

      <div className="mt-8 grid grid-cols-2 gap-6 sm:grid-cols-4 lg:grid-cols-6">
        {MOODS.map((mood) => (
          <div key={mood} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 text-center">
            <Mascot
              mood={mood}
              walking={walking}
              pointAngle={pointing ? -20 : null}
              className="mx-auto h-32 w-32"
            />
            <p className="mt-1 text-xs font-bold uppercase tracking-wider text-[var(--muted)]">{mood}</p>
          </div>
        ))}
      </div>

      {/* The size it actually ships at in the signup header. If it does not
          read here it does not read at all. */}
      <h2 className="mt-10 text-lg font-semibold">At 64px — the real signup size</h2>
      <div className="mt-3 flex flex-wrap gap-3">
        {MOODS.map((mood) => (
          <div key={mood} className="rounded-xl bg-[#0D7C7E] p-2">
            <Mascot mood={mood} className="h-16 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}
