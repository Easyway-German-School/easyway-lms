import Link from "next/link";
import { redirect } from "next/navigation";

import { verifyPaystackTransaction } from "@/lib/paystack-verify";
import LoadingExperience from "@/components/LoadingExperience";
import PaystackAutoRedirectClient from "@/components/PaystackAutoRedirectClient";
import PaystackManualVerifyClient from "@/components/PaystackManualVerifyClient";
import { CheckCircleIcon, CrossIcon, LockIcon } from "@/components/icons";

/**
 * Where Paystack drops the student after checkout.
 *
 * This page used to render <LoadingExperience title="Finalizing your payment…">
 * unconditionally — the spinner was static furniture, not a state. So every
 * outcome looked identical: a payment that succeeded, one that failed, and one
 * that could not be verified all showed the same never-ending "Finalizing your
 * payment…", with any error text tucked into a box underneath it. A student
 * whose money had just left their account sat watching a spinner that was never
 * going to resolve.
 *
 * It is a server component, so by the time anything renders the answer is
 * already known. There are five outcomes and each one gets its own screen:
 *
 *   no reference   nothing to verify — they arrived here by hand
 *   paid           redirect to the dashboard, classes unlocked
 *   pending        genuinely still settling (bank transfer, USSD) — the only
 *                  case where a spinner is honest, and it polls
 *   unverified     we could not get an answer out of Paystack — offer a retry
 *   unrecorded     Paystack confirmed the charge but we failed to write it down
 *
 * That last one is split out deliberately. "We could not verify your payment"
 * and "your payment went through but your account did not update" call for
 * completely different actions from the student, and collapsing them was how
 * the original bug stayed invisible: a foreign-key error while recording the
 * payment surfaced as a verification failure.
 */

type EnrollmentSuccessPageProps = {
  searchParams?: Promise<{
    reference?: string;
    trxref?: string;
    status?: string;
    source?: string;
  }>;
};

/** Paystack's own words for "not finished yet". */
const PENDING_STATUSES = new Set(["pending", "ongoing", "processing", "queued"]);

export default async function EnrollmentSuccessPage({ searchParams }: EnrollmentSuccessPageProps) {
  const params = await searchParams;
  // Paystack appends BOTH `trxref` and `reference`; take whichever arrived.
  const reference = params?.reference || params?.trxref || "";

  if (!reference) {
    return (
      <Shell>
        <Outcome
          tone="warn"
          icon={<LockIcon className="h-7 w-7" />}
          title="No payment reference"
          body="This page confirms a Paystack checkout, and there is no reference in the link you followed. If you have just paid, open your payments page — anything received is listed there."
        />
        <Actions primary={{ href: "/payments", label: "See my payments" }} secondary={{ href: "/programs", label: "Back to tuition" }} />
      </Shell>
    );
  }

  // Verified directly through the shared lib — no HTTP round-trip, so no
  // relative-URL or self-fetch problems in a server component. This also
  // persists the invoice, payment and enrolment when the charge succeeded.
  const result = await verifyPaystackTransaction(reference);
  const transaction = result.data?.data;
  const transactionStatus = String(transaction?.status || "");
  const amount = typeof transaction?.amount === "number" ? transaction.amount / 100 : null;
  const currency = String(transaction?.currency || "NGN");

  // Paid and recorded: the enrolment is persisted and classes are open, so
  // there is nothing to read on this page. (redirect() throws NEXT_REDIRECT and
  // must not sit inside a try/catch.)
  if (result.success && !result.persistFailed && transactionStatus === "success") {
    redirect("/dashboard?paymentRefresh=1");
  }

  // Charged, but we could not write it down. Do not tell them to try again —
  // they have already paid, and a retry cannot take a second payment.
  if (result.persistFailed) {
    return (
      <Shell>
        <Outcome
          tone="warn"
          icon={<CheckCircleIcon className="h-7 w-7" />}
          title="Payment received — your account is still catching up"
          body="Paystack has confirmed your payment. We could not finish updating your account automatically, so your classes may not be open yet. Nothing is lost and you will not be charged again."
        />
        <Reference reference={reference} amount={amount} currency={currency} status={transactionStatus} />
        <p className="mt-4 text-sm text-[var(--muted)]">
          Try once more below — it often clears on a second attempt. If it does not, send this reference to your branch
          office and they will apply it by hand.
        </p>
        <div className="mt-4">
          <PaystackManualVerifyClient reference={reference} />
        </div>
        <Actions primary={{ href: "/payments", label: "See my payments" }} secondary={{ href: "/dashboard", label: "Go to dashboard" }} />
      </Shell>
    );
  }

  // Still settling. A bank transfer or USSD charge can legitimately sit here for
  // a few minutes, so this is the one screen where a spinner tells the truth.
  if (result.success && PENDING_STATUSES.has(transactionStatus)) {
    return (
      <Shell>
        <LoadingExperience
          title="Deine Zahlung wird bestätigt…"
          message="Your bank has not confirmed this payment yet. This page is checking every few seconds and will take you to your dashboard the moment it clears."
          detail="Safe to leave this page — your payment is not affected."
        />
        <Reference reference={reference} amount={amount} currency={currency} status={transactionStatus} />
        <PaystackAutoRedirectClient reference={reference} source={params?.source} poll />
        <Actions primary={{ href: "/payments", label: "See my payments" }} secondary={{ href: "/dashboard", label: "Go to dashboard" }} />
      </Shell>
    );
  }

  // Paystack answered, and the answer was no.
  if (result.success) {
    return (
      <Shell>
        <Outcome
          tone="bad"
          icon={<CrossIcon className="h-7 w-7" strokeWidth={2.4} />}
          title="This payment did not go through"
          body={
            transactionStatus === "abandoned"
              ? "The checkout was closed before it completed, so nothing was charged. You can start it again whenever you are ready."
              : "Paystack reports this transaction as unsuccessful. Nothing has been charged to your account."
          }
        />
        <Reference reference={reference} amount={amount} currency={currency} status={transactionStatus || "unknown"} />
        <Actions primary={{ href: "/programs", label: "Try payment again" }} secondary={{ href: "/payments", label: "See my payments" }} />
      </Shell>
    );
  }

  // We never got an answer at all.
  return (
    <Shell>
      <Outcome
        tone="warn"
        icon={<LockIcon className="h-7 w-7" />}
        title="We could not check this payment"
        body={`${result.error || "Paystack did not respond."} If money left your account, it is safe — nothing here cancels a payment.`}
      />
      <Reference reference={reference} amount={amount} currency={currency} status={transactionStatus || "unknown"} />
      <div className="mt-4">
        <PaystackManualVerifyClient reference={reference} />
      </div>
      <Actions primary={{ href: "/payments", label: "See my payments" }} secondary={{ href: "/programs", label: "Back to tuition" }} />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-canvas flex min-h-screen items-center justify-center px-6 py-10 text-[var(--foreground)]">
      <div className="w-full max-w-2xl rounded-[32px] border border-[var(--border)] bg-[var(--surface)] p-8 shadow-[var(--shadow)] sm:p-10">
        {children}
      </div>
    </div>
  );
}

function Outcome({
  tone,
  icon,
  title,
  body,
}: {
  tone: "good" | "warn" | "bad";
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  const palette =
    tone === "good"
      ? "bg-[var(--success-soft)] text-[var(--success)]"
      : tone === "bad"
        ? "bg-[var(--danger-soft)] text-[var(--danger)]"
        : "bg-[var(--warning-soft)] text-[var(--warning)]";

  return (
    <div className="text-center">
      <span className={`mx-auto grid h-16 w-16 place-items-center rounded-3xl ${palette}`}>{icon}</span>
      <h1 className="mt-5 text-2xl font-bold leading-tight sm:text-3xl">{title}</h1>
      <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-[var(--muted)]">{body}</p>
    </div>
  );
}

function Reference({
  reference,
  amount,
  currency,
  status,
}: {
  reference: string;
  amount: number | null;
  currency: string;
  status: string;
}) {
  return (
    <dl className="mt-6 space-y-2 rounded-3xl border border-[var(--border)] bg-[var(--surface-alt)] p-4 text-sm">
      <div className="flex flex-wrap justify-between gap-2">
        <dt className="font-semibold text-[var(--foreground)]">Reference</dt>
        <dd className="break-all font-mono text-xs text-[var(--muted)]">{reference}</dd>
      </div>
      {amount !== null && (
        <div className="flex flex-wrap justify-between gap-2">
          <dt className="font-semibold text-[var(--foreground)]">Amount</dt>
          <dd className="text-[var(--muted)]">
            {amount.toLocaleString()} {currency}
          </dd>
        </div>
      )}
      <div className="flex flex-wrap justify-between gap-2">
        <dt className="font-semibold text-[var(--foreground)]">Status</dt>
        <dd className="text-[var(--muted)]">{status}</dd>
      </div>
    </dl>
  );
}

function Actions({
  primary,
  secondary,
}: {
  primary: { href: string; label: string };
  secondary: { href: string; label: string };
}) {
  return (
    <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
      <Link
        href={primary.href}
        className="rounded-full bg-[var(--accent)] px-6 py-3 text-center text-sm font-bold text-white shadow-lg transition hover:brightness-110"
      >
        {primary.label}
      </Link>
      <Link
        href={secondary.href}
        className="rounded-full border border-[var(--border)] px-6 py-3 text-center text-sm font-semibold text-[var(--foreground)] transition hover:bg-[var(--surface-alt)]"
      >
        {secondary.label}
      </Link>
    </div>
  );
}
