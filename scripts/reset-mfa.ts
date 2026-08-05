/**
 * Clear two-factor authentication from one admin account.
 *
 *   npx tsx --tsconfig tsconfig.json --env-file=.env.local scripts/reset-mfa.ts them@easyway.example
 *
 * The break-glass path for an admin who has lost both their phone and their
 * backup codes. Run by a DIFFERENT super admin, after confirming over
 * something other than email that the person asking is really them — email is
 * the one thing an attacker who has got this far most likely already controls.
 *
 * There is no self-service version of this on purpose. A self-service reset is
 * a password reset wearing a hat: anybody who can trigger it has bypassed the
 * second factor completely, which leaves the account exactly as protected as
 * the password that was already assumed to be leaking.
 *
 * See docs/SECURITY.md §2.6.
 */

import { unguardedPrisma } from "../src/lib/prisma";
import { runWithAuditActor } from "../src/lib/audit-context";
import { writeAudit } from "../src/lib/prisma-guard";

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();

  if (!email || !email.includes("@")) {
    console.error("Usage: reset-mfa.ts <email>\n");
    console.error("Pass the email address of the admin whose two-factor should be cleared.");
    process.exit(1);
  }

  // Deliberately the unguarded client: the point of this script is to reach an
  // account the app itself will not let anybody touch.
  const user = await unguardedPrisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, role: true, totpEnabledAt: true, deletedAt: true },
  });

  if (!user) {
    console.error(`No account with the address ${email}.`);
    process.exit(1);
  }

  if (user.deletedAt) {
    console.error(`${email} is a deleted account. Restore it from /admin/security first.`);
    process.exit(1);
  }

  if (!user.totpEnabledAt) {
    console.log(`${email} does not have two-factor switched on. Nothing to clear.`);
    return;
  }

  await runWithAuditActor(
    { email: "reset-mfa.ts", role: "script", source: "script" },
    async () => {
      await unguardedPrisma.user.update({
        where: { id: user.id },
        data: {
          totpSecret: null,
          totpEnabledAt: null,
          totpBackupCodes: undefined,
          totpLastStep: null,
        },
      });

      // `required`, because this is the only record that it happened. Removing
      // somebody's second factor from a shell is indistinguishable from an
      // attacker doing the same thing, and the trail is what tells them apart
      // afterwards — a silent failure here would erase that distinction.
      await writeAudit(
        unguardedPrisma,
        {
          action: "permissionChange",
          model: "User",
          recordId: user.id,
          affectedCount: 1,
          severity: "alert",
          summary: `Two-factor authentication RESET from the command line for ${user.email}`,
        },
        { required: true },
      );
    },
  );

  console.log(`Cleared two-factor for ${user.email}.`);
  console.log("They must enrol again at /admin/security before they can sign in.");
  console.log("This is recorded in the activity trail as an alert.");
}

main()
  .catch((error) => {
    console.error("Failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => unguardedPrisma.$disconnect());
