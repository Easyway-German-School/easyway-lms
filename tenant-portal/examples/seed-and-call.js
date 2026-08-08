// Seed the demo tenant via admin seed, then call the public partner API
// Requires Node 18+ (global fetch). If you run an older Node, upgrade or run via a compatible runtime.
if (typeof fetch === "undefined") {
  console.error("This script requires Node 18+ with global fetch. Update Node or run with a compatible runtime.");
  process.exit(1);
}

const BASE = process.env.BASE_URL || "http://localhost:3000";

async function main() {
  console.log("Seeding demo tenant...");
  const seedRes = await fetch(`${BASE}/api/admin/seed`, { method: "POST" });
  const seedJson = await seedRes.json();
  if (!seedRes.ok) {
    console.error("Seed failed:", seedJson);
    process.exit(1);
  }

  const apiKey = seedJson.apiKey;
  console.log("Seed complete. API Key:", apiKey);

  console.log("Calling public partner API...");
  const pubRes = await fetch(`${BASE}/api/public/partner?apiKey=${encodeURIComponent(apiKey)}`);
  const pubJson = await pubRes.json();
  console.log(JSON.stringify(pubJson, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
