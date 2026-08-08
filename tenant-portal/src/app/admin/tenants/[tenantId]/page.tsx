"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

type Tenant = {
  id: string;
  name: string;
  slug: string;
  domain?: string | null;
  brandName?: string | null;
  emailFrom?: string | null;
  emailReplyTo?: string | null;
  status: string;
};

export default function TenantEditPage() {
  const params = useParams();
  const tenantId = params?.tenantId as string;

  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [domain, setDomain] = useState("");
  const [brandName, setBrandName] = useState("");
  const [emailFrom, setEmailFrom] = useState("");
  const [emailReplyTo, setEmailReplyTo] = useState("");
  const [status, setStatus] = useState("active");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [partnerConfig, setPartnerConfig] = useState<any>(null);
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const [lastGeneratedApiKey, setLastGeneratedApiKey] = useState<string | null>(null);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [billingCustomerId, setBillingCustomerId] = useState("");
  const [billingPlanField, setBillingPlanField] = useState("");

  useEffect(() => {
    async function loadTenant() {
      const token = localStorage.getItem("tenant_portal_token");
      if (!token) {
        setError("No admin token found.");
        return;
      }

      const res = await fetch(`/api/admin/tenants/${tenantId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Unable to load tenant details");
        return;
      }

      setTenant(json.tenant);
      setName(json.tenant.name || "");
      setSlug(json.tenant.slug || "");
      setDomain(json.tenant.domain || "");
      setBrandName(json.tenant.brandName || "");
      setEmailFrom(json.tenant.emailFrom || "");
      setEmailReplyTo(json.tenant.emailReplyTo || "");
      setStatus(json.tenant.status || "active");
    }

    if (tenantId) {
      loadTenant();
      loadPartnerConfig();
    }
  }, [tenantId]);

  async function loadPartnerConfig() {
    const token = localStorage.getItem("tenant_portal_token");
    if (!token) return;
    try {
      const res = await fetch(`/api/admin/partner/${tenantId}`, { headers: { Authorization: `Bearer ${token}` } });
      const json = await res.json();
      if (res.ok) {
        setPartnerConfig(json.config);
        setWebhookUrl(json.config?.webhookUrl ?? "");
        setWebhookSecret(json.config?.webhookSecret ?? "");
        setBillingCustomerId(json.config?.billingCustomerId ?? "");
        setBillingPlanField(json.config?.billingPlan ?? "");
      }
    } catch (e) {
      // ignore
    }
  }

  async function saveTenant(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage("Saving...");

    const token = localStorage.getItem("tenant_portal_token");
    if (!token) {
      setError("No admin token found.");
      setMessage(null);
      return;
    }

    const res = await fetch(`/api/admin/tenants/${tenantId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ name, slug, domain, brandName, emailFrom, emailReplyTo, status }),
    });
    const json = await res.json();
    if (!res.ok) {
      setError(json.error || "Unable to save tenant updates");
      setMessage(null);
      return;
    }

    setTenant(json.tenant);
    setMessage("Tenant updated successfully.");
  }

  return (
    <main>
      <h1 className="page-title">Edit Tenant</h1>
      <p className="page-subtitle">Update tenant settings, branding, and status.</p>

      {error ? <p style={{ color: "#B91C1C" }}>{error}</p> : null}
      {message ? <p style={{ color: "#15803D" }}>{message}</p> : null}

      <section className="panel-group">
        <section className="panel">
          <form onSubmit={saveTenant} className="field-group">
            <label className="field-label">
              Name
              <input className="input" value={name} onChange={(event) => setName(event.target.value)} required />
            </label>
            <label className="field-label">
              Slug
              <input className="input" value={slug} onChange={(event) => setSlug(event.target.value)} required />
            </label>
            <label className="field-label">
              Domain
              <input className="input" value={domain} onChange={(event) => setDomain(event.target.value)} />
            </label>
            <label className="field-label">
              Brand Name
              <input className="input" value={brandName} onChange={(event) => setBrandName(event.target.value)} />
            </label>
            <label className="field-label">
              Email From
              <input className="input" value={emailFrom} onChange={(event) => setEmailFrom(event.target.value)} />
            </label>
            <label className="field-label">
              Email Reply-To
              <input className="input" value={emailReplyTo} onChange={(event) => setEmailReplyTo(event.target.value)} />
            </label>
            <label className="field-label">
              Status
              <select className="select" value={status} onChange={(event) => setStatus(event.target.value)}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>
            <button type="submit" className="button button-primary">
              Save Tenant
            </button>
          </form>
        </section>

        {tenant ? (
          <section className="panel">
            <h2 className="section-heading">Current Tenant</h2>
            <div className="card-grid">
              <div className="card">
                <p className="card-title">Tenant ID</p>
                <p className="card-meta">{tenant.id}</p>
              </div>
              <div className="card">
                <p className="card-title">Slug</p>
                <p className="card-meta">{tenant.slug}</p>
              </div>
              <div className="card">
                <p className="card-title">Status</p>
                <p className="card-meta">{tenant.status}</p>
              </div>
            </div>
            <div style={{ marginTop: 18 }}>
              <h3 className="section-heading">Partner Config</h3>
              {partnerConfig ? (
                <div style={{ display: "grid", gap: 8 }}>
                  <div>
                    <strong>Plan:</strong> {partnerConfig.plan || "(none)"}
                  </div>
                  <div>
                    <strong>API Key:</strong>{' '}
                    {apiKeyVisible && lastGeneratedApiKey ? (
                      <code>{lastGeneratedApiKey}</code>
                    ) : (
                      <code>••••••••••••••••••••••••••••••</code>
                    )}
                    <button
                      style={{ marginLeft: 8 }}
                      className="button button-secondary"
                      onClick={() => setApiKeyVisible((v) => !v)}
                    >
                      {apiKeyVisible ? "Hide" : "Show"}
                    </button>
                  </div>

                  <div style={{ marginTop: 8 }}>
                    <label className="field-label">
                      Webhook URL
                      <input className="input" value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} />
                    </label>
                    <label className="field-label">
                      Webhook Secret
                      <input className="input" value={webhookSecret} onChange={(e) => setWebhookSecret(e.target.value)} />
                    </label>
                    <label className="field-label">
                      Billing Customer ID
                      <input className="input" value={billingCustomerId} onChange={(e) => setBillingCustomerId(e.target.value)} />
                    </label>
                    <label className="field-label">
                      Billing Plan
                      <input className="input" value={billingPlanField} onChange={(e) => setBillingPlanField(e.target.value)} />
                    </label>
                    <div style={{ marginTop: 8 }}>
                      <button
                        className="button button-secondary"
                        onClick={async () => {
                          setError(null);
                          setMessage("Saving partner config...");
                          const token = localStorage.getItem("tenant_portal_token");
                          if (!token) {
                            setError("No admin token found.");
                            setMessage(null);
                            return;
                          }
                          const res = await fetch(`/api/admin/partner/${tenantId}`, {
                            method: "PUT",
                            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                            body: JSON.stringify({ plan: partnerConfig.plan, metadata: partnerConfig.metadata, webhookUrl, webhookSecret, billingCustomerId, billingPlan: billingPlanField }),
                          });
                          const json = await res.json();
                          if (!res.ok) {
                            setError(json.error || "Unable to save partner config");
                            setMessage(null);
                            return;
                          }
                          setPartnerConfig(json.config);
                          setMessage("Partner config saved.");
                        }}
                      >
                        Save Partner Config
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ display: "grid", gap: 8 }}>
                  <p className="card-meta">No partner config exists for this tenant.</p>
                </div>
              )}

              <div style={{ marginTop: 12 }}>
                <button
                  className="button button-primary"
                  onClick={async () => {
                    setError(null);
                    setMessage("Generating API key...");
                    const token = localStorage.getItem("tenant_portal_token");
                    if (!token) {
                      setError("No admin token found.");
                      setMessage(null);
                      return;
                    }
                    const res = await fetch(`/api/admin/partner/generate`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                      body: JSON.stringify({ tenantId }),
                    });
                    const json = await res.json();
                    if (!res.ok) {
                      setError(json.error || "Unable to generate API key");
                      setMessage(null);
                      return;
                    }
                    setPartnerConfig(json.config ?? null);
                    setLastGeneratedApiKey(json.apiKey ?? null);
                    setApiKeyVisible(true);
                    setMessage("API key generated.");
                  }}
                >
                  Generate / Regenerate API Key
                </button>
              </div>
            </div>
          </section>
        ) : null}
      </section>
    </main>
  );
}
