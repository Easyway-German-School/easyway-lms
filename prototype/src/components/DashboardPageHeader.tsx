import { ChangeEvent, ReactNode } from "react";

type DashboardPageHeaderProps = {
  title: string;
  subtitle: string;
  description: string;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  tabs?: readonly string[];
  activeTab?: string;
  onTabChange?: (tab: string) => void;
  action?: ReactNode;
};

export default function DashboardPageHeader({
  title,
  subtitle,
  description,
  searchValue,
  onSearchChange,
  tabs,
  activeTab,
  onTabChange,
  action,
}: DashboardPageHeaderProps) {
  return (
    <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-[#FF6600]">{title}</p>
          <h1 className="mt-3 text-3xl font-semibold text-[#111827]">{subtitle}</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>
        </div>
        {(onSearchChange || action) ? (
          <div className="w-full md:w-80">
            {onSearchChange ? (
              <input
                type="search"
                value={searchValue ?? ""}
                onChange={(event: ChangeEvent<HTMLInputElement>) => onSearchChange(event.target.value)}
                placeholder={`Search ${title.toLowerCase()}`}
                className="w-full rounded-2xl border border-slate-200 bg-[#F9F7F5] px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-[#FF6600] focus:bg-white focus:ring-4 focus:ring-orange-100"
              />
            ) : null}
            {action ? <div className={`mt-4 ${onSearchChange ? "md:mt-4" : "md:mt-0"}`}>{action}</div> : null}
          </div>
        ) : null}
      </div>

      {tabs && onTabChange ? (
        <div className="mt-6 flex flex-wrap gap-3">
          {tabs.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => onTabChange(tab)}
              className={`rounded-2xl px-4 py-2 text-sm font-semibold transition ${
                activeTab === tab
                  ? "bg-[#FF6600] text-white shadow-sm"
                  : "bg-[#F8FBFF] text-slate-700 hover:bg-[#eef6ff]"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
