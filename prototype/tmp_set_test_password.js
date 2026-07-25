const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

async function main() {
  const prisma = new PrismaClient();
  try {
    const email = 'student@easyway.test';
    const user = await prisma.user.findUnique({ where: { email } });
    console.log(user ? { id: user.id, email: user.email, role: user.role } : 'no user');
    if (!user) {
      return;
    }
    const hashed = await bcrypt.hash('TestPass123!', 10);
    await prisma.user.update({ where: { id: user.id }, data: { password: hashed } });
    console.log('updated password for', user.email);
  } catch (error) {
    console.error(error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
