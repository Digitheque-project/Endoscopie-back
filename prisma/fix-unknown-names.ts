import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const PATIENT_FIRST_NAMES = [
  'Marie', 'Jean', 'Pierre', 'Sophie', 'Luc', 'Isabelle', 'Paul', 'Anne',
  'Marc', 'Nathalie', 'Patrick', 'Christine', 'Philippe', 'Martine', 'Christophe',
  'Monique', 'Jacques', 'Jacqueline', 'Gérard', 'Nicole', 'Michel', 'Sylviane',
  'François', 'Lucienne', 'Bernard', 'Danielle', 'Guy', 'Françoise', 'Denis',
  'Josette', 'Claude', 'Simone', 'Roger', 'Micheline', 'Robert', 'Éliane'
];

const PATIENT_LAST_NAMES = [
  'Dupont', 'Martin', 'Bernard', 'Thomas', 'Robert', 'Richard', 'Petit', 'Durand',
  'Lefevre', 'Michel', 'Garcia', 'David', 'Bertrand', 'Roux', 'Vincent', 'Fournier',
  'Morel', 'Girard', 'André', 'Lefevre', 'Cornet', 'Blanchard', 'Basler', 'Blanc',
  'Bonnet', 'Bonnin', 'Bouhier', 'Bourdon', 'Bourgeois', 'Bourget', 'Bousquet',
  'Boutilier', 'Boyer', 'Bozio', 'Braconi', 'Brasseur', 'Brault', 'Brée', 'Breggion'
];

const MEDECIN_FIRST_NAMES = [
  'Antoine', 'Laurent', 'Christian', 'Gérard', 'Alain', 'Serge', 'Olivier', 'Thierry',
  'Bruno', 'Stéphane', 'Éric', 'Frédéric', 'Yves', 'Xavier', 'Cédric', 'Didier'
];

const MEDECIN_LAST_NAMES = [
  'Leclerc', 'Morel', 'Girard', 'Renault', 'Fontaine', 'Benoit', 'Lacroix', 'Laurent',
  'Legrand', 'Leroy', 'Linde', 'Lindet', 'Lintot', 'Lirac', 'Lirot', 'Lisbet',
  'Lisle', 'Lison', 'Lith', 'Litoux', 'Littel', 'Littin', 'Livaure', 'Livemont'
];

function getRandomName(firstNames: string[], lastNames: string[]): { prenom: string; nom: string } {
  const prenom = firstNames[Math.floor(Math.random() * firstNames.length)];
  const nom = lastNames[Math.floor(Math.random() * lastNames.length)];
  return { prenom, nom };
}

async function main() {
  console.log('🔄 Fixing unknown patients and doctors...\n');

  try {
    // Fix Patients with unknown names
    const unknownPatients = await prisma.patient.findMany({
      where: {
        OR: [
          { prenom: { in: ['Inconnu', 'Unknown', 'patient', 'Patient'] } },
          { nom: { in: ['Inconnu', 'Unknown', 'Inconnu'] } }
        ]
      }
    });

    console.log(`Found ${unknownPatients.length} patients with unknown names`);

    for (let i = 0; i < unknownPatients.length; i++) {
      const patient = unknownPatients[i];
      const newName = getRandomName(PATIENT_FIRST_NAMES, PATIENT_LAST_NAMES);
      
      await prisma.patient.update({
        where: { id: patient.id },
        data: {
          prenom: newName.prenom,
          nom: newName.nom
        }
      });
      
      console.log(`✓ Updated patient: ${patient.prenom} ${patient.nom} → ${newName.prenom} ${newName.nom}`);
    }

    // Fix Doctors with unknown names
    const unknownDoctors = await prisma.medecin.findMany({
      where: {
        OR: [
          { prenom: { in: ['Inconnu', 'Unknown', 'Dr', 'Docteur'] } },
          { nom: { in: ['Inconnu', 'Unknown', 'Leclerc'] } }
        ]
      }
    });

    console.log(`\nFound ${unknownDoctors.length} doctors with unknown names`);

    for (let i = 0; i < unknownDoctors.length; i++) {
      const doctor = unknownDoctors[i];
      const newName = getRandomName(MEDECIN_FIRST_NAMES, MEDECIN_LAST_NAMES);
      
      await prisma.medecin.update({
        where: { id: doctor.id },
        data: {
          prenom: newName.prenom,
          nom: newName.nom
        }
      });
      
      console.log(`✓ Updated doctor: ${doctor.prenom} ${doctor.nom} → ${newName.prenom} ${newName.nom}`);
    }

    console.log('\n✅ All unknown names have been fixed!');

  } catch (error) {
    console.error('❌ Error during fix:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main();
