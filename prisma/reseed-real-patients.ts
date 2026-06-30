import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import {
  getAccueilApiUrl,
  getEndoscopieChuId,
  getEndoscopieServiceId,
} from '../src/config/endoscopie-service';

const prisma = new PrismaClient();

interface AccueilPatient {
  id: string;
  nom: string;
  prenom?: string | null;
}

async function fetchRealPatients(): Promise<AccueilPatient[]> {
  const url = `${getAccueilApiUrl()}/accueil/patients?chuId=${getEndoscopieChuId()}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Échec de récupération des patients Accueil: ${res.status}`);
  }
  return res.json() as Promise<AccueilPatient[]>;
}

async function wipeDemoData() {
  await prisma.resultatEndoscopie.deleteMany({});
  await prisma.checklistApres.deleteMany({});
  await prisma.checklistAvant.deleteMany({});
  await prisma.operationEndoscopie.deleteMany({});
  await prisma.dossierCPA.deleteMany({});
  await prisma.rendezVous.deleteMany({});
  await prisma.prescription.deleteMany({});
}

const PRIORITES = ['Standard', 'Urgent', 'STAT'];
const MOTIFS = [
  'Dépistage cancer colorectal',
  'Surveillance polypose',
  'Symptômes digestifs hauts',
  'Symptômes digestifs bas',
  'Douleurs abdominales',
  'Antécédents familiaux',
  'Diagnostic différentiel',
  'Suivi thérapeutique',
  'Saignement digestif',
  "Anémie d'origine indéterminée",
];

async function main() {
  const serviceId = getEndoscopieServiceId();

  console.log('🧹 Suppression des anciennes données de démo (patients fictifs)...');
  await wipeDemoData();

  console.log('📥 Récupération des vrais patients depuis Accueil...');
  const patients = await fetchRealPatients();
  if (patients.length === 0) {
    throw new Error(
      'Aucun patient récupéré depuis Accueil — vérifier ACCUEIL_API_URL / ENDOSCOPIE_CHU_ID',
    );
  }
  console.log(`  ✓ ${patients.length} patients réels trouvés`);

  const medecins = await prisma.medecin.findMany();
  const salles = await prisma.salle.findMany({ where: { serviceId } });
  const examTypes = await prisma.endoscopyExamType.findMany();
  if (medecins.length === 0) {
    throw new Error('Aucun médecin en base — impossible de créer des prescriptions de démo');
  }

  console.log('📋 Création des prescriptions de démo avec les vrais patients...');
  const prescriptions: { id: string; patientId: string; medecinId: string }[] = [];
  for (let i = 0; i < patients.length; i++) {
    const patient = patients[i];
    const numPrescriptions = 1 + (i % 2); // alterne 1 ou 2 prescriptions par patient
    for (let j = 0; j < numPrescriptions; j++) {
      const medecin = medecins[Math.floor(Math.random() * medecins.length)];
      const examType = examTypes.length
        ? examTypes[Math.floor(Math.random() * examTypes.length)]
        : null;
      const dateDecalage = 5 + Math.floor(Math.random() * 60);

      const prescription = await prisma.prescription.create({
        data: {
          serviceId,
          patientId: patient.id,
          medecinId: medecin.id,
          typeExamen: examType?.name ?? 'Fibroscopie digestive haute',
          typeExamenRefId: examType?.id ?? null,
          motif: MOTIFS[Math.floor(Math.random() * MOTIFS.length)],
          priorite: PRIORITES[Math.floor(Math.random() * PRIORITES.length)],
          statut: 'A planifier',
          dateDemande: new Date(Date.now() - dateDecalage * 24 * 60 * 60 * 1000),
        },
      });
      prescriptions.push({
        id: prescription.id,
        patientId: patient.id,
        medecinId: medecin.id,
      });
      console.log(`  ✓ ${patient.prenom ?? ''} ${patient.nom} — ${prescription.typeExamen}`);
    }
  }

  console.log('📅 Création des rendez-vous de démo pour une partie des prescriptions...');
  let rdvCount = 0;
  for (let k = 0; k < prescriptions.length; k += 2) {
    const p = prescriptions[k];
    const salle = salles.length ? salles[k % salles.length] : null;
    const dateHeureDebut = new Date(Date.now() + (k + 1) * 24 * 60 * 60 * 1000);
    dateHeureDebut.setHours(9 + (k % 6), 0, 0, 0);

    await prisma.rendezVous.create({
      data: {
        serviceId,
        patientId: p.patientId,
        prescriptionId: p.id,
        medecinId: p.medecinId,
        salleId: salle?.id ?? null,
        dateHeureDebut,
        dateHeureFin: new Date(dateHeureDebut.getTime() + 30 * 60000),
        statut: 'Planifié',
      },
    });
    await prisma.prescription.update({
      where: { id: p.id },
      data: { statut: 'Planifié' },
    });
    rdvCount++;
  }
  console.log(`  ✓ ${rdvCount} rendez-vous créés`);

  if (prescriptions.length > 0) {
    const first = prescriptions[0];
    await prisma.dossierCPA.create({
      data: {
        serviceId,
        patientId: first.patientId,
        prescriptionId: first.id,
        typeAnesthesie: 'anesthesie_generale',
        observations: 'Sédation IV - Médecin anesthésiste requis.',
        statut: 'Brouillon',
      },
    });
    console.log('  ✓ 1 dossier CPA créé');
  }

  console.log('🩺 Checklists et opérations de démo...');
  for (let k = 0; k < Math.min(5, prescriptions.length); k++) {
    const p = prescriptions[k];
    await prisma.checklistAvant.create({
      data: {
        serviceId,
        prescriptionId: p.id,
        patientId: p.patientId,
        identiteVerifiee: true,
        procedureConfirmee: true,
        estValide: true,
      },
    });
  }
  for (let k = 0; k < Math.min(5, prescriptions.length); k++) {
    const p = prescriptions[k];
    await prisma.checklistApres.create({
      data: {
        serviceId,
        prescriptionId: p.id,
        patientId: p.patientId,
        estValide: true,
      },
    });
    await prisma.operationEndoscopie.create({
      data: {
        serviceId,
        prescriptionId: p.id,
        patientId: p.patientId,
        medicalNotes: 'Examen réalisé sans complication.',
      },
    });
  }

  console.log('\n✅ Reseed terminé avec des patients réels du registre Accueil.');
  console.log(`   👥 ${patients.length} patients réels`);
  console.log(`   📋 ${prescriptions.length} prescriptions`);
  console.log(`   📅 ${rdvCount} rendez-vous`);
}

main()
  .catch((e) => {
    console.error('❌ Erreur lors du reseed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
