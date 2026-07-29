/**
 * Tells you, in one command, whether email is actually going to work.
 *
 *   node scripts/check-email.mjs
 *   node scripts/check-email.mjs you@example.com    (also sends a test email)
 *
 * Reads .env.local the same way the app does. Sends nothing unless you pass an
 * address.
 */
import fs from "fs";
import path from "path";

// Load .env.local / .env without pulling in a dependency.
for (const file of [".env.local", ".env"]) {
  const full = path.join(process.cwd(), file);
  if (!fs.existsSync(full)) continue;
  for (const line of fs.readFileSync(full, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const value = m[2].replace(/^["']|["']$/g, "");
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

const ML = process.env.MAILERLITE_API_KEY?.trim();
const MS = process.env.MAILERSEND_API_KEY?.trim();
const FROM = process.env.SMTP_FROM || "";

function describeToken(token) {
  if (!token) return "not set";
  const parts = token.split(".");
  if (parts.length !== 3) return `set (${token.length} chars, not a JWT)`;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(),
    );
    const scopes = Array.isArray(payload.scopes) ? payload.scopes : [];
    const expired = payload.exp ? Date.now() > payload.exp * 1000 : false;
    return [
      `account ${payload.sub}`,
      `scopes: ${scopes.length ? scopes.join(", ") : "NONE — this is why it will 401"}`,
      expired ? "EXPIRED" : "not expired",
    ].join(" · ");
  } catch {
    return "set (could not decode)";
  }
}

async function probe(label, url, token) {
  if (!token) {
    console.log(`  ${label.padEnd(14)} not configured`);
    return;
  }
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (res.ok) {
      console.log(`  ${label.padEnd(14)} OK (${res.status})`);
      return;
    }
    const hint =
      res.status === 401
        ? "  <- key rejected. Most often the token was created with no scopes ticked."
        : "";
    console.log(`  ${label.padEnd(14)} FAILED ${res.status}${hint}`);
  } catch (error) {
    console.log(`  ${label.padEnd(14)} unreachable — ${error.message}`);
  }
}

async function main() {
  console.log("EMAIL CONFIGURATION\n");
  console.log("  MAILERLITE_API_KEY  ", describeToken(ML));
  console.log("  MAILERSEND_API_KEY  ", describeToken(MS));
  console.log("  SMTP_HOST           ", process.env.SMTP_HOST || "not set");
  console.log("  SMTP_FROM           ", FROM || "not set");

  console.log("\nCONNECTIVITY\n");
  await probe("MailerLite", "https://connect.mailerlite.com/api/groups?limit=1", ML);
  await probe("MailerSend", "https://api.mailersend.com/v1/domains", MS);

  const transport = MS ? "MailerSend" : process.env.SMTP_HOST ? "SMTP" : "NONE";
  console.log(`\n  Transactional mail will go via: ${transport}`);
  if (transport === "NONE") {
    console.log("  Nothing will be delivered — the queue will hold messages until this is set.");
  }

  const recipient = process.argv[2];
  if (!recipient) {
    console.log("\nPass an email address to send a real test message.");
    return;
  }

  if (!MS) {
    console.log("\nCannot send a test: MAILERSEND_API_KEY is not set.");
    console.log("MailerLite's own API has no send-to-one-person endpoint — that is MailerSend's job.");
    return;
  }

  console.log(`\nSending a test message to ${recipient}…`);
  const m = FROM.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  const from = m ? { name: m[1] || undefined, email: m[2] } : { email: FROM };

  const res = await fetch("https://api.mailersend.com/v1/email", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${MS}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      from: { email: from.email, name: from.name ?? "Easyway German Language School" },
      to: [{ email: recipient }],
      subject: "Easyway LMS — email test",
      html: "<p>If you are reading this, outbound email from the LMS is working.</p>",
    }),
  });

  if (res.status === 202) {
    console.log("Accepted for delivery (202).");
  } else {
    let body = "";
    try { body = JSON.stringify(await res.json()); } catch { /* ignore */ }
    console.log(`Rejected (${res.status}). ${body.slice(0, 400)}`);
    if (res.status === 422) {
      console.log("\n422 usually means the FROM domain is not verified in MailerSend.");
      console.log(`SMTP_FROM is currently "${FROM}".`);
    }
  }
}

main().catch((e) => {
  console.error("Check failed:", e);
  process.exitCode = 1;
});
