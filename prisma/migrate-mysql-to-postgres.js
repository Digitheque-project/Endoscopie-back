/**
 * Migre toutes les données MySQL (source) vers PostgreSQL Render (DATABASE_URL dans .env).
 *
 * Usage:
 *   SOURCE_DATABASE_URL="mysql://root:@localhost:3306/endoscopie" node prisma/migrate-mysql-to-postgres.js
 */
require('dotenv/config');
const mysql = require('mysql2/promise');
const { PrismaClient } = require('@prisma/client');

const SOURCE_URL =
  process.env.SOURCE_DATABASE_URL || 'mysql://root:@localhost:3306/endoscopie';

function parseMysqlUrl(url) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 3306),
    user: decodeURIComponent(u.username || 'root'),
    password: decodeURIComponent(u.password || ''),
    database: u.pathname.replace(/^\//, ''),
  };
}

const TABLE_NAMES = {
  Patient: ['Patient', 'patient'],
  Medecin: ['Medecin', 'medecin'],
  Salle: ['Salle', 'salle'],
  Prescription: ['Prescription', 'prescription'],
  RendezVous: ['RendezVous', 'rendezvous'],
  DossierCPA: ['DossierCPA', 'dossiercpa'],
  ChecklistAvant: ['ChecklistAvant', 'checklistavant'],
};

async function fetchTable(conn, model) {
  const candidates = TABLE_NAMES[model] || [model];
  for (const table of candidates) {
    try {
      const [rows] = await conn.query(`SELECT * FROM \`${table}\``);
      return rows;
    } catch (err) {
      if (err.code !== 'ER_NO_SUCH_TABLE') throw err;
    }
  }
  return [];
}

function toDate(value) {
  if (value == null) return null;
  return value instanceof Date ? value : new Date(value);
}

function toBool(value) {
  if (value == null) return false;
  return Boolean(value);
}

async function clearTarget(prisma) {
  await prisma.checklistAvant.deleteMany();
  await prisma.dossierCPA.deleteMany();
  await prisma.rendezVous.deleteMany();
  await prisma.prescription.deleteMany();
  await prisma.salle.deleteMany();
  await prisma.patient.deleteMany();
  await prisma.medecin.deleteMany();
}

async function main() {
  const mysqlConfig = parseMysqlUrl(SOURCE_URL);
  console.log(`📥 Source MySQL: ${mysqlConfig.host}:${mysqlConfig.port}/${mysqlConfig.database}`);
  console.log(`📤 Cible PostgreSQL: ${process.env.DATABASE_URL?.replace(/:[^:@]+@/, ':***@')}\n`);

  const conn = await mysql.createConnection(mysqlConfig);
  const prisma = new PrismaClient();

  const tables = [
    'Patient',
    'Medecin',
    'Salle',
    'Prescription',
    'RendezVous',
    'DossierCPA',
    'ChecklistAvant',
  ];

  const data = {};
  for (const table of tables) {
    data[table] = await fetchTable(conn, table);
    console.log(`  ✓ ${table}: ${data[table].length} enregistrement(s)`);
  }

  await conn.end();

  const total =
    data.Patient.length +
    data.Medecin.length +
    data.Prescription.length +
    data.Salle.length +
    data.RendezVous.length +
    data.DossierCPA.length +
    data.ChecklistAvant.length;

  if (total === 0) {
    console.error('\n❌ Aucune donnée trouvée dans MySQL. Vérifiez que MySQL tourne et que la base "endoscopie" existe.');
    process.exit(1);
  }

  console.log('\n🗑️  Vidage de la base PostgreSQL cible...');
  await clearTarget(prisma);

  console.log('📤 Import des données...\n');

  if (data.Medecin.length) {
    await prisma.medecin.createMany({
      data: data.Medecin.map((r) => ({
        id: r.id,
        nom: r.nom,
        prenom: r.prenom,
        specialite: r.specialite,
        role: r.role,
      })),
    });
    console.log(`  ✓ Medecin: ${data.Medecin.length}`);
  }

  if (data.Patient.length) {
    await prisma.patient.createMany({
      data: data.Patient.map((r) => ({
        id: r.id,
        nom: r.nom,
        prenom: r.prenom,
        dateNaissance: toDate(r.dateNaissance),
        sexe: r.sexe,
        groupeSanguin: r.groupeSanguin,
        poids: r.poids,
        antecedentsMedicaux: r.antecedentsMedicaux,
      })),
    });
    console.log(`  ✓ Patient: ${data.Patient.length}`);
  }

  if (data.Salle.length) {
    await prisma.salle.createMany({
      data: data.Salle.map((r) => ({
        id: r.id,
        nom: r.nom,
        numero: r.numero,
        capacite: r.capacite ?? 1,
        equipement: r.equipement ?? '',
        estActive: toBool(r.estActive ?? true),
      })),
    });
    console.log(`  ✓ Salle: ${data.Salle.length}`);
  }

  if (data.Prescription.length) {
    await prisma.prescription.createMany({
      data: data.Prescription.map((r) => ({
        id: r.id,
        patientId: r.patientId,
        medecinId: r.medecinId,
        typeExamen: r.typeExamen,
        motif: r.motif,
        priorite: r.priorite ?? 'Standard',
        statut: r.statut ?? 'A planifier',
        dateDemande: toDate(r.dateDemande) ?? new Date(),
      })),
    });
    console.log(`  ✓ Prescription: ${data.Prescription.length}`);
  }

  if (data.RendezVous.length) {
    for (const r of data.RendezVous) {
      await prisma.rendezVous.create({
        data: {
          id: r.id,
          patientId: r.patientId ?? null,
          prescriptionId: r.prescriptionId ?? null,
          salleId: r.salleId ?? null,
          medecinId: r.medecinId ?? null,
          dateHeureDebut: toDate(r.dateHeureDebut),
          dateHeureFin: toDate(r.dateHeureFin),
          typeAnesthesie: r.typeAnesthesie,
          statut: r.statut ?? 'Prevu',
          notesCliniques: r.notesCliniques,
        },
      });
    }
    console.log(`  ✓ RendezVous: ${data.RendezVous.length}`);
  }

  if (data.DossierCPA.length) {
    await prisma.dossierCPA.createMany({
      data: data.DossierCPA.map((r) => ({
        id: r.id,
        patientId: r.patientId,
        prescriptionId: r.prescriptionId ?? null,
        anesthesisteId: r.anesthesisteId ?? null,
        typeAnesthesie: r.typeAnesthesie,
        observations: r.observations,
        statut: r.statut ?? 'Brouillon',
        dateValidation: toDate(r.dateValidation),
      })),
    });
    console.log(`  ✓ DossierCPA: ${data.DossierCPA.length}`);
  }

  if (data.ChecklistAvant.length) {
    for (const r of data.ChecklistAvant) {
      await prisma.checklistAvant.create({
        data: {
          id: r.id,
          prescriptionId: r.prescriptionId,
          rendezVousId: r.rendezVousId ?? null,
          patientId: r.patientId,
          identiteVerifiee: toBool(r.identiteVerifiee),
          procedureConfirmee: toBool(r.procedureConfirmee),
          materielDisponible: toBool(r.materielDisponible),
          risquesVerifies: toBool(r.risquesVerifies),
          jeuneRespecte: toBool(r.jeuneRespecte),
          preparationAdequate: toBool(r.preparationAdequate),
          validationCollegiale: toBool(r.validationCollegiale),
          anticoagulantsArretes: toBool(r.anticoagulantsArretes),
          antibioprophylaxie: toBool(r.antibioprophylaxie),
          tenueAppropriee: toBool(r.tenueAppropriee),
          constantes_tension: r.constantes_tension,
          constantes_pouls: r.constantes_pouls,
          constantes_saturation: r.constantes_saturation,
          observations: r.observations,
          estValide: toBool(r.estValide),
          dateCreation: toDate(r.dateCreation) ?? new Date(),
          dateModification: toDate(r.dateModification) ?? new Date(),
        },
      });
    }
    console.log(`  ✓ ChecklistAvant: ${data.ChecklistAvant.length}`);
  }

  const final = {
    Patient: await prisma.patient.count(),
    Medecin: await prisma.medecin.count(),
    Salle: await prisma.salle.count(),
    Prescription: await prisma.prescription.count(),
    RendezVous: await prisma.rendezVous.count(),
    DossierCPA: await prisma.dossierCPA.count(),
    ChecklistAvant: await prisma.checklistAvant.count(),
  };

  console.log('\n✅ Migration terminée — PostgreSQL Render:');
  console.log(JSON.stringify(final, null, 2));

  await prisma.$disconnect();
}

main()
  .catch((e) => {
    console.error('\n❌ Erreur de migration:', e.message || e);
    if (e.code === 'ECONNREFUSED') {
      console.error('   → Démarrez MySQL (XAMPP/WAMP/Docker) puis relancez le script.');
    }
    process.exit(1);
  });
