"use client";

import { useState } from "react";

export default function RegisterPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [tenantSlug, setTenantSlug] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);

    const response = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, name, tenantSlug: tenantSlug || undefined }),
    });

    const data = await response.json();
    if (!response.ok) {
      setMessage(data.error || "Registration failed");
      return;
    }

    setMessage("User created. Please log in.");
  }

  return (
    <main style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1>Register</h1>
      <form onSubmit={handleSubmit} style={{ maxWidth: 420, display: "grid", gap: 12 }}>
        <label>
          Name
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            style={{ width: "100%", padding: 8, marginTop: 4 }}
          />
        </label>
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            style={{ width: "100%", padding: 8, marginTop: 4 }}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            style={{ width: "100%", padding: 8, marginTop: 4 }}
          />
        </label>
        <label>
          Tenant Slug (optional)
          <input
            type="text"
            value={tenantSlug}
            onChange={(event) => setTenantSlug(event.target.value)}
            placeholder="demo-tenant"
            style={{ width: "100%", padding: 8, marginTop: 4 }}
          />
        </label>
        <button type="submit" style={{ padding: "10px 16px", cursor: "pointer" }}>
          Register
        </button>
      </form>
      {message ? <p>{message}</p> : null}
      <p>If you know a tenant slug, enter it to join that tenant immediately.</p>
    </main>
  );
}
