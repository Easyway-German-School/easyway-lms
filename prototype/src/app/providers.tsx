"use client";

import { useState } from "react";
import { SessionProvider } from "next-auth/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrandingProvider } from "@/components/BrandingProvider";

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
        <BrandingProvider>{children}</BrandingProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
}
