import SignupAccessGate from "@/app/auth/signup/SignupAccessGate";

type Params = Record<string, string | string[] | undefined>;

export default function PortHarcourtSignUpPage({ searchParams }: { searchParams?: Promise<Params> }) {
  return (
    <SignupAccessGate
      searchParams={searchParams}
      pageTitle="Start your German journey — Port Harcourt"
      initialBranchName="Port Harcourt"
    />
  );
}
