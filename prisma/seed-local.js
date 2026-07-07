require('dotenv/config');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const SERVICE_ID = process.env.ENDOSCOPIE_SERVICE_ID || '38f39d38-152e-495b-8c48-28937750d9eb';
const CHU_ID = process.env.ENDOSCOPIE_CHU_ID || '72d49761-2a65-446d-b025-15a74cac1ad4';
const PRESCRIPTION_EXT_API_URL = (process.env.PRESCRIPTION_EXT_API_URL || 'https://prescriptionback-production.up.railway.app/prescriptions').replace(/\/$/, '');

const MEDECINS = [
  { nom: 'Rakotomalala', prenom: 'Jean-Pierre', specialite: 'Gastroentérologie', role: 'MEDECIN' },
  { nom: 'Rasoamanarivo', prenom: 'Marie', specialite: 'Gastroentérologie', role: 'MEDECIN' },
  { nom: 'Randrianarisoa', prenom: 'Paul', specialite: 'Chirurgie digestive', role: 'MEDECIN' },
  { nom: 'Ratsimba', prenom: 'Hélène', specialite: 'Anesthésie-Réanimation', role: 'MEDECIN' },
  { nom: 'Rakoto', prenom: 'Thomas', specialite: 'Gastroentérologie', role: 'MEDECIN' },
  { nom: 'Andrianasolo', prenom: 'Claire', specialite: 'Gastroentérologie', role: 'MEDECIN' },
];

const SALLES = [
  { nom: 'Salle Endoscopie 1', numero: '101', capacite: 1, equipement: 'Coloscope Olympus' },
  { nom: 'Salle Endoscopie 2', numero: '102', capacite: 1, equipement: 'Gastroscope Pentax' },
  { nom: 'Salle Réveil', numero: '103', capacite: 4, equipement: 'Moniteurs multi-paramètres' },
];

const EXAM_TYPES = [
  { name: 'Coloscopie', code: 'COLO' },
  { name: 'Fibroscopie digestive haute', code: 'GASTRO' },
  { name: 'Rectosigmoïdoscopie', code: 'RECTO' },
  { name: 'Entéroscopie', code: 'ENTERO' },
  { name: 'Cholangiopancréatographie rétrograde', code: 'CPRE' },
];

const ACCUEIL_API_URL = process.env.ACCUEIL_API_URL || 'https://acceuil-back-production.up.railway.app';

async function fetchRealPatients() {
  const url = `${ACCUEIL_API_URL}/accueil/patients?chuId=${CHU_ID}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Accueil API ${res.status}`);
  return res.json();
}

const MOTIFS = [
  'Dépistage cancer colorectal',
  'Surveillance polypose',
  'Symptômes digestifs hauts',
  'Douleurs abdominales chroniques',
  'Saignement digestif',
  "Anémie d'origine indéterminée",
  'Contrôle post-opératoire',
  'Antécédents familiaux de cancer',
];

const PRIORITES = ['Standard', 'Urgent', 'STAT'];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function daysAgo(n) {
  return new Date(Date.now() - n * 86400000);
}

function daysFromNow(n, hour = 9) {
  const d = new Date(Date.now() + n * 86400000);
  d.setHours(hour, 0, 0, 0);
  return d;
}

async function main() {
  console.log('📥 Récupération des vrais patients depuis Accueil...');
  const PATIENTS = await fetchRealPatients();
  if (!PATIENTS.length) throw new Error('Aucun patient récupéré depuis Accueil');
  console.log(`  ✓ ${PATIENTS.length} patients réels`);

  console.log('🧹 Nettoyage des données locales existantes...');

  await prisma.resultatEndoscopie.deleteMany({});
  await prisma.checklistApres.deleteMany({});
  await prisma.checklistAvant.deleteMany({});
  await prisma.operationEndoscopie.deleteMany({});
  await prisma.dossierCPA.deleteMany({});
  await prisma.rendezVous.deleteMany({});
  await prisma.prescription.deleteMany({});
  await prisma.endoscopyExamType.deleteMany({});
  await prisma.salle.deleteMany({});
  await prisma.medecin.deleteMany({});

  console.log('🩺 Création des médecins...');
  const medecins = await Promise.all(
    MEDECINS.map(m => prisma.medecin.create({ data: m }))
  );
  console.log(`  ✓ ${medecins.length} médecins créés`);

  console.log('🏥 Création des salles...');
  const salles = await Promise.all(
    SALLES.map(s => prisma.salle.create({ data: { ...s, serviceId: SERVICE_ID } }))
  );
  console.log(`  ✓ ${salles.length} salles créées`);

  console.log('📋 Création des types d\'examen...');
  const examTypes = await Promise.all(
    EXAM_TYPES.map(e => prisma.endoscopyExamType.create({ data: e }))
  );
  console.log(`  ✓ ${examTypes.length} types d'examen créés`);

  console.log('📋 Récupération des prescriptions réelles depuis l\'API externe...');

  function mapUrgenceToPriorite(urgence) {
    if (urgence === 'STAT') return 'STAT';
    if (urgence === 'URGENTE') return 'Urgent';
    return 'Standard';
  }

  let externalPrescriptions = [];
  try {
    const extRes = await fetch(
      `${PRESCRIPTION_EXT_API_URL}/endoscopie?serviceIdDest=${SERVICE_ID}&chuId=${CHU_ID}`
    );
    if (extRes.ok) externalPrescriptions = await extRes.json();
  } catch (e) {
    console.warn('  ⚠️  API externe inaccessible:', e.message);
  }
  console.log(`  ✓ ${externalPrescriptions.length} prescriptions réelles trouvées dans l'API externe`);

  if (!externalPrescriptions.length) {
    console.log('  ℹ️  Aucune prescription externe — workflow demo ignoré.');
    console.log('\n✅ Seed terminé (médecins, salles, types d\'examen uniquement) !');
    console.log(`   🩺 ${medecins.length} médecins`);
    console.log(`   🏥 ${salles.length} salles`);
    return;
  }

  // Crée les miroirs locaux pour les prescriptions externes
  // (nécessaire pour rattacher le workflow demo : RDV, checklist, opérations)
  const prescriptions = [];
  const statuts = ['A planifier', 'A planifier', 'Planifié', 'Décision rendue', 'Confirmé'];
  for (let i = 0; i < externalPrescriptions.length; i++) {
    const ext = externalPrescriptions[i];
    if (!ext.prescripteurId || !ext.patientId) continue;

    await prisma.medecin.upsert({
      where: { id: ext.prescripteurId },
      update: {},
      create: { id: ext.prescripteurId, nom: 'PRESCRIPTEUR', prenom: 'EXTERN', specialite: null, role: null },
    });

    const patient = PATIENTS.find(p => p.id === ext.patientId) || { id: ext.patientId, nom: '?', prenom: '' };
    const statut = statuts[i % statuts.length];

    const prescription = await prisma.prescription.create({
      data: {
        serviceId: SERVICE_ID,
        externalId: ext.id,
        patientId: ext.patientId,
        medecinId: ext.prescripteurId,
        typeExamen: ext.typeExamen || 'Endoscopie',
        motif: ext.renseignements || '',
        priorite: mapUrgenceToPriorite(ext.urgence),
        statut,
        dateDemande: ext.createdAt ? new Date(ext.createdAt) : new Date(),
      },
    });
    prescriptions.push({ ...prescription, patient, medecinId: ext.prescripteurId });
    console.log(`  ✓ ${patient.prenom} ${patient.nom} — ${ext.typeExamen} [${statut}] (ext:${ext.id.slice(0,8)})`);
  }

  console.log('📅 Création des rendez-vous demo (programme du jour)...');
  let rdvCount = 0;
  const rdvSlots = [
    { heure: 8,  typeAnesthesie: 'Locale',   statut: 'Planifié' },
    { heure: 9,  typeAnesthesie: 'Générale',  statut: 'Planifié' },
    { heure: 10, typeAnesthesie: 'Locale',    statut: 'Confirmé' },
    { heure: 11, typeAnesthesie: 'Locale',    statut: 'Planifié' },
    { heure: 14, typeAnesthesie: 'Générale',  statut: 'Planifié' },
  ];

  const rdvToday = prescriptions.slice(0, rdvSlots.length);
  for (let i = 0; i < rdvToday.length; i++) {
    const p = rdvToday[i];
    const { heure, typeAnesthesie, statut } = rdvSlots[i];
    const debut = daysFromNow(0, heure);
    await prisma.rendezVous.create({
      data: {
        serviceId: SERVICE_ID,
        patientId: p.patient.id,
        prescriptionId: p.id,
        medecinId: p.medecinId,
        salleId: salles[rdvCount % salles.length].id,
        dateHeureDebut: debut,
        dateHeureFin: new Date(debut.getTime() + 30 * 60000),
        typeAnesthesie,
        statut,
      },
    });
    await prisma.prescription.update({ where: { id: p.id }, data: { statut } });
    rdvCount++;
  }

  const rdvFutures = prescriptions.slice(rdvSlots.length).filter(p => p.statut !== 'A planifier');
  for (let i = 0; i < rdvFutures.length; i++) {
    const p = rdvFutures[i];
    const debut = daysFromNow(i + 1, 8 + (i % 4));
    await prisma.rendezVous.create({
      data: {
        serviceId: SERVICE_ID,
        patientId: p.patient.id,
        prescriptionId: p.id,
        medecinId: p.medecinId,
        salleId: salles[i % salles.length].id,
        dateHeureDebut: debut,
        dateHeureFin: new Date(debut.getTime() + 30 * 60000),
        typeAnesthesie: i % 2 === 0 ? 'Générale' : 'Locale',
        statut: 'Planifié',
      },
    });
    rdvCount++;
  }
  console.log(`  ✓ ${rdvCount} rendez-vous créés`);

  console.log('⚡ Création d\'opérations interrompues (demo panne électrique)...');
  for (const p of prescriptions.slice(0, Math.min(2, prescriptions.length))) {
    await prisma.operationEndoscopie.create({
      data: {
        serviceId: SERVICE_ID,
        prescriptionId: p.id,
        patientId: p.patient.id,
        medicalNotes: 'Examen interrompu — panne électrique en cours de procédure. Compte-rendu à compléter.',
        observationNotes: 'Interruption imprévue',
      },
    }).catch(() => null);
    console.log(`  ⚡ ${p.patient.prenom} ${p.patient.nom} — opération interrompue`);
  }

  console.log('\n✅ Seed terminé !');
  console.log(`   🩺 ${medecins.length} médecins`);
  console.log(`   🏥 ${salles.length} salles`);
  console.log(`   📋 ${prescriptions.length} prescriptions (depuis API externe)`);
  console.log(`   📅 ${rdvCount} rendez-vous`);
}

main()
  .catch(e => { console.error('❌ Erreur:', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
