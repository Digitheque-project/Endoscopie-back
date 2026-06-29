require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  try {
    const counts = await prisma.prescription.groupBy({
      by: ['typeExamen'],
      orderBy: { typeExamen: 'asc' },
    });
    console.log('PRESCRIPTION TYPE COUNTS:');
    console.log(JSON.stringify(counts, null, 2));

    const examTypes = await prisma.endoscopyExamType.findMany({
      orderBy: { name: 'asc' },
    });
    console.log('ENDOSCOPY EXAM TYPES:');
    console.log(JSON.stringify(examTypes, null, 2));

    const missing = ['Ligature de varices oesophagiennes', 'Injection de colle biologique', 'Dilatation oesophagienne', 'Extraction de corps étranger'];
    for (const name of missing) {
      const cnt = await prisma.prescription.count({ where: { typeExamen: name } });
      console.log(`COUNT for ${name}: ${cnt}`);
    }
  } catch (error) {
    console.error('ERROR', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
})();
