#!/usr/bin/env node
// Trigger the cron tick endpoint locally to run reconcileRecordings().
// Usage: CRON_SECRET=your_secret node scripts/trigger-cron.mjs [port]
const port = process.argv[2] || process.env.PORT || 3000;
const secret = process.env.CRON_SECRET;
if (!secret) {
  console.error('CRON_SECRET not set in environment.');
  process.exit(1);
}
const url = `http://localhost:${port}/api/cron/tick`;
console.log(`GET ${url}`);
(async () => {
  try {
    const res = await fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${secret}` } });
    const json = await res.json();
    console.log('Status:', res.status);
    console.log(JSON.stringify(json, null, 2));
  } catch (err) {
    console.error('Error calling cron tick:', err);
    process.exit(2);
  }
})();
