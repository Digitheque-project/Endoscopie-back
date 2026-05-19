import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Remplissage de la base de données avec des données réalistes...\n');

  // ✅ CRÉER LES MÉDECINS AVEC VRAIS NOMS FRANÇAIS
  console.log('👨‍⚕️ Création des médecins...');
  const medecinsData = [
    { nom: 'Moreau', prenom: 'Antoine', specialite: 'Gastro-entérologie', role: 'Médecin' },
    { nom: 'Lefebvre', prenom: 'Marie', specialite: 'Anesthésie', role: 'Médecin' },
    { nom: 'Durand', prenom: 'Pierre', specialite: 'Gastro-entérologie', role: 'Médecin' },
    { nom: 'Bernard', prenom: 'Luc', specialite: 'Endoscopie', role: 'Médecin' },
    { nom: 'Dubois', prenom: 'Sophie', specialite: 'Hépato-gastro', role: 'Médecin' },
    { nom: 'Martin', prenom: 'Claire', specialite: 'Anesthésie', role: 'Médecin' },
    { nom: 'Petit', prenom: 'Julien', specialite: 'Chirurgie digestive', role: 'Médecin' },
    { nom: 'Leroy', prenom: 'Isabelle', specialite: 'Gastro-entérologie', role: 'Médecin' },
    { nom: 'Morel', prenom: 'Nicolas', specialite: 'Endoscopie', role: 'Médecin' },
    { nom: 'Robert', prenom: 'Camille', specialite: 'Gastro-entérologie', role: 'Médecin' },
  ];

  const medecins: any[] = [];
  for (const med of medecinsData) {
    const medecin = await prisma.medecin.create({ data: med });
    medecins.push(medecin);
    console.log(`  ✓ Dr. ${med.prenom} ${med.nom} (${med.specialite})`);
  }

  // ✅ CRÉER LES PATIENTS AVEC VRAIS NOMS FRANÇAIS
  console.log('\n👥 Création des patients...');
  const patientsData = [
    {
      nom: 'Marchand',
      prenom: 'Jean-Pierre',
      dateNaissance: new Date(1955, 3, 12),
      sexe: 'M',
      groupeSanguin: 'O+',
      poids: 78.5,
      antecedentsMedicaux: 'Hypertension, Diabète type II'
    },
    {
      nom: 'Rousseau',
      prenom: 'Françoise',
      dateNaissance: new Date(1962, 7, 28),
      sexe: 'F',
      groupeSanguin: 'A+',
      poids: 65.0,
      antecedentsMedicaux: 'Cholestérol élevé, Reflux gastrique'
    },
    {
      nom: 'Delaunay',
      prenom: 'Marc',
      dateNaissance: new Date(1948, 11, 5),
      sexe: 'M',
      groupeSanguin: 'B+',
      poids: 82.3,
      antecedentsMedicaux: 'Antécédents familiaux de cancer colorectal'
    },
    {
      nom: 'Fontaine',
      prenom: 'Christine',
      dateNaissance: new Date(1970, 1, 19),
      sexe: 'F',
      groupeSanguin: 'AB+',
      poids: 58.7,
      antecedentsMedicaux: 'Allergie aux AINS'
    },
    {
      nom: 'Garnier',
      prenom: 'Michel',
      dateNaissance: new Date(1960, 5, 14),
      sexe: 'M',
      groupeSanguin: 'O-',
      poids: 75.2,
      antecedentsMedicaux: 'Antécédents de gastrite'
    },
    {
      nom: 'Mercier',
      prenom: 'Véronique',
      dateNaissance: new Date(1965, 9, 3),
      sexe: 'F',
      groupeSanguin: 'A-',
      poids: 62.1,
      antecedentsMedicaux: 'Polypose familiale'
    },
    {
      nom: 'Leclerc',
      prenom: 'Régis',
      dateNaissance: new Date(1952, 2, 22),
      sexe: 'M',
      groupeSanguin: 'B-',
      poids: 80.9,
      antecedentsMedicaux: 'Ulcère duodénal antérieur'
    },
    {
      nom: 'Laurent',
      prenom: 'Jacqueline',
      dateNaissance: new Date(1958, 6, 11),
      sexe: 'F',
      groupeSanguin: 'AB-',
      poids: 61.3,
      antecedentsMedicaux: 'Maladie de Crohn'
    },
  ];

  const patients: any[] = [];
  for (const pat of patientsData) {
    const patient = await prisma.patient.create({ data: pat });
    patients.push(patient);
    console.log(`  ✓ ${pat.prenom} ${pat.nom} (${pat.sexe}, ${pat.groupeSanguin}, ${pat.poids}kg)`);
  }

  // ✅ CRÉER LES PRESCRIPTIONS
  console.log('\n📋 Création des prescriptions...');
  const typesExamen = ['Coloscopie', 'Gastroscopie', 'Echo-endoscopie', 'CPRE', 'Sigmoidoscopie'];
  const priorites = ['Standard', 'Urgent', 'STAT'];
  const motifs = [
    'Dépistage cancer colorectal',
    'Surveillance polypose',
    'Symptômes digestifs hauts',
    'Symptômes digestifs bas',
    'Douleurs abdominales',
    'Antécédents familiaux',
    'Diagnostic différentiel',
    'Suivi thérapeutique',
    'Saignement digestif',
    'Anémie d\'origine indéterminée'
  ];

  let prescriptionCount = 0;
  
  for (let i = 0; i < patients.length; i++) {
    const patient = patients[i];
    const numPrescriptions = 2 + Math.floor(Math.random() * 2); // 2-3 prescriptions par patient
    
    for (let j = 0; j < numPrescriptions; j++) {
      const randomMedecin = medecins[Math.floor(Math.random() * medecins.length)];
      const randomType = typesExamen[Math.floor(Math.random() * typesExamen.length)];
      const randomPriorite = priorites[Math.floor(Math.random() * priorites.length)];
      const randomMotif = motifs[Math.floor(Math.random() * motifs.length)];
      const dateDecalage = 5 + Math.floor(Math.random() * 60); // 5-65 jours

      const prescription = await prisma.prescription.create({
        data: {
          patientId: patient.id,
          medecinId: randomMedecin.id,
          typeExamen: randomType,
          motif: randomMotif,
          priorite: randomPriorite,
          statut: 'A planifier',
          dateDemande: new Date(Date.now() - dateDecalage * 24 * 60 * 60 * 1000),
        }
      });
      
      prescriptionCount++;
      console.log(`  ✓ Prescription #${prescriptionCount}: ${patient.prenom} ${patient.nom} - ${randomType} (${randomPriorite})`);
    }
  }

  console.log('\n✅ Données de test créées avec succès!');
  console.log(`   📊 ${medecins.length} médecins`);
  console.log(`   👥 ${patients.length} patients`);
  console.log(`   📋 ${prescriptionCount} prescriptions`);
}

main()
  .catch((e) => {
    console.error('❌ Erreur lors du seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
