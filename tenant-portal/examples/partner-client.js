// Simple example client that calls the public partner API
// Requires Node 18+ (global fetch). If you run an older Node, upgrade or run via a tool that provides `fetch`.
if (typeof fetch === "undefined") {
  console.error("This script requires Node 18+ with global fetch. Update Node or run with a compatible runtime.");
  process.exit(1);
}

const API_URL = process.env.PARTNER_API_URL || "http://localhost:3000/api/public/partner";
const API_KEY = process.env.PARTNER_API_KEY || "demo-api-key-123";

async function main() {
  const res = await fetch(`${API_URL}?apiKey=${encodeURIComponent(API_KEY)}`);
  const json = await res.json();
  console.log(JSON.stringify(json, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
