import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { homePathForRole } from "@/lib/portal";

export default async function HomePage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return (
      <main className="min-h-screen bg-[linear-gradient(135deg,_#f5f5f5_0%,_#fffbf8_100%)] px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-6xl flex-col overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-[0_30px_80px_-24px_rgba(13,124,126,0.35)] lg:flex-row">
          <div className="flex-1 bg-gradient-to-br from-[#0D7C7E] to-[#14525f] p-8 text-white sm:p-10 lg:p-12">
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-white/90">Easyway German School</p>
            <h1 className="mt-4 text-3xl font-semibold leading-tight sm:text-4xl">Learn German with a platform built for relocation success.</h1>
            <p className="mt-4 max-w-xl text-sm leading-7 text-white/80 sm:text-base">
              A complete academic experience for learners preparing to move to Germany. Track your progress, join live classes, and prepare for exams with confidence.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/auth/signup" className="rounded-2xl bg-[#FF6600] px-5 py-3 text-sm font-semibold text-white shadow-lg transition hover:-translate-y-0.5 hover:bg-[#FF7722]">
                Register now
              </Link>
              <Link href="/auth/signin" className="rounded-2xl border border-white/30 bg-white/10 px-5 py-3 text-sm font-semibold text-white backdrop-blur transition hover:bg-white/20">
                Sign in
              </Link>
            </div>
          </div>
          <div className="flex-1 p-8 sm:p-10 lg:p-12">
            <div className="rounded-[24px] border border-slate-200 bg-[#F8FBFF] p-6 shadow-sm">
              <h2 className="text-xl font-semibold text-[#333333]">What you get</h2>
              <ul className="mt-4 space-y-3 text-sm text-slate-600">
                {[
                  { title: 'Relocation-ready lessons', detail: 'German classes designed for everyday life, work, and visa success.' },
                  { title: 'Live conversation labs', detail: 'Practice speaking with instructors and small peer groups.' },
                  { title: 'Exam preparation', detail: 'Structured A1–B2 support for Goethe, TELC, and OSD exams.' },
                  { title: 'Progress tracking', detail: 'Visual learning milestones with weekly performance insights.' },
                ].map((feature) => (
                  <li key={feature.title} className="rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
                    <p className="text-sm font-semibold text-[#333333]">{feature.title}</p>
                    <p className="mt-1 text-sm text-slate-500">{feature.detail}</p>
                  </li>
                ))}
              </ul>
            </div>
            <div className="mt-8 rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Why Easyway</p>
              <h2 className="mt-3 text-2xl font-semibold text-[#333333]">Move with confidence, speak with ease.</h2>
              <p className="mt-4 text-sm leading-6 text-slate-600">
                Easyway helps learners build real German communication skills, the academic discipline for exams, and the cultural readiness needed for relocation.
              </p>
            </div>
          </div>
        </div>
        {process.env.NODE_ENV === 'development' ? (
          <div className="mx-auto mt-8 max-w-6xl rounded-[32px] border border-slate-200 bg-white p-6 shadow-[0_30px_80px_-24px_rgba(0,48,135,0.35)]">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Developer Navigation</p>
            <h2 className="mt-3 text-xl font-semibold text-[#111827]">Quick access to implemented pages</h2>
            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[
                { href: '/auth/signin', label: 'Login' },
                { href: '/auth/signup', label: 'Signup' },
                { href: '/dashboard', label: 'Dashboard' },
                { href: '/profile', label: 'Profile' },
                { href: '/materials', label: 'Materials' },
              ].map((item) => (
                <Link key={item.href} href={item.href} className="rounded-2xl border border-slate-200 bg-[#F8FBFF] px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-blue-200 hover:bg-white">
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
        ) : null}
      </main>
    );
  }

  // Admins used to land here too, on a page built for tutors. They now go to
  // their own portal, and tutors go to the real tutor dashboard rather than
  // the original demo page that used to live at `/lecturer`.
  redirect(homePathForRole((session.user as { role?: string } | undefined)?.role));
}
