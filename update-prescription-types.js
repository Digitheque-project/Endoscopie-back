require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
function slugify(name) {
  return name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}
(async () => {
  try {
    const examNames = [
      'Coloscopie',
      'Réctosigmoïdoscopie',
      'Fibroscopie digestive haute',
      'Ligature de varices oesophagiennes',
      'Injection de colle biologique',
      'Dilatation oesophagienne',
      'Extraction de corps étranger'
    ];

    const exams = [];
    for (const name of examNames) {
      const exam = await prisma.endoscopyExamType.upsert({
        where: { name },
        update: {},
        create: {
          name,
          code: slugify(name),
          description: name,
        },
      });
      exams.push(exam);
    }

    const updates = [
      { from: 'Gastroscopie', to: 'Fibroscopie digestive haute' },
      { from: 'Sigmoidoscopie', to: 'Réctosigmoïdoscopie' },
    ];
    for (const { from, to } of updates) {
      const result = await prisma.prescription.updateMany({
        where: { typeExamen: from },
        data: { typeExamen: to },
      });
      console.log(`Updated ${result.count} prescription(s) from '${from}' to '${to}'.`);
    }

    for (const name of ['Coloscopie', 'Fibroscopie digestive haute', 'Réctosigmoïdoscopie']) {
      const exam = exams.find((e) => e.name === name);
      if (!exam) continue;
      const result = await prisma.prescription.updateMany({
        where: { typeExamen: name },
        data: { typeExamenRefId: exam.id },
      });
      console.log(`Linked ${result.count} '${name}' prescription(s) to typeExamenRefId.`);
    }

    const allTypes = await prisma.prescription.groupBy({ by: ['typeExamen'], orderBy: { typeExamen: 'asc' } });
    console.log('Distinct typeExamen values after update:');
    console.log(JSON.stringify(allTypes, null, 2));
  } catch (error) {
    console.error('ERROR', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
})();
