import SignupAccessGate from "@/app/auth/signup/SignupAccessGate";

type Params = Record<string, string | string[] | undefined>;

export default function AbujaSignUpPage({ searchParams }: { searchParams?: Promise<Params> }) {
  return (
    <SignupAccessGate
      searchParams={searchParams}
      pageTitle="Start your German journey — Abuja"
      initialBranchName="Abuja"
    />
  );
}
