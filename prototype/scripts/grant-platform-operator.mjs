/**
 * Makes somebody an operator of the platform.
 *
 * There is deliberately no screen for this. Platform operator is the one role
 * that can see every school on the system at once, and a privilege that can be
 * granted by clicking is a privilege that eventually gets granted by accident
 * or by whoever compromises one admin account. Granting it should require a
 * shell, the production connection string, and somebody's deliberate intent.
 *
 *   node scripts/grant-platform-operator.mjs someone@example.com
 *   node scripts/grant-platform-operator.mjs someone@example.com --revoke
 *   node scripts/grant-platform-operator.mjs --list
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const args = process.argv.slice(2);
const revoke = args.includes("--revoke");
const list = args.includes("--list");
const email = args.find((a) => !a.startsWith("--"))?.trim().toLowerCase();

if (list) {
  const operators = await prisma.user.findMany({
    where: { platformRole: "operator" },
    select: { email: true, name: true },
  });
  console.log(
    operators.length
      ? operators.map((o) => `  ${o.email}${o.name ? ` (${o.name})` : ""}`).join("\n")
      : "  (nobody)",
  );
  await prisma.$disconnect();
  process.exit(0);
}

if (!email) {
  console.error("Usage: node scripts/grant-platform-operator.mjs <email> [--revoke]");
  console.error("       node scripts/grant-platform-operator.mjs --list");
  process.exit(1);
}

const user = await prisma.user.findUnique({
  where: { email },
  select: { id: true, email: true, name: true, platformRole: true },
});

if (!user) {
  console.error(`No account with the address ${email}.`);
  await prisma.$disconnect();
  process.exit(1);
}

await prisma.user.update({
  where: { id: user.id },
  data: { platformRole: revoke ? null : "operator" },
});

console.log(
  revoke
    ? `${user.email} is no longer a platform operator.`
    : `${user.email} is now a platform operator. This is separate from, and larger than, being a super admin of any one school.`,
);

await prisma.$disconnect();
