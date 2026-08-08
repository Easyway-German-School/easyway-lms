import Link from "next/link";

export default function Header() {
  return (
    <header className="panel" style={{ marginBottom: 24, borderBottomLeftRadius: 24, borderBottomRightRadius: 24 }}>
      <nav style={{ display: "flex", flexWrap: "wrap", gap: 18, alignItems: "center" }}>
        <div style={{ fontWeight: 800, color: "var(--accent)", letterSpacing: "0.05em" }}>EASYWAY PORTAL</div>
        <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
          <Link href="/">Home</Link>
          <Link href="/login">Login</Link>
          <Link href="/register">Register</Link>
          <Link href="/tenant">Tenant</Link>
          <Link href="/partner">Partner</Link>
          <Link href="/admin">Admin</Link>
          <Link href="/admin/tenants">Admin Tenants</Link>
        </div>
      </nav>
    </header>
  );
}
