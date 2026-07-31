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

/**
 * Applied before React hydrates, and before the first paint.
 *
 * The theme used to be set in a `useEffect`, which meant the server sent a
 * class-less <html>, the browser painted the default, and only then did the
 * chosen theme snap in. On a slow connection that is a full second of the
 * wrong palette — and because `theme-light` was never on the server's markup,
 * a student who had picked dark spent every navigation watching the page
 * flash white first.
 *
 * Inline and synchronous on purpose: it has to run before the body is painted,
 * so it cannot be a module.
 */
const THEME_BOOT = `(function(){try{
var t=localStorage.getItem('easyway-theme');
if(t!=='light'&&t!=='dark'&&t!=='custom'){t='light'}
document.documentElement.classList.add('theme-'+t);
}catch(e){document.documentElement.classList.add('theme-light')}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      {/* `app-canvas`, not `bg-[var(--background)]`: the latter compiles to
          background-color and throws the gradient away. See globals.css. */}
      <body className="app-canvas min-h-full flex flex-col text-[var(--foreground)] transition-colors duration-300">
        <Providers>
          <PageContainer>{children}</PageContainer>
        </Providers>
      </body>
    </html>
  );
}
