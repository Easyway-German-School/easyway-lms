/**
 * One-off: park the Ghana branch.
 *
 * Sets Ghana's status to "inactive" so it drops out of the signup branch picker
 * (/api/branches filters status="active") and the admin default lists, while the
 * row and any future data are kept. Reversible: flip it back to "active" in
 * /admin/branches → Edit, or re-run with STATUS=active.
 *
 *   node scripts/deactivate-ghana-branch.mjs
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const target = (process.env.STATUS || "inactive").trim();

const ghana = await prisma.branch.findFirst({
  where: { name: "Ghana" },
  select: { id: true, name: true, status: true, _count: { select: { students: true } } },
});

if (!ghana) {
  console.log("No branch named 'Ghana' found — nothing to do.");
} else if (ghana.status === target) {
  console.log(`Ghana branch is already ${target}. (${ghana._count.students} students attached.)`);
} else {
  await prisma.branch.update({ where: { id: ghana.id }, data: { status: target } });
  console.log(`Ghana branch: ${ghana.status} → ${target}. (${ghana._count.students} students attached.)`);
}

await prisma.$disconnect();
