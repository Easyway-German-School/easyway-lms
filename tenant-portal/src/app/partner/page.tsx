"use client";

import { useEffect, useState } from "react";

export default function PartnerPage() {
  const [data, setData] = useState<any>(null);
  const [plan, setPlan] = useState("");
  const [metadata, setMetadata] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const token = localStorage.getItem("tenant_portal_token");
      if (!token) {
        setError("No token found. Log in first.");
        return;
      }

      const res = await fetch("/api/partner", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Failed to load partner config");
        return;
      }

      setData(json.config);
      setPlan(json.config?.plan ?? "");
      setMetadata(JSON.stringify(json.config?.metadata ?? {}, null, 2));
    }

    load();
  }, []);

  async function saveConfig(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setStatus("Saving...");

    const token = localStorage.getItem("tenant_portal_token");
    if (!token) {
      setError("No token found. Log in first.");
      setStatus(null);
      return;
    }

    let parsedMetadata;
    try {
      parsedMetadata = JSON.parse(metadata || "{}");
    } catch (err) {
      setError("Metadata JSON is invalid.");
      setStatus(null);
      return;
    }

    const res = await fetch("/api/partner", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ plan, metadata: parsedMetadata }),
    });

    const json = await res.json();
    if (!res.ok) {
      setError(json.error || "Failed to save partner config");
      setStatus(null);
      return;
    }

    setStatus("Partner config updated successfully.");
    setData(json.config);
  }

  return (
    <main style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1>Partner Config</h1>
      {error ? <p style={{ color: "red" }}>{error}</p> : null}
      {status ? <p style={{ color: "green" }}>{status}</p> : null}
      <form onSubmit={saveConfig} style={{ display: "grid", gap: 12, maxWidth: 640 }}>
        <label>
          Plan
          <input
            type="text"
            value={plan}
            onChange={(event) => setPlan(event.target.value)}
            style={{ width: "100%", padding: 8, marginTop: 4 }}
          />
        </label>
        <label>
          Metadata JSON
          <textarea
            value={metadata}
            onChange={(event) => setMetadata(event.target.value)}
            rows={8}
            style={{ width: "100%", padding: 8, marginTop: 4 }}
          />
        </label>
        <button type="submit" style={{ padding: "10px 16px", cursor: "pointer" }}>
          Save Partner Config
        </button>
      </form>
      <h2 style={{ marginTop: 24 }}>Current Config</h2>
      <pre style={{ background: "#f3f4f6", padding: 16, borderRadius: 8 }}>
        {JSON.stringify(data, null, 2)}
      </pre>
    </main>
  );
}
