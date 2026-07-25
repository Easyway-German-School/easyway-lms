const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  try {
    const payments = await prisma.payment.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    console.log('PAYMENTS', JSON.stringify(payments, null, 2));

    const students = await prisma.student.findMany({
      include: {
        payments: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
      take: 5,
    });
    console.log('STUDENTS', JSON.stringify(students, null, 2));
  } catch (err) {
    console.error(err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
})();
