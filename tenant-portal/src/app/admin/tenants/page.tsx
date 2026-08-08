"use client";

import { useEffect, useState } from "react";

type Tenant = {
  id: string;
  name: string;
  slug: string;
  domain?: string | null;
  brandName?: string | null;
  emailFrom?: string | null;
  emailReplyTo?: string | null;
  status: string;
  createdAt: string;
};

export default function AdminTenantsPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [domain, setDomain] = useState("");
  const [brandName, setBrandName] = useState("");
  const [emailFrom, setEmailFrom] = useState("");
  const [emailReplyTo, setEmailReplyTo] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadTenants() {
      const token = localStorage.getItem("tenant_portal_token");
      if (!token) {
        setError("No admin token found. Seed the demo tenant first.");
        return;
      }

      const res = await fetch("/api/admin/tenants", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Unable to load tenants");
        return;
      }

      setTenants(json.tenants);
    }

    loadTenants();
  }, []);

  async function createTenant(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("Creating tenant...");
    setError(null);

    const token = localStorage.getItem("tenant_portal_token");
    if (!token) {
      setError("No admin token found. Seed the demo tenant first.");
      setStatus(null);
      return;
    }

    const res = await fetch("/api/admin/tenants", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ name, slug, domain, brandName, emailFrom, emailReplyTo }),
    });
    const json = await res.json();
    if (!res.ok) {
      setError(json.error || "Unable to create tenant");
      setStatus(null);
      return;
    }

    setTenants((current) => [json.tenant, ...current]);
    setStatus("Tenant created successfully.");
    setName("");
    setSlug("");
    setDomain("");
    setBrandName("");
    setEmailFrom("");
    setEmailReplyTo("");
  }

  return (
    <main style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1>Tenant Management</h1>
      {error ? <p style={{ color: "red" }}>{error}</p> : null}
      {status ? <p style={{ color: "green" }}>{status}</p> : null}

      <section style={{ maxWidth: 640, marginBottom: 32 }}>
        <h2>Create Tenant</h2>
        <form onSubmit={createTenant} style={{ display: "grid", gap: 12 }}>
          <label>
            Name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              style={{ width: "100%", padding: 8, marginTop: 4 }}
            />
          </label>
          <label>
            Slug
            <input
              value={slug}
              onChange={(event) => setSlug(event.target.value)}
              required
              style={{ width: "100%", padding: 8, marginTop: 4 }}
            />
          </label>
          <label>
            Domain
            <input
              value={domain}
              onChange={(event) => setDomain(event.target.value)}
              style={{ width: "100%", padding: 8, marginTop: 4 }}
            />
          </label>
          <label>
            Brand Name
            <input
              value={brandName}
              onChange={(event) => setBrandName(event.target.value)}
              style={{ width: "100%", padding: 8, marginTop: 4 }}
            />
          </label>
          <label>
            Email From
            <input
              value={emailFrom}
              onChange={(event) => setEmailFrom(event.target.value)}
              style={{ width: "100%", padding: 8, marginTop: 4 }}
            />
          </label>
          <label>
            Email Reply-To
            <input
              value={emailReplyTo}
              onChange={(event) => setEmailReplyTo(event.target.value)}
              style={{ width: "100%", padding: 8, marginTop: 4 }}
            />
          </label>
          <button type="submit" style={{ padding: "10px 16px", cursor: "pointer" }}>
            Create Tenant
          </button>
        </form>
      </section>

      <section style={{ maxWidth: 860 }}>
        <h2>Existing Tenants</h2>
        {tenants.length === 0 ? (
          <p>No tenants found.</p>
        ) : (
          <div style={{ display: "grid", gap: 16 }}>
            {tenants.map((tenant) => (
              <div key={tenant.id} style={{ padding: 16, border: "1px solid #ddd", borderRadius: 8 }}>
                <strong>{tenant.name}</strong> <span>({tenant.slug})</span>
                <p>{tenant.brandName || "No brand name"}</p>
                <p>{tenant.domain || "No domain"}</p>
                <p>{tenant.emailFrom || "No email from"}</p>
                <p>{tenant.emailReplyTo || "No email reply-to"}</p>
                <p>Status: {tenant.status}</p>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
