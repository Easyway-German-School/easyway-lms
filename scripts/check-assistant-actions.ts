import { prisma } from "@/lib/prisma";
import { resolveAdmin, type AdminContext } from "@/lib/admin-roles";
import { ASSISTANT_ACTIONS, PlanError } from "@/lib/assistant-actions";
import { cancelPlan, createPlan, executePlan } from "@/lib/action-plans";

/**
 * Prove the confirm-before-execute machinery, without a model in the loop.
 *
 *   npm run check:actions
 *
 * WHY THIS EXISTS. The assistant can now change the school's records, and the
 * only thing standing between a mis-filled argument and two hundred phones is
 * the plan/confirm split. That split is worth more than a code review: it is
 * worth a script that actually runs it, because the failure it prevents is
 * silent and the code that prevents it looks fine either way.
 *
 * It deliberately does NOT need an AI provider. The model's whole job is to
 * choose a tool and fill in arguments — everything that happens after that is
 * this file's subject, and mixing a live model into the test would make a
 * safety check depend on an API key and a credit balance.
 *
 * WHAT IT ASSERTS, in order of how badly it would hurt to get wrong:
 *
 *   1. A plan does not touch the database until it is confirmed.
 *   2. Confirming twice does the work once.
 *   3. An expired plan is refused.
 *   4. A cancelled plan is refused.
 *   5. An admin without the capability is refused, even holding a valid id.
 *   6. Bad arguments come back as advice, not as a crash.
 *
 * It writes to whatever DATABASE_URL points at, so it cleans up after itself
 * and refuses to run against anything that does not look like the dev file.
 */

const PASS = "[32m✓[0m";
const FAIL = "[31m✗[0m";

let failures = 0;

function check(label: string, condition: boolean, detail = ""): void {
  if (condition) {
    console.log(`${PASS} ${label}`);
  } else {
    failures += 1;
    console.log(`${FAIL} ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/** A stand-in admin with exactly the capabilities named, and nothing else. */
function fakeAdmin(userId: string, capabilities: string[]): AdminContext {
  return {
    userId,
    adminRole: "secretary",
    capabilities: capabilities as AdminContext["capabilities"],
    can: (capability) => capabilities.includes(capability),
  };
}

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/dev\.db/.test(url)) {
    throw new Error(
      `Refusing to run: DATABASE_URL is "${url}", which is not the development database. This script writes notifications.`,
    );
  }

  const adminUser = await prisma.user.findFirst({
    where: { role: "ADMIN" as never },
    select: { id: true, email: true },
  });
  if (!adminUser) throw new Error("No admin account in the database. Run the seed first.");

  const admin = await resolveAdmin(adminUser.id);
  if (!admin) throw new Error("That admin did not resolve.");
  console.log(`Acting as ${adminUser.email} (${admin.capabilities.length} capabilities)\n`);

  /* ---------------------------------------------------------------- 0. shape */

  console.log("Registry");
  const names = ASSISTANT_ACTIONS.map((action) => action.name);
  check("every action has a unique name", new Set(names).size === names.length);
  check(
    "every action declares a capability",
    ASSISTANT_ACTIONS.every((action) => Boolean(action.capability)),
  );
  check(
    "every action's spec name matches its registry name",
    ASSISTANT_ACTIONS.every((action) => action.spec.function.name === action.name),
  );

  /* ------------------------------------------------ 1. planning writes nothing */

  console.log("\nPlanning");
  const notificationsBefore = await prisma.notification.count();

  const planned = await createPlan(
    "message_students",
    {
      level: "A1",
      title: "Assistant safety check",
      message: "This is an automated check of the confirmation flow. Please ignore it.",
    },
    admin,
  );

  if (!planned.ok) {
    console.log(`${FAIL} could not plan a message: ${planned.forModel.error}`);
    process.exit(1);
  }

  check("a plan produces a preview with a count", planned.stored.preview.affected > 0);
  check("the preview names some of the actual people", planned.stored.preview.sample.length > 0);
  check(
    "PLANNING WROTE NOTHING",
    (await prisma.notification.count()) === notificationsBefore,
    "notifications appeared before anybody confirmed",
  );

  const row = await prisma.adminAction.findUnique({ where: { id: planned.stored.id } });
  check("the plan is stored as pending", row?.status === "pending");
  check("the payload is frozen server-side", Array.isArray((row?.payload as never)?.["studentIds"]));

  /* --------------------------------------------- 2. the wrong person is refused */

  console.log("\nCapability");
  const stranger = fakeAdmin(adminUser.id, ["students"]); // no "emails"
  const refused = await executePlan(planned.stored.id, stranger);
  check(
    "an admin without the capability cannot run it",
    !refused.ok && refused.status === 403,
    refused.ok ? "it ran anyway" : `got ${refused.status}`,
  );
  check(
    "and the refusal left it pending",
    (await prisma.adminAction.findUnique({ where: { id: planned.stored.id } }))?.status === "pending",
  );

  /* ---------------------------------------------------------- 3. confirming */

  console.log("\nConfirming");
  const executed = await executePlan(planned.stored.id, admin);
  check("confirming runs it", executed.ok, executed.ok ? "" : executed.error);

  const notificationsAfter = await prisma.notification.count();
  check(
    "and it actually did the work",
    notificationsAfter > notificationsBefore,
    `${notificationsBefore} → ${notificationsAfter}`,
  );

  const again = await executePlan(planned.stored.id, admin);
  check(
    "CONFIRMING TWICE DOES THE WORK ONCE",
    !again.ok && again.status === 409,
    again.ok ? "it ran a second time" : `got ${again.status}`,
  );
  check(
    "the second attempt sent nothing more",
    (await prisma.notification.count()) === notificationsAfter,
  );

  /* ------------------------------------------------------------- 4. expiry */

  console.log("\nExpiry and cancellation");
  const stale = await createPlan(
    "message_students",
    { level: "A1", title: "Stale check", message: "Should never be delivered." },
    admin,
  );
  if (stale.ok) {
    await prisma.adminAction.update({
      where: { id: stale.stored.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    const expired = await executePlan(stale.stored.id, admin);
    check(
      "an expired plan is refused",
      !expired.ok && expired.status === 410,
      expired.ok ? "it ran anyway" : `got ${expired.status}`,
    );
  }

  const doomed = await createPlan(
    "message_students",
    { level: "A1", title: "Cancel check", message: "Should never be delivered." },
    admin,
  );
  if (doomed.ok) {
    check("a plan can be discarded", await cancelPlan(doomed.stored.id, admin));
    const afterCancel = await executePlan(doomed.stored.id, admin);
    check(
      "a discarded plan cannot then be run",
      !afterCancel.ok && afterCancel.status === 409,
      afterCancel.ok ? "it ran anyway" : `got ${afterCancel.status}`,
    );
  }

  /* ------------------------------------------- 5. bad arguments are coachable */

  console.log("\nBad arguments");
  const noMessage = await createPlan("message_students", { level: "A1", title: "Only a title" }, admin);
  check(
    "a missing message is advice, not a crash",
    !noMessage.ok && /message/i.test(noMessage.forModel.error),
    noMessage.ok ? "it planned anyway" : noMessage.forModel.error,
  );

  const nobody = await createPlan(
    "message_students",
    { level: "A1", branch: "Atlantis", title: "T", message: "M" },
    admin,
  );
  check(
    "an unknown campus matches nobody rather than everybody",
    !nobody.ok,
    nobody.ok ? `it matched ${nobody.stored.preview.affected} students` : "",
  );

  const withAmount = await createPlan(
    "send_fee_reminders",
    { note: "Please pay your NGN 90,000 balance this week." },
    admin,
  );
  check(
    "a fee note containing an amount is rejected",
    !withAmount.ok,
    withAmount.ok ? "it would have sent one figure to everybody" : "",
  );

  const futureRegister = await createPlan(
    "mark_attendance",
    { branch: "Lagos", level: "A1", date: "2099-01-01" },
    admin,
  );
  check("a register cannot be marked for the future", !futureRegister.ok);

  const vagueDate = await createPlan(
    "mark_attendance",
    { branch: "Lagos", level: "A1", date: "next Tuesday" },
    admin,
  );
  check("a vague date is refused rather than guessed", !vagueDate.ok);

  check("PlanError is what carries all of that", new PlanError("x") instanceof Error);

  /* ------------------------------------------------------------- clean up */

  console.log("\nCleaning up");
  const removed = await prisma.notification.deleteMany({
    where: { title: { in: ["Assistant safety check", "Stale check", "Cancel check"] } },
  });
  await prisma.adminAction.deleteMany({
    where: { summary: { contains: "Assistant safety check" } },
  });
  console.log(`  removed ${removed.count} test notification${removed.count === 1 ? "" : "s"}`);

  console.log(
    failures === 0
      ? `\n${PASS} all checks passed`
      : `\n${FAIL} ${failures} check${failures === 1 ? "" : "s"} failed`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
