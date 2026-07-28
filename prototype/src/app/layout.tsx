import type { Metadata } from "next";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "EasyWay LMS",
  description: "EasyWay LMS community and learning platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
