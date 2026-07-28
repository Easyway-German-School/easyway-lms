import Link from "next/link";

export default function AuthErrorPage() {
  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)] flex items-center justify-center px-6 py-10">
      <div className="max-w-xl rounded-3xl bg-[var(--surface)] p-10 shadow-2xl ring-1 ring-white/10">
        <h1 className="text-4xl font-semibold">Authentication error</h1>
        <p className="mt-4 text-[var(--muted)]">
          Something went wrong while signing in. Please try again or contact support if the issue continues.
        </p>
        <div className="mt-8 flex flex-col gap-4 sm:flex-row">
          <Link href="/auth/signin" className="rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-[var(--surface)] text-center hover:brightness-110">
            Try signing in again
          </Link>
          <Link href="/auth/signup" className="rounded-full border border-[var(--border)] px-5 py-3 text-sm font-semibold text-[var(--foreground)] text-center hover:bg-[var(--surface)]">
            Create a new account
          </Link>
        </div>
      </div>
    </div>
  );
}
