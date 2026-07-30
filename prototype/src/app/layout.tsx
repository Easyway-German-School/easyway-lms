import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";
import PageContainer from "@/components/PageContainer";

export const metadata: Metadata = {
  title: "Easyway German Language School",
  description: "Web-based learner portal for Easyway German Language School",
  // The square emblem, not the horizontal lockup — the lockup is illegible at
  // 16px. Sizes are declared so browsers pick without downscaling the 512.
  icons: {
    icon: [
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    // Flattened onto white: iOS renders PNG transparency as black.
    apple: { url: "/apple-icon.png", sizes: "180x180" },
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
