"use client";

import { useEffect, useState } from "react";

type Branch = {
  id: string;
  name: string;
  location?: string | null;
  status: string;
  tenantId?: string | null;
};

type Tenant = {
  id: string;
  name: string;
  slug: string;
};

export default function AdminBranchesPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [name, setName] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [location, setLocation] = useState("");
  const [status, setStatus] = useState("active");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    async function loadData() {
      const token = localStorage.getItem("tenant_portal_token");
      if (!token) {
        setError("No admin token found. Seed the demo tenant first.");
        return;
      }

      const [branchesRes, tenantsRes] = await Promise.all([
        fetch("/api/admin/branches", { headers: { Authorization: `Bearer ${token}` } }),
        fetch("/api/admin/tenants", { headers: { Authorization: `Bearer ${token}` } }),
      ]);

      const branchesJson = await branchesRes.json();
      const tenantsJson = await tenantsRes.json();

      if (!branchesRes.ok) {
        setError(branchesJson.error || "Unable to load branches");
        return;
      }

      if (!tenantsRes.ok) {
        setError(tenantsJson.error || "Unable to load tenants");
        return;
      }

      setBranches(branchesJson.branches);
      setTenants(tenantsJson.tenants);
      if (tenantsJson.tenants.length > 0) {
        setTenantId(tenantsJson.tenants[0].id);
      }
    }

    loadData();
  }, []);

  async function createBranch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage("Creating branch...");

    const token = localStorage.getItem("tenant_portal_token");
    if (!token) {
      setError("No admin token found.");
      setMessage(null);
      return;
    }

    const res = await fetch("/api/admin/branches", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ name, tenantId, location, status }),
    });
    const json = await res.json();
    if (!res.ok) {
      setError(json.error || "Unable to create branch");
      setMessage(null);
      return;
    }

    setBranches((current) => [json.branch, ...current]);
    setMessage("Branch created successfully.");
    setName("");
    setLocation("");
    setStatus("active");
  }

  return (
    <main>
      <h1 className="page-title">Branch Management</h1>
      <p className="page-subtitle">Create branches for tenants and view the current branch list.</p>

      {error ? <p style={{ color: "#B91C1C" }}>{error}</p> : null}
      {message ? <p style={{ color: "#15803D" }}>{message}</p> : null}

      <section className="panel-group">
        <section className="panel">
          <h2 className="section-heading">Create Branch</h2>
          <form onSubmit={createBranch} className="field-group">
            <label className="field-label">
              Branch Name
              <input className="input" value={name} onChange={(event) => setName(event.target.value)} required />
            </label>
            <label className="field-label">
              Tenant
              <select className="select" value={tenantId} onChange={(event) => setTenantId(event.target.value)} required>
                {tenants.map((tenant) => (
                  <option key={tenant.id} value={tenant.id}>
                    {tenant.name} ({tenant.slug})
                  </option>
                ))}
              </select>
            </label>
            <label className="field-label">
              Location
              <input className="input" value={location} onChange={(event) => setLocation(event.target.value)} />
            </label>
            <label className="field-label">
              Status
              <select className="select" value={status} onChange={(event) => setStatus(event.target.value)}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>
            <button type="submit" className="button button-primary">
              Create Branch
            </button>
          </form>
        </section>

        <section className="panel">
          <h2 className="section-heading">Existing Branches</h2>
          {branches.length === 0 ? (
            <p>No branches have been created yet.</p>
          ) : (
            <div className="card-grid">
              {branches.map((branch) => (
                <div key={branch.id} className="card">
                  <p className="card-title">{branch.name}</p>
                  <p className="card-meta">Tenant ID: {branch.tenantId || "Unknown"}</p>
                  <p className="card-meta">Location: {branch.location || "Not set"}</p>
                  <p className="card-meta">Status: {branch.status}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
