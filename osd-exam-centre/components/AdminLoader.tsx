import Image from "next/image";
import easywayLogo from "@/assets/brand/easyway-logo.png";
import osdLogo from "@/assets/brand/osd-logo.png";

/**
 * The admin "Loading…" state, reimagined as the two accredited parties
 * taking turns — a card that flips in 3D between the Easyway lockup and the
 * ÖSD seal, with a soft two-tone glow (Easyway orange, ÖSD blue) pulsing at
 * the exact moment each one turns to face forward, and a blurred aura of
 * the same two colours slowly orbiting behind it. No caption — at this size
 * the logo itself is the whole point, text just crowded it.
 */
export default function AdminLoader() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="relative grid h-56 w-80 place-items-center">
        <div className="seal-aura absolute inset-[-56px] rounded-full" aria-hidden="true" />
        <div className="seal-glow relative h-44 w-72 rounded-3xl bg-white shadow-xl" style={{ perspective: "900px" }}>
          <div className="seal-coin relative h-full w-full">
            <div className="seal-face absolute inset-0 grid place-items-center rounded-3xl p-10">
              <Image src={easywayLogo} alt="Easyway German Language School" className="h-full w-auto object-contain" priority />
            </div>
            <div className="seal-face seal-face-back absolute inset-0 grid place-items-center rounded-3xl p-12">
              <Image src={osdLogo} alt="ÖSD — Licensed Examination Centre" className="h-full w-auto object-contain" priority />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
