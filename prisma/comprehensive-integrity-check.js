#!/usr/bin/env node

/**
 * COMPREHENSIVE DATA INTEGRITY VALIDATION
 * =======================================
 * 
 * This script performs a complete data integrity audit of the CHU Endoscopie database,
 * checking all foreign key relationships and reporting any inconsistencies.
 * 
 * Run periodically: node prisma/comprehensive-integrity-check.js
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

class DataIntegrityAudit {
  constructor() {
    this.issues = [];
    this.stats = {};
  }

  async checkPrescriptionIntegrity() {
    console.log('\n📋 Checking Prescription Integrity...\n');
    
    const prescriptions = await prisma.prescription.findMany({
      include: {
        patient: true,
        medecinPrescripteur: true
      }
    });
    const doctors = await prisma.medecin.findMany();
    const patients = await prisma.patient.findMany();

    const doctorIds = new Set(doctors.map(d => d.id));
    const patientIds = new Set(patients.map(p => p.id));

    let validCount = 0;
    let invalidDoctorCount = 0;
    let invalidPatientCount = 0;

    prescriptions.forEach(p => {
      const hasValidDoctor = doctorIds.has(p.medecinId);
      const hasValidPatient = patientIds.has(p.patientId);

      if (hasValidDoctor && hasValidPatient) {
        validCount++;
      } else {
        if (!hasValidDoctor) {
          invalidDoctorCount++;
          this.issues.push({
            table: 'Prescription',
            id: p.id.substring(0, 8),
            issue: `Invalid medecinId: ${p.medecinId.substring(0, 8)}`,
            severity: 'CRITICAL'
          });
        }
        if (!hasValidPatient) {
          invalidPatientCount++;
          this.issues.push({
            table: 'Prescription',
            id: p.id.substring(0, 8),
            issue: `Invalid patientId: ${p.patientId.substring(0, 8)}`,
            severity: 'CRITICAL'
          });
        }
      }
    });

    console.log(`   Total Prescriptions: ${prescriptions.length}`);
    console.log(`   ✅ Valid References: ${validCount}`);
    if (invalidDoctorCount > 0) console.log(`   ❌ Invalid Doctor IDs: ${invalidDoctorCount}`);
    if (invalidPatientCount > 0) console.log(`   ❌ Invalid Patient IDs: ${invalidPatientCount}`);

    this.stats.prescriptions = {
      total: prescriptions.length,
      valid: validCount,
      invalidDoctors: invalidDoctorCount,
      invalidPatients: invalidPatientCount
    };
  }

  async checkRendezVousIntegrity() {
    console.log('\n📅 Checking RendezVous Integrity...\n');
    
    const rendezvous = await prisma.rendezVous.findMany({
      include: {
        patient: true,
        medecin: true,
        salle: true,
        prescription: true
      }
    });
    const patients = await prisma.patient.findMany();
    const doctors = await prisma.medecin.findMany();
    const salles = await prisma.salle.findMany();
    const prescriptions = await prisma.prescription.findMany();

    const patientIds = new Set(patients.map(p => p.id));
    const doctorIds = new Set(doctors.map(d => d.id));
    const salleIds = new Set(salles.map(s => s.id));
    const prescriptionIds = new Set(prescriptions.map(p => p.id));

    let validCount = 0;

    rendezvous.forEach(rv => {
      let isValid = patientIds.has(rv.patientId) && salleIds.has(rv.salleId);
      
      if (rv.medecinId && !doctorIds.has(rv.medecinId)) {
        this.issues.push({
          table: 'RendezVous',
          id: rv.id.substring(0, 8),
          issue: `Invalid medecinId: ${rv.medecinId.substring(0, 8)}`,
          severity: 'CRITICAL'
        });
        isValid = false;
      }
      
      if (rv.prescriptionId && !prescriptionIds.has(rv.prescriptionId)) {
        this.issues.push({
          table: 'RendezVous',
          id: rv.id.substring(0, 8),
          issue: `Invalid prescriptionId: ${rv.prescriptionId.substring(0, 8)}`,
          severity: 'CRITICAL'
        });
        isValid = false;
      }

      if (isValid) validCount++;
    });

    console.log(`   Total RendezVous: ${rendezvous.length}`);
    console.log(`   ✅ Valid References: ${validCount}`);
    if (rendezvous.length - validCount > 0) {
      console.log(`   ❌ Invalid References: ${rendezvous.length - validCount}`);
    }

    this.stats.rendezvous = {
      total: rendezvous.length,
      valid: validCount,
      invalid: rendezvous.length - validCount
    };
  }

  async checkDossierCPAIntegrity() {
    console.log('\n🏥 Checking DossierCPA Integrity...\n');
    
    const dossiers = await prisma.dossierCPA.findMany({
      include: {
        patient: true,
        anesthesiste: true,
        prescription: true
      }
    });
    const patients = await prisma.patient.findMany();
    const doctors = await prisma.medecin.findMany();
    const prescriptions = await prisma.prescription.findMany();

    const patientIds = new Set(patients.map(p => p.id));
    const doctorIds = new Set(doctors.map(d => d.id));
    const prescriptionIds = new Set(prescriptions.map(p => p.id));

    let validCount = 0;

    dossiers.forEach(d => {
      let isValid = patientIds.has(d.patientId);

      if (d.anesthesisteId && !doctorIds.has(d.anesthesisteId)) {
        this.issues.push({
          table: 'DossierCPA',
          id: d.id.substring(0, 8),
          issue: `Invalid anesthesisteId: ${d.anesthesisteId.substring(0, 8)}`,
          severity: 'CRITICAL'
        });
        isValid = false;
      }

      if (d.prescriptionId && !prescriptionIds.has(d.prescriptionId)) {
        this.issues.push({
          table: 'DossierCPA',
          id: d.id.substring(0, 8),
          issue: `Invalid prescriptionId: ${d.prescriptionId.substring(0, 8)}`,
          severity: 'CRITICAL'
        });
        isValid = false;
      }

      if (isValid) validCount++;
    });

    console.log(`   Total DossierCPA: ${dossiers.length}`);
    console.log(`   ✅ Valid References: ${validCount}`);
    if (dossiers.length - validCount > 0) {
      console.log(`   ❌ Invalid References: ${dossiers.length - validCount}`);
    }

    this.stats.dossiercpa = {
      total: dossiers.length,
      valid: validCount,
      invalid: dossiers.length - validCount
    };
  }

  async checkMasterDataIntegrity() {
    console.log('\n👥 Checking Master Data...\n');
    
    const patients = await prisma.patient.findMany();
    const doctors = await prisma.medecin.findMany();
    const salles = await prisma.salle.findMany();

    console.log(`   Total Patients: ${patients.length}`);
    console.log(`   Total Doctors: ${doctors.length}`);
    console.log(`   Total Salles: ${salles.length}`);

    this.stats.masterData = {
      patients: patients.length,
      doctors: doctors.length,
      salles: salles.length
    };
  }

  printReport() {
    console.log('\n' + '='.repeat(60));
    console.log('DATA INTEGRITY AUDIT REPORT');
    console.log('='.repeat(60) + '\n');

    if (this.issues.length === 0) {
      console.log('✅ STATUS: ALL SYSTEMS GREEN\n');
      console.log('Summary:');
      console.log(`   - All foreign key relationships are valid`);
      console.log(`   - No orphaned records detected`);
      console.log(`   - Database integrity verified\n`);
      
      console.log('Statistics:');
      Object.entries(this.stats).forEach(([key, value]) => {
        console.log(`   ${key}:`, JSON.stringify(value));
      });
    } else {
      console.log('⚠️  STATUS: ISSUES DETECTED\n');
      console.log(`Found ${this.issues.length} data integrity issues:\n`);
      
      this.issues.forEach((issue, i) => {
        console.log(`${i + 1}. [${issue.severity}] ${issue.table} (${issue.id})`);
        console.log(`   ${issue.issue}\n`);
      });
    }

    console.log('='.repeat(60) + '\n');
  }

  async run() {
    try {
      console.log('🔍 Starting Comprehensive Data Integrity Audit...');
      
      await this.checkMasterDataIntegrity();
      await this.checkPrescriptionIntegrity();
      await this.checkRendezVousIntegrity();
      await this.checkDossierCPAIntegrity();
      
      this.printReport();
    } catch (error) {
      console.error('❌ Error during audit:', error);
    } finally {
      await prisma.$disconnect();
    }
  }
}

// Run the audit
const audit = new DataIntegrityAudit();
audit.run();
