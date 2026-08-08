"use client";

import { useEffect, useState } from "react";

export default function TenantPage() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const token = localStorage.getItem("tenant_portal_token");
      if (!token) {
        setError("No token found. Log in first.");
        return;
      }

      const res = await fetch("/api/tenant", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Failed to load tenant");
        return;
      }
      setData(json);
    }

    load();
  }, []);

  return (
    <main style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1>Tenant Info</h1>
      {error ? <p style={{ color: "red" }}>{error}</p> : null}
      <pre style={{ background: "#f3f4f6", padding: 16, borderRadius: 8 }}>
        {JSON.stringify(data, null, 2)}
      </pre>
    </main>
  );
}
