import Link from "next/link";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <section className="rounded-3xl border border-slate-800 bg-slate-900/80 p-8 shadow-2xl shadow-black/30">
          <p className="text-sm uppercase tracking-[0.28em] text-emerald-400">EasyWay LMS</p>
          <h1 className="mt-4 text-4xl font-semibold text-white">Welcome to the EasyWay community hub</h1>
          <p className="mt-4 text-slate-300">This page links into your main community experience and gives learners a stable entrypoint without 404s.</p>
          <div className="mt-8 rounded-3xl bg-slate-950/90 p-6 shadow-inner shadow-black/20">
            <h2 className="text-xl font-semibold text-white">Quick access</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Link href="/community" className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-4 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-500/15">Community hub</Link>
              <Link href="/" className="rounded-2xl border border-slate-700 bg-slate-800 px-4 py-4 text-sm font-semibold text-slate-200 transition hover:bg-slate-700">Home</Link>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
