import Link from "next/link";
import { LockIcon, ArrowRightIcon } from "@/components/icons";

/**
 * Shown at `/auth/signup` when the visitor arrived with no valid signup token
 * and no valid paid Paystack reference — i.e. they typed the URL, or followed
 * a link that has already been used. It is a dead end on purpose: the only way
 * on is back through the enrolment form on the marketing site.
 *
 * Styled with the same tokens and the teal→orange enrolment gradient the
 * signup form itself uses, so a blocked visitor still lands somewhere that
 * looks like the school.
 */

const ENROLMENT_URL =
  process.env.NEXT_PUBLIC_ENROLMENT_URL || "https://easywaylanguageschool.com/course-enquiry/";

export default function SignupBlocked() {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(255,102,0,0.12),_transparent_35%),linear-gradient(180deg,_#f5f5f5_0%,_#ffffff_100%)] px-4 py-12 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-xl flex-col items-center">
        <div className="w-full rounded-[32px] bg-gradient-to-br from-[#0D7C7E] via-[#FF6600] to-[#FF8533] px-6 py-8 text-white shadow-[0_30px_90px_-30px_rgba(13,124,126,0.25)] sm:px-10">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-white/15 text-white">
            <LockIcon className="h-6 w-6" />
          </span>
          <p className="mt-5 text-xs font-semibold uppercase tracking-[0.36em] text-white/70">
            Enrolment · EasyWay German
          </p>
          <h1 className="mt-3 text-2xl font-semibold leading-tight sm:text-3xl">
            Let&rsquo;s start with the enrolment form
          </h1>
        </div>

        <div className="-mt-6 w-[calc(100%-1.5rem)] rounded-[28px] bg-white/95 p-6 text-center shadow-[0_30px_80px_-24px_rgba(15,23,42,0.18)] ring-1 ring-slate-200/70 sm:p-8">
          <p className="text-sm leading-7 text-[var(--muted)]">
            This page opens from our enrolment forms. To register on the learning platform,
            complete the short enrolment form on our website first — new students pay the
            registration fee there, and returning students get a one-time link by email.
          </p>
          <a
            href={ENROLMENT_URL}
            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#0D7C7E] to-[#FF6600] px-7 py-3.5 text-sm font-bold text-white shadow-lg shadow-[#FF6600]/20 transition hover:brightness-110"
          >
            Go to the enrolment form
            <ArrowRightIcon className="h-4 w-4" />
          </a>
          <p className="mt-5 text-xs text-[var(--muted)]">
            Already have an account?{" "}
            <Link
              href="/auth/signin"
              className="font-semibold text-[var(--accent)] underline underline-offset-2 hover:brightness-110"
            >
              Sign in
            </Link>
            .
          </p>
        </div>

        <p className="mt-6 text-center text-xs text-[var(--muted)]/80">
          If you were sent a signup link and it is not working, it may have already been used —
          contact your branch office and they will send a fresh one.
        </p>
      </div>
    </div>
  );
}
