import Image from "next/image";
import Link from "next/link";
import hero from "@/assets/images/hero-hallstatt.jpg";
import { SiteHeader } from "@/components/SiteChrome";
import { ArrowRightIcon, BankIcon, CardIcon, SeatIcon, ShieldCheckIcon } from "@/components/icons";
import { cardPaymentsEnabled } from "@/lib/payments";
import NextSittingCard from "./NextSittingCard";

export default function Hero() {
  // Only advertise what is actually switched on: the card option appears the
  // moment FLUTTERWAVE_SECRET_KEY is set (the page is re-rendered hourly).
  const cards = cardPaymentsEnabled();
  const PROMISES = [
    { icon: ShieldCheckIcon, text: "ÖSD-accredited centre" },
    { icon: SeatIcon, text: "Seat reserved automatically" },
    cards
      ? { icon: CardIcon, text: "Bank transfer or international card" }
      : { icon: BankIcon, text: "Simple bank-transfer payment" },
  ];

  return (
    <section className="relative isolate flex min-h-[92svh] flex-col overflow-hidden text-white">
      {/* Photography + layered gradients: dusk from above, a heavier wash on the
          text side, and a fade into the page below. */}
      <div className="absolute inset-0 -z-10 bg-[var(--navy-deep)]">
        <Image
          src={hero}
          alt="Hallstatt, Austria, mirrored in a still alpine lake at dawn"
          fill
          preload
          placeholder="blur"
          sizes="100vw"
          className="kenburns object-cover object-[72%_18%] lg:object-[62%_18%]"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#071328]/50 via-[#071328]/58 to-[#071328]/95 lg:from-[#071328]/60 lg:via-transparent lg:to-[#071328]/90" />
        <div className="absolute inset-0 hidden bg-gradient-to-r from-[#071328]/85 via-[#071328]/50 via-60% to-transparent lg:block" />
        <div className="grain absolute inset-0" />
      </div>

      <SiteHeader variant="overlay" />

      <div className="mx-auto flex w-full max-w-6xl flex-1 items-center px-5 pb-28 pt-32 sm:px-6 lg:pt-36">
        <div className="grid w-full items-center gap-12 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <p className="fade-up flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.35em] text-[var(--gold-bright)]">
              <span className="h-px w-8 bg-[var(--gold-bright)]" />
              ÖSD Prüfungszentrum · Lagos
            </p>
            <h1 className="font-serif-display fade-up delay-1 mt-5 text-[2.3rem] font-semibold leading-[1.06] tracking-tight sm:text-6xl lg:text-[4.2rem]">
              Your German exam in Lagos.{" "}
              <span className="gold-text">Your future in the German&#8209;speaking world.</span>
            </h1>
            <p className="fade-up delay-2 mt-6 max-w-xl text-base leading-relaxed text-white/90 [text-shadow:0_1px_14px_rgba(7,19,40,0.7)] sm:text-lg">
              Easyway is Nigeria&apos;s ÖSD-accredited examination centre — a certificate recognised across
              Germany, Austria and Switzerland. Book your sitting online and your seat is reserved automatically.
            </p>

            <div className="fade-up delay-3 mt-9 flex flex-wrap items-center gap-4">
              <Link
                href="/book"
                className="group inline-flex items-center gap-2 rounded-full bg-[var(--gold-bright)] px-8 py-3.5 text-sm font-semibold text-[var(--navy-deep)] shadow-xl shadow-black/30 transition hover:brightness-110"
              >
                Book your exam
                <ArrowRightIcon className="h-4 w-4 transition group-hover:translate-x-1" />
              </Link>
              <Link
                href="/status"
                className="rounded-full border border-white/35 bg-white/5 px-8 py-3.5 text-sm font-semibold text-white backdrop-blur transition hover:bg-white/15"
              >
                Check my booking
              </Link>
            </div>

            <ul className="fade-up delay-4 mt-10 flex flex-wrap gap-x-7 gap-y-3 text-sm text-white/80">
              {PROMISES.map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-center gap-2">
                  <Icon className="h-[18px] w-[18px] text-[var(--gold-bright)]" />
                  {text}
                </li>
              ))}
            </ul>
          </div>

          <NextSittingCard />
        </div>
      </div>
    </section>
  );
}
