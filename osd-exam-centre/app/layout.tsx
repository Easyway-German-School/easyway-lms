import type { Metadata } from "next";
import "./globals.css";

const TITLE = "ÖSD Examination Centre — Easyway German Language School";
const DESCRIPTION =
  "Book your ÖSD German examination at Easyway's Lagos centre — Nigeria's ÖSD-accredited examination venue.";

export const metadata: Metadata = {
  // Absolute URLs for the link-preview image — without this WhatsApp/Slack
  // previews resolve it against localhost.
  metadataBase: new URL(process.env.SITE_URL || "https://easyway-osd.vercel.app"),
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    siteName: "Easyway ÖSD Examination Centre",
    type: "website",
    locale: "en_NG",
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Source+Serif+4:opsz,wght@8..60,500;8..60,600;8..60,700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
