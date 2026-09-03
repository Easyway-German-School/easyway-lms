import SignUpForm from "@/app/auth/signup/SignUpForm";
import SignupBlocked from "@/components/SignupBlocked";
import { validateSignupAccess, verifyInviteSig } from "@/lib/signup-access";

/**
 * The server-side gate in front of the public student signup form.
 *
 * Renders `<SignUpForm>` only for a visitor who arrived with one of:
 *   - a valid, unused `?token=` (returning student, minted at /api/signup-tokens)
 *   - a valid, unconsumed Paystack `?ref=` for a successful registration-fee
 *     charge (new student, paid on the WordPress side first)
 *   - a first-party invite link carrying a valid HMAC `?sig=` of its params
 *     (the office's lead-invite emails — see src/lib/leads.ts)
 *
 * Everyone else gets `<SignupBlocked>`. This is only half the enforcement: a
 * direct POST to /api/auth/signup is gated by the same `validateSignupAccess`
 * in the route, so hiding the form is not the security boundary, it is the UX.
 *
 * Used by /auth/signup and the four branch signup pages. Staff signup
 * (/auth/lecturer/signup, /auth/admin, /auth/parent/signup) does NOT use this.
 */

type Params = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  return trimmed ? trimmed : undefined;
}

export default async function SignupAccessGate({
  searchParams,
  pageTitle,
  initialBranchName,
}: {
  searchParams?: Promise<Params> | Params;
  pageTitle?: string;
  initialBranchName?: string;
}) {
  const params: Params = searchParams ? await searchParams : {};

  const token = first(params.token);
  // WordPress redirects with `?ref=`; a Paystack callback also appends
  // `reference` / `trxref`. Accept any of them.
  const ref = first(params.ref) || first(params.reference) || first(params.trxref);
  const sig = first(params.sig);

  // First-party signed invite link: no token, no ref, but a signature over the
  // prefilled params.
  if (!token && !ref && sig) {
    const inviteParams = {
      email: first(params.email),
      name: first(params.name),
      level: first(params.level),
      branchId: first(params.branchId),
      sessionSlot: first(params.sessionSlot),
    };
    if (verifyInviteSig(inviteParams, sig)) {
      return (
        <SignUpForm
          pageTitle={pageTitle}
          initialBranchName={initialBranchName}
          initialPrefill={inviteParams}
        />
      );
    }
    return <SignupBlocked />;
  }

  const result = await validateSignupAccess({ token, ref });
  if (!result.valid) {
    return <SignupBlocked />;
  }

  return (
    <SignUpForm
      pageTitle={pageTitle}
      initialBranchName={initialBranchName}
      initialPrefill={result.prefill}
    />
  );
}
