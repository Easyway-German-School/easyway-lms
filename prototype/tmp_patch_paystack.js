const fs = require('fs');
const path = require('path');

function replaceFile(filePath, oldText, newText) {
  const fullPath = path.resolve(filePath);
  const content = fs.readFileSync(fullPath, 'utf8');
  if (!content.includes(oldText)) {
    throw new Error(`Old text not found in ${fullPath}`);
  }
  fs.writeFileSync(fullPath, content.replace(oldText, newText), 'utf8');
  console.log(`Patched ${fullPath}`);
}

try {
  replaceFile(
    'c:/Users/HP/Documents/EASYWAY LMS/prototype/src/app/api/paystack/initialize/route.ts',
    `    const resolvedPathwayId = resolvedPathway?.id ?? null;
    const secretKey = process.env.PAYSTACK_SECRET_KEY;
    const callbackUrlBase = process.env.PAYSTACK_CALLBACK_URL || \`${process.env.NEXTAUTH_URL || \"http://localhost:3000\"}/enrollment/success\`;
    const callbackUrl = \`${callbackUrlBase}${callbackUrlBase.includes(\"?\") ? \"&\" : \"?\"}source=paystack\`;

    const userEmail = String(session.user.email || \"\").trim().toLowerCase();
    const validEmailPattern = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;
    const paystackEmail = validEmailPattern.test(userEmail)
      ? userEmail
      : process.env.NODE_ENV === \"development\"
      ? \"student@example.com\"
      : null;
`,
    `    const resolvedPathwayId = resolvedPathway?.id ?? null;
    const secretKey = process.env.PAYSTACK_SECRET_KEY;
    const callbackUrlBase = process.env.PAYSTACK_CALLBACK_URL || \`${process.env.NEXTAUTH_URL || \"http://localhost:3000\"}/enrollment/success\`;
    const callbackUrl = \`${callbackUrlBase}${callbackUrlBase.includes(\"?\") ? \"&\" : \"?\"}source=paystack\`;

    const studentRecord = await prisma.student.findUnique({
      where: { userId: session.user.id as string },
    });
    const studentId = studentRecord?.id;

    const userEmail = String(session.user.email || \"\").trim().toLowerCase();
    const validEmailPattern = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;
    const paystackEmail = validEmailPattern.test(userEmail)
      ? userEmail
      : process.env.NODE_ENV === \"development\"
      ? \"student@example.com\"
      : null;
`
  );

  replaceFile(
    'c:/Users/HP/Documents/EASYWAY LMS/prototype/src/app/api/paystack/initialize/route.ts',
    `        callback_url: callbackUrl,
        metadata: {
          userId: session.user.id,
          pathwayId: resolvedPathwayId || pathwayId || \"\",
          pathwayName: pathwayName || \"\",
          totalAmount: String(normalizedAmount),
          depositAmount: String(amountToCharge),
          tuitionFee: String(normalizedTuitionFee),
          requiredThreshold: String(requiredThreshold),
          depositPercent: String(normalizedDepositPercent),
          paymentType,
          paymentStage: paymentType,
        },
      }),
`,
    `        callback_url: callbackUrl,
        metadata: {
          userId: session.user.id,
          studentId,
          pathwayId: resolvedPathwayId || pathwayId || \"\",
          pathwayName: pathwayName || \"\",
          totalAmount: String(normalizedAmount),
          depositAmount: String(amountToCharge),
          tuitionFee: String(normalizedTuitionFee),
          requiredThreshold: String(requiredThreshold),
          depositPercent: String(normalizedDepositPercent),
          paymentType,
          paymentStage: paymentType,
        },
      }),
`
  );

  console.log('Patch complete');
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
