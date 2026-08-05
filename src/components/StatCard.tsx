import { ReactNode } from "react";

type StatCardProps = {
  label: string;
  value: string;
  icon: ReactNode;
  accent?: string;
};

export default function StatCard({
  label,
  value,
  icon,
  accent = "bg-gradient-to-br from-[#0D7C7E] to-[#14525f]",
}: StatCardProps) {
  return (
    <div className="rounded-[24px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
      <div className="flex items-center gap-4">
        <div className={`flex h-12 w-12 items-center justify-center rounded-2xl text-lg text-white ${accent}`}>{icon}</div>
        <div>
          <p className="text-sm font-medium text-[var(--muted)]">{label}</p>
          <p className="mt-1 text-2xl font-semibold text-[#333333]">{value}</p>
        </div>
      </div>
    </div>
  );
}
