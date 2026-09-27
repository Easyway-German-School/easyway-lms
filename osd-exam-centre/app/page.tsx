import { SiteFooter } from "@/components/SiteChrome";
import Hero from "@/components/home/Hero";
import Marquee from "@/components/home/Marquee";
import Destinations from "@/components/home/Destinations";
import LevelsStrip from "@/components/home/LevelsStrip";
import DeparturesBoard from "@/components/home/DeparturesBoard";
import HowItWorks from "@/components/home/HowItWorks";
import ExamDayEssentials from "@/components/home/ExamDayEssentials";
import PrepBanner from "@/components/home/PrepBanner";

// Statically generated, but re-rendered hourly so payment-option copy
// (which depends on env vars) catches up after a config change.
export const revalidate = 3600;

export default function HomePage() {
  return (
    <div className="min-h-screen">
      <main>
        <Hero />
        <Marquee />
        <Destinations />
        <LevelsStrip />
        <DeparturesBoard />
        <HowItWorks />
        <ExamDayEssentials />
        <PrepBanner />
      </main>
      <SiteFooter />
    </div>
  );
}
