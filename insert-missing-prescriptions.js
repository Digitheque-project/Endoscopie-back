require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const missingTypes = [
  'Ligature de varices oesophagiennes',
  'Injection de colle biologique',
  'Dilatation oesophagienne',
  'Extraction de corps étranger',
];
(async () => {
  try {
    const serviceId = process.env.ENDOSCOPIE_SERVICE_ID || '38f39d38-152e-495b-8c48-28937750d9eb';
    const patient = await prisma.patient.findFirst();
    const medecin = await prisma.medecin.findFirst();
    if (!patient || !medecin) {
      throw new Error('Patients or medecins not found in database.');
    }
    console.log('Using patient', patient.id, patient.nom, patient.prenom);
    console.log('Using medecin', medecin.id, medecin.nom, medecin.prenom);

    for (const typeExamen of missingTypes) {
      const existing = await prisma.prescription.count({ where: { typeExamen } });
      if (existing > 0) {
        console.log(`Skipped existing type: ${typeExamen} (${existing} prescription(s))`);
        continue;
      }
      const examType = await prisma.endoscopyExamType.findUnique({ where: { name: typeExamen } });
      const prescription = await prisma.prescription.create({
        data: {
          serviceId,
          patientId: patient.id,
          medecinId: medecin.id,
          typeExamen,
          typeExamenRefId: examType ? examType.id : null,
          motif: 'Prescription ajoutée pour test',
          priorite: 'Standard',
          statut: 'A planifier',
          dateDemande: new Date(),
        }
      });
      console.log(`Created prescription ${prescription.id} for ${typeExamen}`);
    }

    const counts = await prisma.prescription.groupBy({ by: ['typeExamen'], orderBy: { typeExamen: 'asc' } });
    console.log('Prescription type counts after insertion:');
    console.log(JSON.stringify(counts, null, 2));
  } catch (error) {
    console.error('ERROR', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
})();
