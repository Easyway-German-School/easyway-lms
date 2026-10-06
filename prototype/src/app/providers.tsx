"use client";

import { useState } from "react";
import { SessionProvider } from "next-auth/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrandingProvider } from "@/components/BrandingProvider";
import { LightboxProvider } from "@/components/ImageLightbox";
import { installSessionResilience } from "@/lib/session-resilience";

// At module scope, not in an effect: SessionProvider's own effect asks for the
// session before any effect in this file would run, and that first request is
// one the guard has to see.
installSessionResilience();

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            retry: 1,
            staleTime: 15_000,
          },
        },
      })
  );

  return (
    <SessionProvider>
      <QueryClientProvider client={queryClient}>
        <BrandingProvider>
          <LightboxProvider>{children}</LightboxProvider>
        </BrandingProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
}
