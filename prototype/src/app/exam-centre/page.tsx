import BrandLogo from "@/components/BrandLogo";
import PortalShell from "@/components/PortalShell";
import ExamBodyComingSoon from "@/components/ExamBodyComingSoon";
import { ExternalLinkIcon } from "@/components/icons";

/** Same reasoning as MyExamsPanel: Goethe booking happens entirely on
 * goethe.de, so this is a plain outbound link rather than something routed
 * through our own booking flow. */
const GOETHE_REGISTRATION_URL = "https://www.goethe.de/ins/ng/en/m/spr/prf/anm.html";

/**
 * Public exam centre.
 *
 * This page's whole reason to exist was walk-in ÖSD/telc booking for members
 * of the public — a signed-in student books EasyWay's own exams from
 * `MyExamsPanel` inside the portal instead. Since that walk-in booking isn't
 * live yet (see `ExamBodyComingSoon`), the page is the locked state, not a
 * form pointed at a fee and a link that don't exist.
 */
export default function ExamCentrePage() {
  return (
    <PortalShell public>
      <div className="min-h-screen bg-[linear-gradient(135deg,_#f7faff_0%,_#fffbf8_100%)]">
        <div className="mx-auto max-w-4xl px-6 py-12">
          <BrandLogo variant="wordmark" className="h-10" />

          <div className="mt-8">
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">Examination centre</p>
            <h1 className="mt-2 text-4xl font-bold">Book your German exam</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--muted)]">
              EasyWay is preparing to sit candidates for ÖSD and telc directly, open to anyone — not only enrolled
              students.
            </p>
          </div>

          <div className="mt-8">
            <ExamBodyComingSoon exploreHref="/programs" />
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-[var(--border)] bg-white p-6 shadow-[var(--shadow)]">
            <div className="min-w-0">
              <h3 className="font-semibold">Prefer to sit Goethe instead?</h3>
              <p className="mt-1 text-sm text-[var(--muted)]">
                Registration and fees for the Goethe-Zertifikat are handled entirely by the Goethe-Institut, not
                EasyWay — this takes you straight to their official booking page.
              </p>
            </div>
            <a
              href={GOETHE_REGISTRATION_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex shrink-0 items-center gap-2 rounded-full btn-glow px-5 py-2.5 text-sm font-semibold text-white"
            >
              Register on goethe.de <ExternalLinkIcon className="h-4 w-4" />
            </a>
          </div>
        </div>
      </div>
    </PortalShell>
  );
}
