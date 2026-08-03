const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function fixData() {
  const prescriptions = await prisma.prescription.findMany();
  const medecins = await prisma.medecin.findMany();

  if (medecins.length === 0) {
    console.log('Aucun médecin trouvé.');
    return;
  }

  for (const p of prescriptions) {
    const randomMedecin = medecins[Math.floor(Math.random() * medecins.length)];
    await prisma.prescription.update({
      where: { id: p.id },
      data: { medecinId: randomMedecin.id }
    });
  }

  console.log(`${prescriptions.length} prescriptions mises à jour avec des médecins aléatoires.`);
}

fixData()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
