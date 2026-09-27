import Image, { type StaticImageData } from "next/image";
import heidelberg from "@/assets/images/heidelberg.jpg";
import berlin from "@/assets/images/berlin.jpg";
import vienna from "@/assets/images/vienna.jpg";
import matterhorn from "@/assets/images/matterhorn.jpg";
import { BriefcaseIcon, GradCapIcon, HomeIcon, MountainIcon } from "@/components/icons";

type Destination = {
  tag: string;
  Icon: (p: { className?: string }) => React.ReactElement;
  city: string;
  country: string;
  img: StaticImageData;
  alt: string;
  position: string;
  line: string;
};

const DESTINATIONS: Destination[] = [
  {
    tag: "Study",
    Icon: GradCapIcon,
    city: "Heidelberg",
    country: "Germany",
    img: heidelberg,
    alt: "Aerial view of Heidelberg's old town, the Neckar river and its castle",
    position: "object-[50%_60%]",
    line: "Universities in the German-speaking world ask for proof of German — most often at B2 or C1.",
  },
  {
    tag: "Work",
    Icon: BriefcaseIcon,
    city: "Berlin",
    country: "Germany",
    img: berlin,
    alt: "The Brandenburg Gate in Berlin under a soft evening sky",
    position: "object-[50%_50%]",
    line: "Skilled-worker and healthcare routes often require a recognised certificate at a set level.",
  },
  {
    tag: "Live",
    Icon: HomeIcon,
    city: "Vienna",
    country: "Austria",
    img: vienna,
    alt: "Vienna's modern skyline reflected in the water at sunset",
    position: "object-[38%_50%]",
    line: "Settle in and build a life in German — proven with Austria's own language diploma, the ÖSD.",
  },
  {
    tag: "Explore",
    Icon: MountainIcon,
    city: "The Alps",
    country: "Switzerland",
    img: matterhorn,
    alt: "The Matterhorn glowing pink and orange at sunset",
    position: "object-[38%_40%]",
    line: "One language, three countries — and the mountains in between.",
  },
];

export default function Destinations() {
  return (
    <section className="relative overflow-hidden px-5 pb-20 pt-16 sm:px-6 sm:pb-24 sm:pt-20">
      <div className="mx-auto max-w-6xl">
        <div className="reveal max-w-2xl">
          <p className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.35em] text-[var(--gold)]">
            <span className="h-px w-8 bg-[var(--gold)]" />
            Why sit the ÖSD
          </p>
          <h2 className="font-serif-display mt-4 text-balance text-3xl font-semibold leading-tight text-[var(--navy)] sm:text-5xl">
            Where your German can take you
          </h2>
          <p className="mt-4 text-base leading-relaxed text-[var(--ink-soft)]">
            A recognised certificate is the passport to a degree, a career and a new home across Germany,
            Austria and Switzerland.
          </p>
        </div>

        <div className="-mx-5 mt-10 flex snap-x snap-mandatory gap-4 overflow-x-auto px-5 pb-4 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 lg:grid-cols-4">
          {DESTINATIONS.map(({ tag, Icon, city, country, img, alt, position, line }) => (
            <article
              key={city}
              className="reveal card-lift group relative aspect-[3/4] min-w-[78%] snap-center overflow-hidden rounded-2xl bg-[var(--navy)] sm:min-w-0"
            >
              <Image
                src={img}
                alt={alt}
                fill
                placeholder="blur"
                sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 78vw"
                className={`object-cover ${position} transition duration-[900ms] ease-out group-hover:scale-105`}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#071328] via-[#071328]/35 to-transparent" />
              <div className="absolute inset-x-0 bottom-0 p-5 text-white">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider backdrop-blur">
                  <Icon className="h-3.5 w-3.5 text-[var(--gold-bright)]" />
                  {tag}
                </span>
                <h3 className="font-serif-display mt-3 text-2xl font-semibold">{city}</h3>
                <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-[var(--gold-bright)]">{country}</p>
                <p className="mt-2 text-sm leading-relaxed text-white/80">{line}</p>
              </div>
            </article>
          ))}
        </div>

        <p className="mt-6 text-xs text-[var(--ink-soft)]">
          Requirements differ by route and authority — always confirm the level your application needs.
        </p>
      </div>
    </section>
  );
}
