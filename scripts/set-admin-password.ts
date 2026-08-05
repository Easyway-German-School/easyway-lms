/**
 * Create a super admin, or set the password on an existing one.
 *
 *   npx tsx --tsconfig tsconfig.json --env-file=.env.local scripts/set-admin-password.ts you@easywayabroad.com
 *
 * The password is typed at a prompt, never passed as an argument. An argument
 * would sit in the shell history, in the terminal scrollback, and in the
 * process list while it runs — three places a password should never be for an
 * account that can read every student's passport scan.
 *
 * This exists because the app has no password-reset flow, and the only admin
 * whose password was publicly known has been retired. Without it there is no
 * way back into a fresh deployment.
 *
 * Run it against production only from a machine you trust, with the live
 * DATABASE_URL in the environment.
 */

import readline from "node:readline";
import bcryptjs from "bcryptjs";
import { unguardedPrisma } from "../src/lib/prisma";
import { runWithAuditActor } from "../src/lib/audit-context";
import { writeAudit } from "../src/lib/prisma-guard";

/**
 * Read a password without printing it, but DO print a dot per character.
 *
 * The first version of this showed nothing at all. That is what a Unix
 * password prompt does, and it is wrong here: typing into what looks like a
 * dead terminal gives you no way to know whether the keystrokes registered, so
 * the confirmation step fails and you cannot tell why. A row of dots is not a
 * security weakness — the characters are still not on screen — and it is the
 * difference between a prompt that works and one that gets abandoned.
 *
 * Raw mode rather than readline's output hook, because that hook has to guess
 * which writes are the prompt and which are the user, and it guesses wrong on
 * a second prompt in the same process.
 */
function askHidden(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    process.stdout.write(question);

    const input = process.stdin;
    const wasRaw = input.isRaw;
    input.setRawMode(true);
    input.resume();
    input.setEncoding("utf8");

    let value = "";

    const done = (result: string) => {
      input.setRawMode(Boolean(wasRaw));
      input.pause();
      input.removeListener("data", onData);
      process.stdout.write("\n");
      resolve(result);
    };

    const onData = (chunk: string) => {
      for (const char of chunk) {
        switch (char) {
          case "\r":
          case "\n":
            return done(value);

          case "": // Ctrl-C
            input.setRawMode(Boolean(wasRaw));
            input.pause();
            process.stdout.write("\n");
            return reject(new Error("cancelled"));

          case "": // Backspace
          case "\b":
            if (value.length > 0) {
              value = value.slice(0, -1);
              // Rub the dot out: back up, overwrite with a space, back up again.
              process.stdout.write("\b \b");
            }
            break;

          default:
            // Ignore other control characters rather than storing them.
            if (char >= " ") {
              value += char;
              process.stdout.write("•");
            }
        }
      }
    };

    input.on("data", onData);
  });
}

/**
 * The bar is deliberately length-first.
 *
 * Length beats character-class rules — "Passw0rd!" satisfies every classic
 * complexity policy and is on the first page of every cracking dictionary,
 * while four unremarkable words are not. Twelve characters is the floor, and
 * the handful of passwords already known to be in this repository's history
 * are refused outright.
 */
function problemWith(password: string): string | null {
  if (password.length < 12) return "Too short — use at least 12 characters. Four random words is easier to type than a symbol soup, and stronger.";
  const burned = ["adminpass123!", "admin123", "password", "password123!", "easyway123"];
  if (burned.includes(password.toLowerCase())) return "That password appears in this project's git history. Pick another.";
  return null;
}

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    console.error("Usage: set-admin-password.ts <email>");
    console.error("\nCreates a super admin with that address, or resets the password on an existing one.");
    process.exit(1);
  }

  if (!process.stdin.isTTY) {
    console.error("This needs an interactive terminal — it prompts for the password rather than taking it as an argument.");
    process.exit(1);
  }

  const existing = await unguardedPrisma.user.findUnique({
    where: { email },
    select: { id: true, role: true, adminRole: true, deletedAt: true, totpEnabledAt: true },
  });

  if (existing?.deletedAt) {
    console.error(`${email} is a deleted account. Restore it from /admin/security first, or use a different address.`);
    process.exit(1);
  }

  console.log(existing ? `Setting the password for ${email}.` : `Creating a new super admin: ${email}.`);
  if (existing && String(existing.role).toLowerCase() !== "admin") {
    console.error(`\n${email} exists but is a ${existing.role}, not an admin. Refusing to change their role from here — that belongs in /admin/staff.`);
    process.exit(1);
  }

  const password = await askHidden("New password (not shown): ");
  const problem = problemWith(password);
  if (problem) {
    console.error(`\n${problem}`);
    process.exit(1);
  }

  const again = await askHidden("Type it again: ");
  if (again !== password) {
    console.error("\nThose did not match. Nothing changed.");
    process.exit(1);
  }

  const hash = await bcryptjs.hash(password, 12);

  await runWithAuditActor(
    { email: "set-admin-password.ts", role: "script", source: "script" },
    async () => {
      const user = existing
        ? await unguardedPrisma.user.update({
            where: { id: existing.id },
            data: { password: hash, passwordClaimed: true },
          })
        : await unguardedPrisma.user.create({
            data: {
              email,
              password: hash,
              role: "ADMIN",
              adminRole: "super",
              name: email.split("@")[0],
              passwordClaimed: true,
            },
          });

      await writeAudit(
        unguardedPrisma,
        {
          action: existing ? "permissionChange" : "create",
          model: "User",
          recordId: user.id,
          affectedCount: 1,
          severity: "alert",
          summary: existing
            ? `Admin password reset from the command line for ${email}`
            : `Super admin ${email} created from the command line`,
        },
        { required: true },
      );
    },
  );

  console.log(`\nDone. Sign in at /auth/admin as ${email}.`);
  if (existing?.totpEnabledAt) {
    console.log("Two-factor is still ON for this account — you will need your authenticator as well.");
  } else {
    console.log("Next: enrol in two-factor at /admin/security.");
  }
  console.log("This is recorded in the activity trail as an alert.");
}

main()
  .catch((error) => {
    console.error("Failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => unguardedPrisma.$disconnect());
