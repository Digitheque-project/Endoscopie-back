const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const counts = {
    Patient: await prisma.patient.count(),
    Medecin: await prisma.medecin.count(),
    Salle: await prisma.salle.count(),
    Prescription: await prisma.prescription.count(),
    RendezVous: await prisma.rendezVous.count(),
    DossierCPA: await prisma.dossierCPA.count(),
    ChecklistAvant: await prisma.checklistAvant.count(),
  };
  console.log(JSON.stringify(counts, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
