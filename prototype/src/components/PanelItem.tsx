import { ReactNode } from "react";

type PanelItemProps = {
  children: ReactNode;
  className?: string;
};

export default function PanelItem({ children, className = "" }: PanelItemProps) {
  return <div className={`rounded-[20px] border border-[var(--border)] bg-[#F8FBFF] px-4 py-4 ${className}`.trim()}>{children}</div>;
}
