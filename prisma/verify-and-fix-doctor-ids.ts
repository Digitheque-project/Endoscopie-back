import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function verifyAndFixDoctorIds() {
  try {
    console.log('🔍 Starting doctor ID verification and fix...\n');

    // Get all prescriptions and doctors
    const prescriptions = await prisma.prescription.findMany();
    const doctors = await prisma.medecin.findMany();
    
    const doctorIds = new Set(doctors.map(d => d.id));
    const doctorNames = doctors.map(d => `${d.prenom} ${d.nom}`);

    console.log(`📊 Database Status:`);
    console.log(`   - Total doctors: ${doctors.length}`);
    console.log(`   - Total prescriptions: ${prescriptions.length}\n`);

    // Find prescriptions with invalid medecinId
    const invalidPrescriptions = prescriptions.filter(p => !doctorIds.has(p.medecinId));

    if (invalidPrescriptions.length === 0) {
      console.log('✅ All prescriptions have valid doctor IDs!');
      console.log('   All medecinId values exist in the Medecin table.\n');
      return;
    }

    console.log(`⚠️  Found ${invalidPrescriptions.length} prescriptions with invalid doctor IDs:\n`);
    invalidPrescriptions.forEach((p, i) => {
      console.log(`   ${i + 1}. Prescription ${p.id}`);
      console.log(`      - Invalid medecinId: ${p.medecinId}`);
      console.log(`      - Patient: ${p.patientId}`);
    });

    // Get the first valid doctor to assign as default
    const defaultDoctor = doctors[0];
    if (!defaultDoctor) {
      console.log('\n❌ Error: No valid doctors found in database!');
      return;
    }

    console.log(`\n🔧 Fixing invalid prescriptions...`);
    console.log(`   Assigning to default doctor: ${defaultDoctor.prenom} ${defaultDoctor.nom}`);

    // Update all invalid prescriptions to use the first valid doctor
    const updateResult = await prisma.prescription.updateMany({
      where: {
        id: { in: invalidPrescriptions.map(p => p.id) }
      },
      data: {
        medecinId: defaultDoctor.id
      }
    });

    console.log(`\n✅ Successfully updated ${updateResult.count} prescriptions!\n`);

    // Verify the fix
    console.log('🔍 Verifying fix...\n');
    const updatedPrescriptions = await prescriptions.length > 0 ? await prisma.prescription.findMany() : [];
    const stillInvalid = updatedPrescriptions.filter(p => !doctorIds.has(p.medecinId));

    if (stillInvalid.length === 0) {
      console.log('✅ Verification complete: All prescriptions now have valid doctor IDs!');
      console.log('   Data integrity check: PASSED ✓\n');
    } else {
      console.log(`❌ Verification failed: Still found ${stillInvalid.length} invalid prescriptions`);
    }

  } catch (error) {
    console.error('❌ Error during verification:', error);
  } finally {
    await prisma.$disconnect();
  }
}

verifyAndFixDoctorIds();
