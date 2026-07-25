const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    const student = await prisma.student.findFirst({ include: { user: true } });
    if (!student) {
      console.log('no_student_found');
      return;
    }

    const countBefore = await prisma.payment.count();
    console.log('payment_count_before=' + countBefore);

    const invoice = await prisma.invoice.create({
      data: {
        studentId: student.id,
        totalAmount: 25000,
        currency: 'NGN',
        status: 'paid',
        dueDate: new Date(),
        lineItems: {
          pathwayId: 'test-pathway',
          pathwayName: 'Test Pathway',
          paymentType: 'full',
          depositPercent: 100,
        },
      },
    });

    const created = await prisma.payment.create({
      data: {
        studentId: student.id,
        invoiceId: invoice.id,
        amount: 25000,
        currency: 'NGN',
        status: 'completed',
        method: 'paystack',
        description: 'Test payment',
        stripeSessionId: 'test-reference-' + Date.now(),
        paymentIntentId: 'test-reference-' + Date.now(),
      },
    });

    const countAfter = await prisma.payment.count();
    const studentWithPayments = await prisma.student.findUnique({
      where: { id: student.id },
      include: { payments: true },
    });

    console.log('payment_count_after=' + countAfter);
    console.log('created_payment_id=' + created.id);
    console.log('student_payment_count=' + (studentWithPayments?.payments?.length ?? 0));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();
