import BrandLogo from "@/components/BrandLogo";
import PortalShell from "@/components/PortalShell";
import ExamBodyComingSoon from "@/components/ExamBodyComingSoon";

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
        </div>
      </div>
    </PortalShell>
  );
}
