import Link from "next/link";
import { redirect } from "next/navigation";
import { verifyPaystackTransaction } from "@/lib/paystack-verify";
import LoadingExperience from "@/components/LoadingExperience";
import PaystackAutoRedirectClient from "@/components/PaystackAutoRedirectClient";
import PaystackManualVerifyClient from "@/components/PaystackManualVerifyClient";

type EnrollmentSuccessPageProps = {
  searchParams?: {
    reference?: string;
    status?: string;
    source?: string;
  };
};

export default async function EnrollmentSuccessPage({ searchParams }: EnrollmentSuccessPageProps) {
  const searchParamsResolved = await Promise.resolve(searchParams);
  const reference = searchParamsResolved?.reference;
  let verified: { status?: string; amount?: number; currency?: string; message?: string } | null = null;
  let verifiedSuccess = false;

  if (reference) {
    // Verify directly via the shared lib — no HTTP round-trip, so no relative-URL
    // or self-fetch issues in the server component. This also persists the
    // invoice / payment / enrollment when the transaction succeeded.
    const result = await verifyPaystackTransaction(reference);
    const txData = result.data?.data;
    if (result.success && txData) {
      verified = {
        status: txData.status,
        amount: typeof txData.amount === "number" ? txData.amount / 100 : undefined,
        currency: txData.currency,
      };
      verifiedSuccess = txData.status === "success";
    } else {
      verified = { message: result.error || result.data?.message || "Unable to verify transaction" };
    }
  }

  // Payment confirmed server-side: the enrollment is persisted and classes are
  // now unlocked, so auto-route the learner straight to their dashboard.
  // (redirect() must run outside the try/catch — it throws NEXT_REDIRECT.)
  if (verifiedSuccess) {
    redirect("/dashboard?paymentRefresh=1");
  }

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)] flex items-center justify-center px-6 py-10">
      <div className="max-w-3xl rounded-3xl bg-[var(--surface)] p-10 shadow-2xl ring-1 ring-white/10">
        <LoadingExperience
          title="Finalizing your payment…"
          message="We are verifying your Paystack transaction and unlocking your classes now. You’ll be redirected to your dashboard shortly."
        />
        <div className="mt-6 rounded-3xl border border-[var(--border)] bg-[var(--surface-alt)] p-4 text-sm text-[var(--foreground-soft)]">
          <p className="font-semibold text-[var(--foreground)]">Payment reference</p>
          <p className="mt-1 break-words">{reference || "—"}</p>
          {verified ? (
            verified.message ? <p className="mt-2 text-rose-600">{verified.message}</p> : <>
              <p className="mt-2 text-[var(--muted)]">Status: {verified.status}</p>
              {verified.amount ? <p className="mt-1 text-[var(--muted)]">Amount: {verified.amount.toLocaleString()} {verified.currency}</p> : null}
            </>
          ) : (
            <p className="mt-2 text-[var(--muted)]">Verifying transaction…</p>
          )}
        </div>
        {searchParams?.source === "paystack" ? (
          <div className="mt-4 rounded-3xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
            <p className="font-semibold">Paystack checkout complete</p>
            <p className="mt-1 text-[var(--foreground-soft)]">This page was reached from Paystack and confirms the payment callback completed successfully.</p>
            <PaystackAutoRedirectClient reference={reference} source={searchParams?.source} />
            <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:gap-4">
              <form method="get" action="/dashboard">
                <button
                  type="submit"
                  className="mt-3 rounded-full bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800"
                >
                  Go to dashboard now
                </button>
              </form>
              <PaystackManualVerifyClient reference={reference} />
            </div>
          </div>
        ) : null}
        <div className="mt-8 flex flex-col gap-4 sm:flex-row justify-center">
          <Link href="/dashboard?paymentRefresh=1" className="rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-[var(--surface)] text-center hover:brightness-110">
            Go to dashboard
          </Link>
          <Link href="/programs" className="rounded-full border border-[var(--border)] px-5 py-3 text-sm font-semibold text-[var(--foreground)] text-center hover:bg-[var(--surface)]">
            Explore other paths
          </Link>
        </div>
      </div>
    </div>
  );
}
