/**
 * Hits every admin API route with a real super-admin session and reports what
 * breaks.
 *
 * Written because "the dashboard doesn't load" is not a diagnosis — there are
 * fifty-odd admin routes behind those screens and the failing one has to be
 * named before it can be fixed. Read-only: GET only, nothing is written.
 *
 *   npx tsx scripts/sweep-admin.ts [baseUrl]
 */

import { PrismaClient } from "@prisma/client";
import { encode } from "next-auth/jwt";
import { config as loadEnv } from "dotenv";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

const base = process.argv[2] ?? "http://localhost:3000";
const prisma = new PrismaClient();

/** Walk src/app/api/admin and turn each route.ts into a URL. */
function routes(dir: string, prefix = "/api/admin"): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      // A [param] segment needs a value; skipped rather than guessed at.
      if (entry.startsWith("[")) continue;
      out.push(...routes(full, `${prefix}/${entry}`));
    } else if (entry === "route.ts") {
      out.push(prefix);
    }
  }
  return out;
}

async function main() {
  const admin = await prisma.user.findFirst({
    where: { role: "ADMIN", adminRole: "super", tenantId: { not: null } },
    select: { id: true, email: true, role: true, tenantId: true },
  });
  if (!admin) {
    console.error("No super admin with a tenant.");
    process.exit(1);
  }

  const token = await encode({
    secret: process.env.NEXTAUTH_SECRET!,
    token: {
      id: admin.id,
      email: admin.email,
      role: admin.role,
      tenantId: admin.tenantId,
      sub: admin.id,
    },
  });
  const cookie = `next-auth.session-token=${token}`;

  const all = routes(path.join("src", "app", "api", "admin")).sort();
  console.log(`as ${admin.email} — ${all.length} admin routes\n`);

  const broken: Array<{ path: string; status: number; body: string }> = [];

  for (const route of all) {
    try {
      const response = await fetch(`${base}${route}`, { headers: { cookie } });
      const text = await response.text();
      if (response.status >= 500) {
        broken.push({ path: route, status: response.status, body: text.slice(0, 160) });
        console.log(`  ${String(response.status).padEnd(4)} ${route}`);
      }
    } catch (error) {
      broken.push({
        path: route,
        status: 0,
        body: error instanceof Error ? error.message : String(error),
      });
      console.log(`  ERR  ${route}`);
    }
  }

  console.log(
    broken.length === 0
      ? "\nevery admin route answers without a server error."
      : `\n${broken.length} of ${all.length} routes are failing:`,
  );
  for (const item of broken) console.log(`\n${item.path}\n  ${item.body}`);

  await prisma.$disconnect();
  process.exit(broken.length === 0 ? 0 : 1);
}

main();
