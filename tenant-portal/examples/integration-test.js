// Integration test: seed -> generate -> public API -> assert
// Requires Node 18+ (global fetch). If you run an older Node, upgrade or run via a compatible runtime.
if (typeof fetch === "undefined") {
  console.error("This script requires Node 18+ with global fetch. Update Node or run with a compatible runtime.");
  process.exit(1);
}

const BASE = process.env.BASE_URL || "http://localhost:3000";

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

async function main() {
  console.log("Seeding demo tenant...");
  const seedRes = await fetch(`${BASE}/api/admin/seed`, { method: "POST" });
  const seedJson = await seedRes.json();
  if (!seedRes.ok) fail(`Seed failed: ${JSON.stringify(seedJson)}`);

  const token = seedJson.token;
  const tenant = seedJson.tenant;
  console.log("Seed OK, tenant:", tenant.slug);

  console.log("Generating API key via admin generate endpoint...");
  const genRes = await fetch(`${BASE}/api/admin/partner/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ tenantId: tenant.id }),
  });
  const genJson = await genRes.json();
  if (!genRes.ok) fail(`Generate failed: ${JSON.stringify(genJson)}`);

  const apiKey = genJson.apiKey;
  if (!apiKey) fail("No apiKey returned from generate");
  console.log("Generated API key (plaintext returned once):", apiKey);

  console.log("Calling public partner API with key...");
  const pubRes = await fetch(`${BASE}/api/public/partner?apiKey=${encodeURIComponent(apiKey)}`);
  const pubJson = await pubRes.json();
  if (!pubRes.ok) fail(`Public API failed: ${JSON.stringify(pubJson)}`);

  if (!pubJson.tenant || pubJson.tenant.slug !== tenant.slug) {
    fail(`Unexpected public API response: ${JSON.stringify(pubJson)}`);
  }

  console.log("Integration test passed.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
