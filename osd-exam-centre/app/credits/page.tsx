import Image, { type StaticImageData } from "next/image";
import { SiteFooter } from "@/components/SiteChrome";
import PageHero from "@/components/PageHero";
import hero from "@/assets/images/hero-hallstatt.jpg";
import vienna from "@/assets/images/vienna.jpg";
import berlin from "@/assets/images/berlin.jpg";
import heidelberg from "@/assets/images/heidelberg.jpg";
import matterhorn from "@/assets/images/matterhorn.jpg";
import neuschwanstein from "@/assets/images/neuschwanstein.jpg";
import munich from "@/assets/images/munich.jpg";
import credits from "@/lib/photo-credits.generated.json";

export const metadata = { title: "Photo credits — Easyway ÖSD Examination Centre" };

const THUMBS: Record<string, StaticImageData> = {
  "hero-hallstatt": hero,
  vienna,
  berlin,
  heidelberg,
  matterhorn,
  neuschwanstein,
  munich,
};

export default function CreditsPage() {
  return (
    <div className="min-h-screen">
      <PageHero
        eyebrow="Photography"
        title="Photo credits"
        subtitle="The photographs on this site are the work of these photographers, shared under open licences. Thank you."
        image={heidelberg}
        alt="Aerial view of Heidelberg's old town, the Neckar river and its castle"
        position="object-[50%_60%]"
      />
      <main className="relative z-10 mx-auto -mt-14 max-w-3xl px-5 pb-20 sm:px-6">
        <ul className="divide-y divide-[var(--line)] overflow-hidden rounded-2xl bg-white shadow-xl shadow-[var(--navy)]/15 ring-1 ring-black/5">
          {credits.map((c) => (
            <li key={c.file} className="flex gap-4 p-4 sm:p-5">
              <div className="relative h-20 w-28 shrink-0 overflow-hidden rounded-lg bg-[var(--navy)]">
                {THUMBS[c.file] && <Image src={THUMBS[c.file]} alt="" fill sizes="112px" className="object-cover" />}
              </div>
              <div className="min-w-0 text-sm">
                <p className="font-semibold text-[var(--navy)]">{c.place}</p>
                <p className="mt-0.5 text-[var(--ink-soft)]">
                  Photo by {c.author} ·{" "}
                  {c.licenseUrl ? (
                    <a href={c.licenseUrl} className="underline" target="_blank" rel="noopener noreferrer">{c.license}</a>
                  ) : (
                    c.license
                  )}{" "}
                  ·{" "}
                  <a href={c.sourceUrl} className="underline" target="_blank" rel="noopener noreferrer">Wikimedia Commons</a>
                </p>
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-6 text-xs leading-relaxed text-[var(--ink-soft)]">
          Images were resized and cropped, and colour gradients were layered over them for legibility. Licences
          are linked above; CC0 images are dedicated to the public domain.
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
