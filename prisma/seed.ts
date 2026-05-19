import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding data...');

  // Créer quelques médecins
  const medecin1 = await prisma.medecin.create({
    data: { nom: 'Moreau', prenom: 'Antoine', specialite: 'Gastro-entérologie', role: 'Médecin' }
  });
  const medecin2 = await prisma.medecin.create({
    data: { nom: 'Lefebvre', prenom: 'Marie', specialite: 'Anesthésie', role: 'Médecin' }
  });

  // Ajouter 8 médecins supplémentaires pour atteindre 10 médecins
  await prisma.medecin.createMany({
    data: [
      { nom: 'Durand', prenom: 'Pierre', specialite: 'Gastro-entérologie', role: 'Médecin' },
      { nom: 'Bernard', prenom: 'Luc', specialite: 'Endoscopie', role: 'Médecin' },
      { nom: 'Dubois', prenom: 'Sophie', specialite: 'Hépato-gastro', role: 'Médecin' },
      { nom: 'Martin', prenom: 'Claire', specialite: 'Anesthésie', role: 'Médecin' },
      { nom: 'Petit', prenom: 'Julien', specialite: 'Chirurgie digestive', role: 'Médecin' },
      { nom: 'Leroy', prenom: 'Isabelle', specialite: 'Gastro-entérologie', role: 'Médecin' },
      { nom: 'Morel', prenom: 'Nicolas', specialite: 'Endoscopie', role: 'Médecin' },
      { nom: 'Robert', prenom: 'Camille', specialite: 'Gastro-entérologie', role: 'Médecin' },
    ],
  });

  // Créer quelques patients
  const patients: any[] = [];
  for (let i = 1; i <= 5; i++) {
    patients.push(
      await prisma.patient.create({
        data: {
          nom: `PatientNom${i}`,
          prenom: `PatientPrenom${i}`,
          dateNaissance: new Date(1980 + i, 5, 15),
          sexe: i % 2 === 0 ? 'F' : 'M',
        }
      })
    );
  }

  // Créer 20 prescriptions
  const typesExamen = ['Coloscopie', 'Gastroscopie', 'Echo-endoscopie', 'CPRE'];
  const priorites = ['Standard', 'Urgent', 'STAT'];
  const statuts = ['A planifier', 'Planifié', 'Terminé'];

  // Récupérer tous les médecins créés
  const allMedecins = await prisma.medecin.findMany();

  for (let i = 1; i <= 20; i++) {
    const randomPatient = patients[Math.floor(Math.random() * patients.length)];
    const randomMedecin = allMedecins[Math.floor(Math.random() * allMedecins.length)];
    const randomType = typesExamen[Math.floor(Math.random() * typesExamen.length)];
    const randomPriorite = priorites[Math.floor(Math.random() * priorites.length)];
    const randomStatut = statuts[Math.floor(Math.random() * statuts.length)];

    await prisma.prescription.create({
      data: {
        patientId: randomPatient.id,
        medecinId: randomMedecin.id,
        typeExamen: randomType,
        motif: `Motif généré automatique ${i}`,
        priorite: randomPriorite,
        statut: randomStatut,
      }
    });
  }

  console.log('10 médecins (au moins) et 20 prescriptions créées avec succès !');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
