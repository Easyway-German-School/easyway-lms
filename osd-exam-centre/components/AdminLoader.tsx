import Image from "next/image";
import easywayLogo from "@/assets/brand/easyway-logo.png";
import osdLogo from "@/assets/brand/osd-logo.png";

/**
 * The admin "Loading…" state, reimagined as the two accredited parties
 * taking turns — a card that flips in 3D between the Easyway lockup and the
 * ÖSD seal, with a soft two-tone glow (Easyway orange, ÖSD blue) pulsing at
 * the exact moment each one turns to face forward, and a blurred aura of
 * the same two colours slowly orbiting behind it. Same spirit as the LMS's
 * own BrandLoader (counter-rotating rings, bilingual rotating captions),
 * built for this app's two-brand badge rather than one.
 */
export default function AdminLoader({ label = true }: { label?: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16">
      <div className="relative grid h-24 w-44 place-items-center">
        <div className="seal-aura absolute inset-[-28px] rounded-full" aria-hidden="true" />
        <div className="seal-glow relative h-20 w-40 rounded-2xl bg-white shadow-lg" style={{ perspective: "700px" }}>
          <div className="seal-coin relative h-full w-full">
            <div className="seal-face absolute inset-0 grid place-items-center rounded-2xl p-3">
              <Image src={easywayLogo} alt="Easyway German Language School" className="h-full w-auto object-contain" priority />
            </div>
            <div className="seal-face seal-face-back absolute inset-0 grid place-items-center rounded-2xl p-4">
              <Image src={osdLogo} alt="ÖSD — Licensed Examination Centre" className="h-full w-auto object-contain" priority />
            </div>
          </div>
        </div>
      </div>
      {label && (
        <div className="relative h-5 text-center text-sm text-[var(--ink-soft)]">
          <span className="seal-caption-a absolute inset-x-0">Loading the office…</span>
          <span className="seal-caption-b absolute inset-x-0">Einen Moment, bitte…</span>
        </div>
      )}
    </div>
  );
}
