/**
 * Demo accounts for the two admin sub-roles.
 *
 * The sub-role work is only really testable by signing in as somebody who has
 * one, and until now the only way to get such an account was to promote a real
 * admin and then remember to put them back. This makes two throwaway accounts
 * with known passwords so a tester can see the reduced portal for themselves —
 * which sidebar entries disappear, which pages refuse them, and that the
 * assistant's briefing quietly loses its money section for a Secretary.
 *
 *   node scripts/seed-admin-roles.mjs
 *
 * Safe to run repeatedly: it upserts. It will not touch any account that is not
 * one of the two it owns, and it refuses to run against a non-local database
 * unless SEED_FORCE=1 — creating a known-password admin on a production box is
 * not something a script should be able to do by accident.
 */

import { PrismaClient } from "@prisma/client";
import bcryptjs from "bcryptjs";

const prisma = new PrismaClient();

const ACCOUNTS = [
  {
    email: "secretary@easyway.test",
    name: "Demo Secretary",
    password: "SecretaryPass123!",
    adminRole: "secretary",
    // The preset already covers students, attendance, classes, exams,
    // materials and branches. Left as null so this account demonstrates the
    // preset itself rather than a hand-adjusted one.
    adminCapabilities: null,
    blurb: "Front desk. No money, no staffing, no bulk email.",
  },
  {
    email: "datacomms@easyway.test",
    name: "Demo Data & Comms",
    password: "DataCommsPass123!",
    adminRole: "data_comm",
    // One deliberate per-person grant, so the override path is exercised too:
    // this person can see reports AND has been handed community moderation's
    // neighbour, emails, which their preset already carries — so instead we
    // revoke integrations to prove revocation wins.
    adminCapabilities: { grant: [], revoke: ["integrations"] },
    blurb: "Comms and reporting. Integrations revoked by hand to test the diff.",
  },
];

function isLocalDatabase() {
  const url = process.env.DATABASE_URL ?? "";
  return url.startsWith("file:") || url.includes("localhost") || url.includes("127.0.0.1");
}

async function main() {
  if (!isLocalDatabase() && process.env.SEED_FORCE !== "1") {
    console.error(
      "Refusing to run: DATABASE_URL does not look local.\n" +
        "These accounts have published passwords. Set SEED_FORCE=1 only if you are certain.",
    );
    process.exitCode = 1;
    return;
  }

  for (const account of ACCOUNTS) {
    const password = await bcryptjs.hash(account.password, 10);

    const user = await prisma.user.upsert({
      where: { email: account.email },
      update: {
        name: account.name,
        password,
        role: "ADMIN",
        adminRole: account.adminRole,
        adminCapabilities: account.adminCapabilities ?? undefined,
      },
      create: {
        email: account.email,
        name: account.name,
        password,
        role: "ADMIN",
        adminRole: account.adminRole,
        adminCapabilities: account.adminCapabilities ?? undefined,
      },
      select: { id: true, email: true, adminRole: true },
    });

    console.log(`  ${user.email.padEnd(28)} ${account.password.padEnd(20)} ${account.blurb}`);
  }

  console.log(
    "\nSign in at /auth/admin. Compare the sidebar with a super admin's, and try\n" +
      "typing /admin/payments as the Secretary — it should say 'Not your area',\n" +
      "not render an empty payments screen.",
  );
}

main()
  .catch((error) => {
    console.error("Seeding admin roles failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
