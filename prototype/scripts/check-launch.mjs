/**
 * Pre-launch preflight: is this deployment actually installable and safe?
 *
 * Written because "it works on localhost" answers none of the questions that
 * decide whether a student can put this on their home screen. Half of what a
 * PWA needs is invisible in development — HTTPS is assumed, `NEXTAUTH_URL`
 * points at localhost and is never wrong, and email links resolve because the
 * origin happens to match. All three break silently on a real domain, and each
 * one fails in a way that looks like something else:
 *
 *   NEXTAUTH_URL wrong        sign-in redirects to localhost and appears to
 *                             "just not work" for everyone
 *   NEXT_PUBLIC_APP_URL unset every button in every email is a dead relative
 *                             link, and nobody reports it
 *   no HTTPS                  no install prompt, no service worker, no push,
 *                             and no error message anywhere
 *
 * Usage:
 *   node scripts/check-launch.mjs                       (env only)
 *   node scripts/check-launch.mjs https://your.domain   (env + live checks)
 */

const target = process.argv[2]?.replace(/\/$/, "") ?? null;

let failures = 0;
let warnings = 0;

const pass = (label, detail = "") => console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ""}`);
const warn = (label, detail) => { warnings++; console.log(`  WARN  ${label} — ${detail}`); };
const fail = (label, detail) => { failures++; console.log(`  FAIL  ${label} — ${detail}`); };

function section(name) {
  console.log(`\n${name}`);
  console.log("-".repeat(name.length));
}

/* -------------------------------------------------------------------------- */

section("Environment");

const env = process.env;
const isSet = (key) => typeof env[key] === "string" && env[key].trim() !== "";

// The one that breaks sign-in for everybody, silently.
if (!isSet("NEXTAUTH_URL")) {
  fail("NEXTAUTH_URL", "unset — sign-in will redirect to the wrong origin");
} else if (/localhost|127\.0\.0\.1/.test(env.NEXTAUTH_URL)) {
  fail("NEXTAUTH_URL", `still points at ${env.NEXTAUTH_URL} — must be the real domain`);
} else if (!env.NEXTAUTH_URL.startsWith("https://")) {
  fail("NEXTAUTH_URL", "must be https:// in production");
} else {
  pass("NEXTAUTH_URL", env.NEXTAUTH_URL);
}

if (!isSet("NEXTAUTH_SECRET")) fail("NEXTAUTH_SECRET", "unset — sessions cannot be signed");
else if (env.NEXTAUTH_SECRET.length < 32) warn("NEXTAUTH_SECRET", "shorter than 32 chars");
else pass("NEXTAUTH_SECRET", "set");

// Every absolute link in every email comes from this.
if (!isSet("NEXT_PUBLIC_APP_URL")) {
  fail("NEXT_PUBLIC_APP_URL", "unset — email buttons become dead relative links");
} else if (/localhost|127\.0\.0\.1/.test(env.NEXT_PUBLIC_APP_URL)) {
  fail("NEXT_PUBLIC_APP_URL", "points at localhost — emails will link students to their own machine");
} else {
  pass("NEXT_PUBLIC_APP_URL", env.NEXT_PUBLIC_APP_URL);
}

if (!isSet("DATABASE_URL")) fail("DATABASE_URL", "unset");
else if (!/-pooler/.test(env.DATABASE_URL)) warn("DATABASE_URL", "not the pooled Neon host; serverless will exhaust connections");
else pass("DATABASE_URL", "pooled");

if (!isSet("DIRECT_DATABASE_URL")) warn("DIRECT_DATABASE_URL", "unset — migrations cannot run through the pooler");
else pass("DIRECT_DATABASE_URL", "set");

// Email: the provider preset supplies the HOST, so a mismatch here is the
// exact bug that made every send fail 535 while the credentials were correct.
const provider = (env.EMAIL_PROVIDER ?? "").trim().toLowerCase();
const smtpUser = env.SMTP_USER ?? "";
if (!provider && !isSet("SMTP_HOST")) {
  warn("EMAIL_PROVIDER", "unset — no email will be sent at all");
} else if (provider && smtpUser && !smtpUser.includes(provider) && provider !== "gmail") {
  fail("EMAIL_PROVIDER", `set to "${provider}" but SMTP_USER is "${smtpUser}" — the preset will dial the wrong host`);
} else {
  pass("EMAIL_PROVIDER", provider || `custom host ${env.SMTP_HOST}`);
}
if (isSet("SMTP_PORT") && env.SMTP_PORT !== "587") {
  warn("SMTP_PORT", `pinned to ${env.SMTP_PORT} — fine locally where 587 is blocked, usually unnecessary on Vercel`);
}

if (!isSet("CRON_SECRET")) warn("CRON_SECRET", "unset — the queue-drain endpoint has no scheduler auth");
else pass("CRON_SECRET", "set");

if (env.CSP_ENFORCE === "true") pass("CSP_ENFORCE", "Content-Security-Policy is enforced");
else warn("CSP_ENFORCE", "not 'true' — CSP is report-only and blocks nothing");

if (isSet("STORAGE_PUBLIC_BASE_URL")) {
  warn("STORAGE_PUBLIC_BASE_URL", "set — every stored file is world-readable, passport scans included");
} else {
  pass("STORAGE_PUBLIC_BASE_URL", "empty (files stay private)");
}

for (const key of ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"]) {
  if (!isSet(key)) warn(key, "unset — push notifications will not be delivered");
}
if (isSet("VAPID_PUBLIC_KEY") && isSet("VAPID_PRIVATE_KEY")) pass("VAPID keys", "push is configured");

/* -------------------------------------------------------------------------- */

if (!target) {
  console.log("\nNo URL given, so the live install checks were skipped.");
  console.log("Run: node scripts/check-launch.mjs https://your.domain\n");
} else {
  section(`Live install checks — ${target}`);

  if (!target.startsWith("https://")) {
    fail("HTTPS", "install, service workers and push ALL require https");
  } else {
    pass("HTTPS", "required for install; Vercel provides it");
  }

  const get = async (path) => {
    const res = await fetch(`${target}${path}`, { redirect: "manual" });
    return { status: res.status, headers: res.headers, body: await res.text().catch(() => "") };
  };

  try {
    const manifest = await get("/manifest.webmanifest");
    if (manifest.status !== 200) {
      fail("manifest", `HTTP ${manifest.status} — without it no browser offers "Add to home screen"`);
    } else {
      const m = JSON.parse(manifest.body);
      const icons = m.icons ?? [];
      const maskable = icons.filter((i) => String(i.purpose).includes("maskable"));
      const big = icons.find((i) => String(i.sizes).startsWith("512"));

      if (!m.name || !m.start_url || !m.display) fail("manifest fields", "name, start_url and display are all required");
      else pass("manifest", `${m.name} · ${m.display} · start_url ${m.start_url}`);

      if (!big) fail("manifest icons", "no 512px icon — Chrome will not offer installation");
      else pass("manifest icons", `${icons.length} declared`);

      if (maskable.length === 0) warn("maskable icon", "none — Android will shrink the logo into a white circle");
      else pass("maskable icon", `${maskable.length} declared`);

      // Every icon must actually resolve. A 404 here silently disqualifies the install.
      for (const icon of icons) {
        const res = await fetch(`${target}${icon.src}`, { method: "HEAD" });
        if (!res.ok) fail(`icon ${icon.src}`, `HTTP ${res.status}`);
      }
    }
  } catch (error) {
    fail("manifest", String(error.message));
  }

  try {
    const sw = await get("/sw.js");
    if (sw.status !== 200) fail("service worker", `/sw.js returned ${sw.status}`);
    else if (!sw.body.includes("addEventListener(\"fetch\"") && !sw.body.includes("addEventListener('fetch'")) {
      warn("service worker", "no fetch handler — offline support and some install paths need one");
    } else pass("service worker", "served with a fetch handler");
  } catch (error) {
    fail("service worker", String(error.message));
  }

  try {
    const offline = await get("/offline");
    if (offline.status !== 200) warn("offline page", `HTTP ${offline.status} — the worker precaches this`);
    else pass("offline page", "reachable");
  } catch { warn("offline page", "unreachable"); }

  try {
    const root = await get("/");
    const headers = root.headers;
    const need = {
      "strict-transport-security": "HSTS",
      "x-content-type-options": "nosniff",
      "x-frame-options": "clickjacking",
      "referrer-policy": "referrer leakage",
    };
    for (const [header, why] of Object.entries(need)) {
      if (headers.get(header)) pass(`header ${header}`, headers.get(header).slice(0, 48));
      else warn(`header ${header}`, `missing — ${why}`);
    }
    if (headers.get("content-security-policy")) pass("CSP", "enforced");
    else if (headers.get("content-security-policy-report-only")) warn("CSP", "report-only — set CSP_ENFORCE=true once the report is clean");
    else fail("CSP", "absent entirely");
  } catch (error) {
    fail("headers", String(error.message));
  }
}

/* -------------------------------------------------------------------------- */

console.log(`\n${failures} blocking, ${warnings} to look at.`);
if (failures > 0) {
  console.log("Blocking items must be fixed before launch.\n");
  process.exit(1);
}
console.log("No blockers.\n");
