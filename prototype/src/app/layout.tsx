import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";
import PageContainer from "@/components/PageContainer";

export const metadata: Metadata = {
  title: "Easyway German Language School",
  description: "Web-based learner portal for Easyway German Language School",
  // Uses public/logo-mark.png when present (the square emblem reads far better
  // at 16px than the full lockup), otherwise the wordmark.
  icons: {
    icon: [
      { url: "/logo-mark.png", type: "image/png" },
      { url: "/logo.png", type: "image/png" },
    ],
    apple: "/logo-mark.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-[var(--background)] text-[var(--foreground)] transition-colors duration-300">
        <Providers>
          <PageContainer>{children}</PageContainer>
        </Providers>
      </body>
    </html>
  );
}
