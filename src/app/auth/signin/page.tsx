import Link from "next/link";

export default function SignInPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-8">
      <div className="mx-auto max-w-2xl rounded-3xl border border-slate-800 bg-slate-900/80 p-10 shadow-2xl shadow-black/30">
        <p className="text-sm uppercase tracking-[0.28em] text-emerald-400">Sign in</p>
        <h1 className="mt-4 text-3xl font-semibold text-white">Access your EasyWay account</h1>
        <p className="mt-3 text-slate-300">This page is a placeholder for the actual NextAuth sign-in flow.</p>
        <div className="mt-8 space-y-4">
          <Link href="/" className="block rounded-2xl border border-slate-700 bg-slate-800 px-5 py-3 text-center text-sm font-semibold text-slate-200 hover:bg-slate-700">Return home</Link>
          <Link href="/dashboard" className="block rounded-2xl border border-emerald-500 bg-emerald-500/10 px-5 py-3 text-center text-sm font-semibold text-emerald-200 hover:bg-emerald-500/20">Go to dashboard</Link>
        </div>
      </div>
    </main>
  );
}
