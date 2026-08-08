"use client";

import { useState } from "react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);

    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    const data = await response.json();
    if (!response.ok) {
      setMessage(data.error || "Login failed");
      return;
    }

    localStorage.setItem("tenant_portal_token", data.token);
    setMessage("Logged in. Token saved to localStorage.");
  }

  return (
    <main style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1>Login</h1>
      <form onSubmit={handleSubmit} style={{ maxWidth: 420, display: "grid", gap: 12 }}>
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
        <button type="submit" style={{ padding: "10px 16px", cursor: "pointer" }}>
          Sign in
        </button>
      </form>
      {message ? <p>{message}</p> : null}
      <p>After login, open /tenant or /partner to see tenant-aware data.</p>
    </main>
  );
}
