"use client";

import Avatar from "@/components/Avatar";
import {
  BROW_STYLES,
  EXTRAS,
  EYE_STYLES,
  HAIR_STYLES,
  MOUTH_STYLES,
  TOP_STYLES,
  SKIN_TONES,
  hashAvatar,
  type AvatarConfig,
} from "@/lib/avatar";

/**
 * Every avatar choice side by side. Development only.
 *
 * Like /dev-mascot: whether the set reads as one art style, and whether each
 * hair or outfit is recognisable at 56px, is only answerable with them all on
 * screen at once.
 */
const BASE: AvatarConfig = { ...hashAvatar("gallery"), skin: 4, hair: "fade", hairColor: 0, bg: 0, extra: "none", mouth: "smile", eyes: "round", brows: "soft", top: "tee", topColor: 3 };

function Row<T extends string>({ title, keys, make }: { title: string; keys: readonly T[]; make: (k: T) => AvatarConfig }) {
  return (
    <section className="mt-6">
      <h2 className="text-xs font-bold uppercase tracking-widest text-[var(--muted)]">{title}</h2>
      <div className="mt-2 flex flex-wrap gap-3">
        {keys.map((k) => (
          <div key={k} className="text-center text-[10px] text-[var(--muted)]">
            <Avatar config={make(k)} size={104} />
            <div className="mt-1">{k}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function AvatarGallery() {
  if (process.env.NODE_ENV === "production") return null;

  return (
    <div className="min-h-screen bg-[var(--surface)] p-6 text-[var(--foreground)]">
      <h1 className="text-2xl font-bold">Avatar — every choice</h1>

      <Row title="Hair" keys={HAIR_STYLES} make={(hair) => ({ ...BASE, hair, hairColor: hair === "headwrap" || hair === "cap" ? 3 : 0 })} />
      <Row title="Skin" keys={SKIN_TONES.map((_, i) => String(i))} make={(i) => ({ ...BASE, skin: Number(i), hair: "afro" })} />
      <Row title="Eyes" keys={EYE_STYLES} make={(eyes) => ({ ...BASE, eyes })} />
      <Row title="Brows" keys={BROW_STYLES} make={(brows) => ({ ...BASE, brows })} />
      <Row title="Mouth" keys={MOUTH_STYLES} make={(mouth) => ({ ...BASE, mouth })} />
      <Row title="Outfit" keys={TOP_STYLES} make={(top) => ({ ...BASE, top, topColor: top === "collar" ? 2 : 3 })} />
      <Row title="Extras" keys={EXTRAS} make={(extra) => ({ ...BASE, extra, hair: extra === "headphones" ? "puffs" : "fade" })} />

      <section className="mt-8">
        <h2 className="text-xs font-bold uppercase tracking-widest text-[var(--muted)]">Fallback faces from names</h2>
        <div className="mt-2 flex flex-wrap gap-3">
          {["Ada Okafor", "Chidi", "Kemi A.", "Tunde", "Ngozi", "Sade", "Emeka", "Funmi", "Jason", "Becca", "Ife", "Bola", "Zainab", "Obi", "Yemi", "Tola"].map((n) => (
            <Avatar key={n} seed={n} size={64} title={n} />
          ))}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-xs font-bold uppercase tracking-widest text-[var(--muted)]">Sizes</h2>
        <div className="mt-2 flex items-end gap-3">
          {[20, 28, 36, 48, 72, 128].map((s) => (
            <Avatar key={s} config={BASE} size={s} />
          ))}
          <Avatar config={BASE} size={72} shape="squircle" />
        </div>
      </section>
    </div>
  );
}
