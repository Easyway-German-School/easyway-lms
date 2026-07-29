import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dashboard — Easyway LMS",
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <div>{children}</div>;
}
