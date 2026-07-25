const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  const users = await prisma.user.findMany({
    include: { student: true },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  console.log(JSON.stringify(users.map((u) => ({
    id: u.id,
    email: u.email,
    role: u.role,
    studentId: u.student?.id || null,
    studentLevel: u.student?.level || null,
    studentPathway: u.student?.pathway || null,
  })), null, 2));

  await prisma.$disconnect();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
