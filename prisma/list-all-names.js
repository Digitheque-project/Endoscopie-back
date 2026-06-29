const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  console.log('📊 Database Patient and Doctor Summary\n');

  try {
    // Get all patients
    const patients = await prisma.patient.findMany({
      take: 100
    });

    console.log(`Total Patients: ${patients.length}\n`);
    console.log('Patients:');
    patients.forEach((p, i) => {
      console.log(`  ${i + 1}. ${p.prenom} ${p.nom}`);
    });

    // Get all doctors
    const doctors = await prisma.medecin.findMany({
      take: 100
    });

    console.log(`\nTotal Doctors: ${doctors.length}\n`);
    console.log('Doctors:');
    doctors.forEach((d, i) => {
      console.log(`  ${i + 1}. ${d.prenom} ${d.nom} (${d.specialite || 'N/A'})`);
    });

    // Count unique patient names
    const uniquePatientNames = new Set(patients.map(p => `${p.prenom} ${p.nom}`));
    console.log(`\nUnique patient names: ${uniquePatientNames.size}`);

    // Count unique doctor names
    const uniqueDoctorNames = new Set(doctors.map(d => `${d.prenom} ${d.nom}`));
    console.log(`Unique doctor names: ${uniqueDoctorNames.size}`);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
