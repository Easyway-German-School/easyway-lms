"use client";

import Link from "next/link";
import { useState } from "react";

export default function AdminPage() {
  const [status, setStatus] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);

  async function createSeedTenant() {
    setStatus("Seeding demo tenant...");
    setResult(null);

    const response = await fetch("/api/admin/seed", {
      method: "POST",
    });
    const data = await response.json();

    if (!response.ok) {
      setStatus("Failed to seed demo tenant");
      setResult(data);
      return;
    }

    localStorage.setItem("tenant_portal_token", data.token);
    setStatus("Demo tenant seeded successfully. Admin token saved to localStorage.");
    setResult(data);
  }

  function copyToken() {
    if (!result?.token) return;
    navigator.clipboard.writeText(result.token);
    setStatus("Token copied to clipboard.");
  }

  return (
    <main>
      <h1 className="page-title">Admin Seed</h1>
      <p className="page-subtitle">
        Use this page to create a demo tenant, partner config, and admin user in the isolated portal.
      </p>

      <section className="panel-group">
        <section className="panel">
          <button type="button" className="button button-primary" onClick={createSeedTenant}>
            Seed Demo Tenant
          </button>
          {status ? <p style={{ marginTop: 16 }}>{status}</p> : null}
          {result ? (
            <>
              <h2 className="section-heading">Seed Result</h2>
              <pre className="pre-box">{JSON.stringify(result, null, 2)}</pre>
              <button type="button" className="button button-secondary" onClick={copyToken}>
                Copy Admin Token
              </button>
              <p style={{ marginTop: 12 }}>
                The admin token is also stored in localStorage as <code>tenant_portal_token</code> for quick testing.
              </p>
            </>
          ) : null}
        </section>

        <section className="panel">
          <h2 className="section-heading">Admin Shortcuts</h2>
          <div className="card-grid">
            <div className="card">
              <p className="card-title">Tenant Management</p>
              <p className="card-meta">Create and edit tenant details.</p>
              <Link href="/admin/tenants" className="button button-secondary">
                Open Tenant Management
              </Link>
            </div>
            <div className="card">
              <p className="card-title">Branch Management</p>
              <p className="card-meta">Create and review tenant branches.</p>
              <Link href="/admin/branches" className="button button-secondary">
                Open Branch Management
              </Link>
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}
