"use client";

import SignUpFormClient from "./SignUpFormClient";

export type SignupPrefill = {
  name?: string;
  email?: string;
  level?: string;
  branchId?: string;
  sessionSlot?: string;
};

type SignUpFormProps = {
  pageTitle?: string;
  initialBranchName?: string;
  /**
   * Seeded by SignupAccessGate from the validated token / Paystack ref, so a
   * returning student is not retyping what enrolment already knows. Wins over
   * URL params for the fields it carries.
   */
  initialPrefill?: SignupPrefill;
};

export default function SignUpForm({ pageTitle, initialBranchName, initialPrefill }: SignUpFormProps) {
  return (
    <SignUpFormClient
      pageTitle={pageTitle}
      initialBranchName={initialBranchName}
      initialPrefill={initialPrefill}
    />
  );
}
