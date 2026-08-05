"use client";

import SignUpFormClient from "./SignUpFormClient";

type SignUpFormProps = { pageTitle?: string; initialBranchName?: string };

export default function SignUpForm({ pageTitle, initialBranchName }: SignUpFormProps) {
  return <SignUpFormClient pageTitle={pageTitle} initialBranchName={initialBranchName} />;
}
