"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

function areaFor(pathname: string) {
  const parts = pathname.split("/").filter(Boolean);
  return parts.length ? `/${parts[0]}` : "/dashboard";
}

export default function StudentUsageTracker() {
  const pathname = usePathname();
  const startedAt = useRef(Date.now());
  const lastPath = useRef(pathname);

  useEffect(() => {
    startedAt.current = Date.now();
    lastPath.current = pathname;
    return () => {
      const durationSeconds = Math.round((Date.now() - startedAt.current) / 1000);
      if (durationSeconds < 5) return;
      void fetch("/api/beta/usage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: JSON.stringify({ area: areaFor(lastPath.current), action: "view", durationSeconds }),
      });
    };
  }, [pathname]);

  return null;
}
