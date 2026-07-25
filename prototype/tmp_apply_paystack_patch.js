const fs = require('fs');
const path = require('path');
const root = path.resolve('c:/Users/HP/Documents/EASYWAY LMS/prototype');

function patch(file, oldText, newText) {
  const filePath = path.join(root, file);
  const content = fs.readFileSync(filePath, 'utf8');
  if (!content.includes(oldText)) {
    throw new Error(`Pattern not found in ${file}: ${oldText.slice(0, 60).replace(/\n/g, '\\n')}...`);
  }
  fs.writeFileSync(filePath, content.replace(oldText, newText), 'utf8');
  console.log(`Patched ${file}`);
}

try {
  patch(
    'src/app/api/paystack/initialize/route.ts',
    `    const resolvedPathwayId = resolvedPathway?.id ?? null;\n    const secretKey = process.env.PAYSTACK_SECRET_KEY;\n    const callbackUrlBase = process.env.PAYSTACK_CALLBACK_URL || \`${process.env.NEXTAUTH_URL || "http://localhost:3000"}/enrollment/success\`;\n    const callbackUrl = \`${callbackUrlBase}${callbackUrlBase.includes("?") ? "&" : "?"}source=paystack\`;\n\n    const studentRecord = await prisma.student.findUnique({\n      where: { userId: session.user.id as string },\n    });\n    const studentId = studentRecord?.id;\n\n    const userEmail = String(session.user.email || "").trim().toLowerCase();\n`,
    `    const resolvedPathwayId = resolvedPathway?.id ?? null;\n    const secretKey = process.env.PAYSTACK_SECRET_KEY;\n    const callbackUrlBase = process.env.PAYSTACK_CALLBACK_URL || \`${process.env.NEXTAUTH_URL || "http://localhost:3000"}/enrollment/success\`;\n    const callbackUrl = \`${callbackUrlBase}${callbackUrlBase.includes("?") ? "&" : "?"}source=paystack\`;\n\n    let studentRecord = await prisma.student.findUnique({\n      where: { userId: session.user.id as string },\n    });\n    if (!studentRecord) {
      studentRecord = await prisma.student.create({
        data: {
          userId: session.user.id as string,
          level: "A1",
          pathway: "Goethe exam mastery",
          examReadiness: 0,
        },
      });
    }
    const studentId = studentRecord.id;\n\n    const userEmail = String(session.user.email || "").trim().toLowerCase();\n`
  );

  patch(
    'src/app/api/paystack/webhook/route.ts',
    `    const data = payload.data || {};\n    const metadata = data.metadata || {};\n    const studentId = metadata.userId;\n    const pathwayId = metadata.pathwayId;\n    const pathwayName = metadata.pathwayName || "program";\n    const totalAmount = Number(metadata.totalAmount || 0);\n    const paymentAmount = Math.round(Number(data.amount || 0) / 100);\n    const paymentStage = String(metadata.paymentStage || metadata.paymentType || "full");\n    const paymentType = paymentStage === "registration" ? "registration" : paymentStage === "full" ? "full" : "deposit";\n    const depositPercent = Number(metadata.depositPercent || 100);\n\n    if (!studentId || !pathwayId) {\n      return NextResponse.json({ received: true });\n    }\n\n    await prisma.enrollment.upsert({\n      where: {\n        studentId_pathwayId: {\n          studentId,\n          pathwayId,\n        },\n      },\n      update: {\n        stripeSessionId: data.reference || null,\n        status: "active",\n      },\n      create: {\n        studentId,\n        pathwayId,\n        stripeSessionId: data.reference || null,\n        status: "active",\n      },\n    });\n`,
    `    const data = payload.data || {};\n    const metadata = data.metadata || {};\n    const rawStudentId = String(metadata.studentId || metadata.userId || "");\n    const pathwayId = String(metadata.pathwayId || "");\n    const pathwayName = metadata.pathwayName || "program";\n    const totalAmount = Number(metadata.totalAmount || 0);\n    const paymentAmount = Math.round(Number(data.amount || 0) / 100);\n    const paymentStage = String(metadata.paymentStage || metadata.paymentType || "full");\n    const paymentType = paymentStage === "registration" ? "registration" : paymentStage === "full" ? "full" : "deposit";\n    const depositPercent = Number(metadata.depositPercent || 100);\n\n    if (!rawStudentId || !pathwayId) {\n      console.error("Paystack webhook missing student or pathway metadata", { metadata });\n      return NextResponse.json({ received: true });\n    }\n\n    const student =\n      (await prisma.student.findUnique({ where: { id: rawStudentId } })) ||\n      (await prisma.student.findUnique({ where: { userId: rawStudentId } }));\n\n    if (!student) {\n      console.error("Paystack webhook could not resolve student", { rawStudentId, metadata });\n      return NextResponse.json({ received: true });\n    }\n\n    await prisma.enrollment.upsert({\n      where: {\n        studentId_pathwayId: {\n          studentId: student.id,\n          pathwayId,\n        },\n      },\n      update: {\n        stripeSessionId: data.reference || null,\n        status: "active",\n      },\n      create: {\n        studentId: student.id,\n        pathwayId,\n        stripeSessionId: data.reference || null,\n        status: "active",\n      },\n    });\n`
  );

  patch(
    'src/app/api/paystack/webhook/route.ts',
    `    await prisma.payment.create({\n      data: {\n        studentId,\n        invoiceId: invoice.id,\n        amount: paymentAmount,\n        currency: "NGN",\n        status: "completed",\n        method: "paystack",\n        description: getPaymentDescription(paymentType, pathwayName),\n        stripeSessionId: paymentReference,\n        paymentIntentId: paymentReference,\n      },\n    });\n`,
    `    await prisma.payment.create({\n      data: {\n        studentId: student.id,\n        invoiceId: invoice.id,\n        amount: paymentAmount,\n        currency: "NGN",\n        status: "completed",\n        method: "paystack",\n        description: getPaymentDescription(paymentType, pathwayName),\n        stripeSessionId: paymentReference,\n        paymentIntentId: paymentReference,\n      },\n    });\n`
  );

  patch(
    'src/app/api/paystack/webhook/route.ts',
    `      const reminder = await prisma.notification.create({\n        data: {\n          studentId,\n          title: "Deposit balance due",\n          message: \\`Your registration fee for ${pathwayName}. Please pay the remaining deposit to unlock premium content.\\`,\n          channel: "email",\n          status: "pending",\n        },\n      });\n`,
    `      const reminder = await prisma.notification.create({\n        data: {\n          studentId: student.id,\n          title: "Deposit balance due",\n          message: \\`Your registration fee for ${pathwayName}. Please pay the remaining deposit to unlock premium content.\\`,\n          channel: "email",\n          status: "pending",\n        },\n      });\n`
  );

  patch(
    'src/app/api/paystack/webhook/route.ts',
    `      const student = await prisma.student.findUnique({\n        where: { id: studentId },\n        include: { user: true },\n      });\n`,
    `      const student = await prisma.student.findUnique({\n        where: { id: student.id },\n        include: { user: true },\n      });\n`
  );

  patch(
    'src/app/api/paystack/webhook/route.ts',
    `      const reminder = await prisma.notification.create({\n        data: {\n          studentId,\n          title: "Remaining balance due",\n          message: \\`Your ${depositPercent}% deposit for ${pathwayName}. Please pay the remaining balance to continue your learning without interruption.\\`,\n          channel: "email",\n          status: "pending",\n        },\n      });\n`,
    `      const reminder = await prisma.notification.create({\n        data: {\n          studentId: student.id,\n          title: "Remaining balance due",\n          message: \\`Your ${depositPercent}% deposit for ${pathwayName}. Please pay the remaining balance to continue your learning without interruption.\\`,\n          channel: "email",\n          status: "pending",\n        },\n      });\n`
  );

  patch(
    'src/app/api/paystack/webhook/route.ts',
    `      const student = await prisma.student.findUnique({\n        where: { id: studentId },\n        include: { user: true },\n      });\n`,
    `      const student = await prisma.student.findUnique({\n        where: { id: student.id },\n        include: { user: true },\n      });\n`
  );

  patch(
    'src/app/api/paystack/webhook/route.ts',
    `    const confirmation = await prisma.notification.create({\n      data: {\n        studentId,\n        title:\n          paymentType === "registration"\n            ? "Registration fee received"\n            : paymentType === "deposit"\n            ? "Part-payment received"\n            : "Payment received",\n        message: notificationMessage,\n        channel: "email",\n        status: "pending",\n      },\n    });\n`,
    `    const confirmation = await prisma.notification.create({\n      data: {\n        studentId: student.id,\n        title:\n          paymentType === "registration"\n            ? "Registration fee received"\n            : paymentType === "deposit"\n            ? "Part-payment received"\n            : "Payment received",\n        message: notificationMessage,\n        channel: "email",\n        status: "pending",\n      },\n    });\n`
  );

  patch(
    'src/app/api/paystack/webhook/route.ts',
    `    const student = await prisma.student.findUnique({\n      where: { id: studentId },\n      include: { user: true },\n    });\n`,
    `    const student = await prisma.student.findUnique({\n      where: { id: student.id },\n      include: { user: true },\n    });\n`
  );

  console.log('Done');
} catch (err) {
  console.error(err);
  process.exit(1);
}
