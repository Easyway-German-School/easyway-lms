import { ReactNode } from "react";

type DashboardCardProps = {
  title: string;
  description?: string;
  icon?: ReactNode;
  children: ReactNode;
  accent?: string;
};

export default function DashboardCard({
  title,
  description,
  icon,
  children,
  accent = "from-[#0D7C7E] to-[#14525f]",
}: DashboardCardProps) {
  return (
    <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-[0_20px_50px_-24px_rgba(0,48,135,0.25)] transition duration-300 hover:-translate-y-1 hover:shadow-[0_24px_60px_-24px_rgba(0,48,135,0.35)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-[#333333]">{title}</h3>
          {description ? <p className="mt-1 text-sm leading-6 text-slate-600">{description}</p> : null}
        </div>
        {icon ? (
          <div className={`flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br ${accent} text-white`}>
            {icon}
          </div>
        ) : null}
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}
