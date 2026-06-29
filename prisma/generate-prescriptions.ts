import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();
const ENDOSCOPIE_SERVICE_ID =
  process.env.ENDOSCOPIE_SERVICE_ID || '38f39d38-152e-495b-8c48-28937750d9eb';

const typesExamen = [
  'Fibroscopie digestive haute',
  'Injection de colle biologique',
  'Dilatation oesophagienne',
  'Extraction de corps étranger',
  'Coloscopie',
  'Rectosigmoidoscopie',
];
const priorites = ['Standard', 'Urgent', 'STAT'];
const motifs = [
  'Dépistage cancer colorectal',
  'Surveillance polypose',
  'Symptômes digestifs hauts',
  'Symptômes digestifs bas',
  'Douleurs abdominales',
  'Saignement digestif',
  'Anémie d’origine indéterminée',
  'Suivi après traitement',
  'Suspicion de lésion gastrique',
  'Evaluation d’une sténose biliaire',
];

function randomItem<T>(array: T[]): T {
  return array[Math.floor(Math.random() * array.length)];
}

function randomPastDate(maxDaysAgo = 45): Date {
  const offset = Math.floor(Math.random() * maxDaysAgo);
  return new Date(Date.now() - offset * 24 * 60 * 60 * 1000);
}

async function main() {
  const patients = await prisma.patient.findMany();
  const medecins = await prisma.medecin.findMany();

  if (!patients.length) {
    throw new Error('Aucun patient trouvé dans la base de données.');
  }
  if (!medecins.length) {
    throw new Error('Aucun médecin trouvé dans la base de données.');
  }

  const existingCount = await prisma.prescription.count({
    where: { serviceId: ENDOSCOPIE_SERVICE_ID },
  });

  console.log(`Service ID: ${ENDOSCOPIE_SERVICE_ID}`);
  console.log(`Patients disponibles: ${patients.length}`);
  console.log(`Médecins disponibles: ${medecins.length}`);
  console.log(`Prescriptions existantes pour ce service: ${existingCount}`);
  console.log('Création de 20 nouvelles prescriptions...');

  for (let i = 0; i < 20; i++) {
    const patient = randomItem(patients);
    const medecin = randomItem(medecins);

    const prescription = await prisma.prescription.create({
      data: {
        serviceId: ENDOSCOPIE_SERVICE_ID,
        patientId: patient.id,
        medecinId: medecin.id,
        typeExamen: randomItem(typesExamen),
        motif: randomItem(motifs),
        priorite: randomItem(priorites),
        statut: 'A planifier',
        dateDemande: randomPastDate(60),
      },
    });

    console.log(
      `  ${i + 1}/20 -> ${patient.prenom} ${patient.nom} | Dr ${medecin.prenom} ${medecin.nom} | ${prescription.typeExamen}`,
    );
  }

  const finalCount = await prisma.prescription.count({
    where: { serviceId: ENDOSCOPIE_SERVICE_ID },
  });

  console.log(`\n✅ 20 prescriptions ajoutées.`);
  console.log(`Prescriptions totales pour ce service: ${finalCount}`);
}

main()
  .catch((error) => {
    console.error('Erreur lors de la génération des prescriptions:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
