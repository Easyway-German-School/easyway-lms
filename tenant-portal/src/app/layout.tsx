import type { ReactNode } from "react";
import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Tenant Portal Example",
  description: "Isolated tenant/partner proof of concept",
};

import Header from "./components/header";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="app-shell">
        <Header />
        <main className="page-frame">{children}</main>
      </body>
    </html>
  );
}
