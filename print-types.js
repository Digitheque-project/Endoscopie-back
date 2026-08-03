require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  try {
    const prescriptions = await prisma.prescription.findMany({
      select: { typeExamen: true },
      distinct: ['typeExamen'],
      orderBy: { typeExamen: 'asc' },
    });
    const examTypes = await prisma.endoscopyExamType.findMany({
      select: { id: true, name: true, code: true, description: true },
      orderBy: { name: 'asc' },
    });
    console.log('PRESCRIPTIONS');
    console.log(JSON.stringify(prescriptions, null, 2));
    console.log('EXAM TYPES');
    console.log(JSON.stringify(examTypes, null, 2));
  } catch (e) {
    console.error(e);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
})();
