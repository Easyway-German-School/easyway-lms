/**
 * Apply the team-mode migration.
 *
 * Executed statement by statement through the Prisma client rather than
 * `prisma migrate`, because this project moved from `db push` to migrations
 * midway and `migrate dev` would try to reconcile a history the database does
 * not have — see prisma/manual/README. Every statement is `IF NOT EXISTS`, so
 * running this twice is a no-op.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const STATEMENTS = [
  `ALTER TABLE "QuizGame" ADD COLUMN IF NOT EXISTS "teamMode" BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE "QuizGamePlayer" ADD COLUMN IF NOT EXISTS "team" TEXT`,
  `CREATE INDEX IF NOT EXISTS "QuizGamePlayer_gameId_team_idx" ON "QuizGamePlayer" ("gameId", "team")`,
];

async function main() {
  for (const statement of STATEMENTS) {
    console.log(`> ${statement.slice(0, 78)}…`);
    await prisma.$executeRawUnsafe(statement);
  }

  const rows = await prisma.$queryRaw<Array<{ table_name: string; column_name: string }>>`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE (table_name = 'QuizGame' AND column_name = 'teamMode')
       OR (table_name = 'QuizGamePlayer' AND column_name = 'team')
  `;
  console.log("\nVerified:", rows);
  if (rows.length !== 2) throw new Error("Columns are still missing after the migration.");
  console.log("APPLIED");
}

main()
  .catch((e) => {
    console.error("FAILED:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
