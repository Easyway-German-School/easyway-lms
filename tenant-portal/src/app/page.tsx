import Link from "next/link";

export default function HomePage() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 24 }}>
      <h1>Tenant Portal Proof-of-Concept</h1>
      <p>
        This is an isolated sample workspace demonstrating a tenant-first auth and partner config flow.
      </p>
      <ul>
        <li>
          <Link href="/login">Login</Link>
        </li>
        <li>
          <Link href="/register">Register</Link>
        </li>
        <li>
          <Link href="/tenant">Tenant info</Link>
        </li>
        <li>
          <Link href="/partner">Partner config</Link>
        </li>
        <li>
          <Link href="/admin">Admin / Seed demo tenant</Link>
        </li>
      </ul>
      <p>
        The implementation lives in <code>src/lib</code> and uses a separate Prisma schema.
      </p>
      <p>
        Use <code>/admin</code> to create a seeded demo tenant and admin user for testing.
      </p>
    </main>
  );
}
