const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  const payments = await prisma.payment.findMany({
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      id: true,
      status: true,
      amount: true,
      method: true,
      createdAt: true,
      studentId: true,
      stripeSessionId: true,
      description: true,
    },
  });

  console.log(JSON.stringify(payments, null, 2));
  await prisma.$disconnect();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
