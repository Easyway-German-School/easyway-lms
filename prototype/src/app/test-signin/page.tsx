"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";

export default function TestSignIn() {
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const handleSignIn = async () => {
    setLoading(true);
    console.log("Attempting signin with nextauth/react.signIn...");
    
    try {
      const result = await signIn("credentials", {
        email: "admin@easyway.test",
        password: "AdminPass123!",
        role: "admin",
        redirect: false,
      });
      console.log("SignIn result:", result);
      setResult(result);
    } catch (error) {
      console.error("Error:", error);
      setResult({ error: String(error) });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: "20px", fontFamily: "monospace" }}>
      <h1>NextAuth Signin Test</h1>
      <button onClick={handleSignIn} disabled={loading}>
        {loading ? "Signing in..." : "Test SignIn"}
      </button>
      <pre>{JSON.stringify(result, null, 2)}</pre>
    </div>
  );
}
