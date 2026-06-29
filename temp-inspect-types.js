const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  try {
    const examTypes = await prisma.endoscopyExamType.findMany({ orderBy: { name: 'asc' } });
    const prescriptions = await prisma.prescription.groupBy({ by: ['typeExamen'], orderBy: { typeExamen: 'asc' } });
    console.log('EXAM TYPES:\n' + JSON.stringify(examTypes, null, 2));
    console.log('\nPRESCRIPTION TYPES:\n' + JSON.stringify(prescriptions, null, 2));
  } catch (e) {
    console.error('ERROR', e);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
})();
