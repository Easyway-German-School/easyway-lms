import { CheckIcon } from "@/components/icons";

type JourneyStep = {
  title: string;
  status: "completed" | "current" | "locked";
  progress: number;
  icon: string;
};

type GermanyJourneyProps = {
  overallProgress: number;
  steps: JourneyStep[];
};

function StepBadge({ status }: { status: JourneyStep["status"] }) {
  if (status === "completed") {
    return <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">Completed</span>;
  }

  if (status === "current") {
    return <span className="rounded-full bg-[#FFF4ED] px-3 py-1 text-xs font-semibold text-[#c2410c]">You are here</span>;
  }

  return <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500">Locked</span>;
}

export default function GermanyJourney({ overallProgress, steps }: GermanyJourneyProps) {
  return (
    <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-[#FF6600]">My Germany Journey</p>
          <h2 className="mt-3 text-2xl font-semibold text-[#111827]">Your path to Germany, mapped clearly.</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">Track each milestone from language learning to arrival.</p>
        </div>
        <div className="rounded-2xl bg-[#F9F7F5] px-4 py-3 text-sm font-semibold text-[#FF6600] shadow-sm">
          Main journey overview
        </div>
      </div>

      <div className="mt-6 rounded-[24px] border border-slate-200 bg-[#F8FBFF] p-5">
        <p className="text-sm font-semibold text-slate-700">You&apos;re {overallProgress}% closer to Germany 🇩🇪</p>
        <div className="mt-4 h-3 overflow-hidden rounded-full bg-slate-200">
          <div className="h-3 rounded-full bg-gradient-to-r from-[#FF6600] to-[#FF9933]" style={{ width: `${overallProgress}%` }} />
        </div>
        <p className="mt-3 text-sm text-slate-600">Keep moving forward with your next milestone.</p>
      </div>

      <div className="mt-6 space-y-4">
        {steps.map((step) => {
          const isComplete = step.status === "completed";
          const isCurrent = step.status === "current";
          const isLocked = step.status === "locked";

          return (
            <div
              key={step.title}
              className={`rounded-[24px] border p-4 shadow-sm transition ${
                isComplete ? "border-emerald-200 bg-emerald-50" : isCurrent ? "border-[#FF6600]/20 bg-[#FFF9F5]" : "border-slate-200 bg-slate-50"
              }`}
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-4">
                  <div
                    className={`flex h-12 w-12 items-center justify-center rounded-2xl text-lg shadow-sm ${
                      isComplete ? "bg-emerald-500 text-white" : isCurrent ? "bg-[#FF6600] text-white" : "bg-slate-200 text-slate-500"
                    }`}
                  >
                    {isComplete ? <CheckIcon className="h-5 w-5" strokeWidth={2.6} /> : step.icon}
                  </div>
                  <div>
                    <p className={`text-sm font-semibold ${isLocked ? "text-slate-600" : "text-[#111827]"}`}>{step.title}</p>
                    <p className="mt-1 text-xs uppercase tracking-[0.3em] text-slate-500">
                      {step.status === "completed" ? "Completed" : step.status === "current" ? "In progress" : "Locked"}
                    </p>
                  </div>
                </div>
                <StepBadge status={step.status} />
              </div>

              <div className="mt-4">
                <div className="h-2 rounded-full bg-slate-200">
                  <div
                    className={`h-2 rounded-full ${
                      isComplete ? "bg-emerald-500" : isCurrent ? "bg-[#FF6600]" : "bg-slate-400"
                    }`}
                    style={{ width: `${step.progress}%` }}
                  />
                </div>
                <p className="mt-2 text-xs font-medium text-slate-500">Progress {step.progress}%</p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
