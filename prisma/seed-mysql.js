/**
 * Remplit la base MySQL locale (vide) avec le jeu de données complet,
 * avant migration vers PostgreSQL Render.
 */
require('dotenv/config');
const mysql = require('mysql2/promise');
const { randomUUID } = require('crypto');

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

async function main() {
  const conn = await mysql.createConnection(parseMysqlUrl(SOURCE_URL));
  console.log('🌱 Peuplement MySQL local...\n');

  const medecins = [
    ['Moreau', 'Antoine', 'Gastro-entérologie'],
    ['Lefebvre', 'Marie', 'Anesthésie'],
    ['Durand', 'Pierre', 'Gastro-entérologie'],
    ['Bernard', 'Luc', 'Endoscopie'],
    ['Dubois', 'Sophie', 'Hépato-gastro'],
    ['Martin', 'Claire', 'Anesthésie'],
    ['Petit', 'Julien', 'Chirurgie digestive'],
    ['Leroy', 'Isabelle', 'Gastro-entérologie'],
    ['Morel', 'Nicolas', 'Endoscopie'],
    ['Robert', 'Camille', 'Gastro-entérologie'],
    ['Durand', 'Claire', 'Endoscopie'],
    ['Lambert', 'Thomas', 'Anesthésie'],
  ].map(([nom, prenom, specialite]) => ({
    id: randomUUID(),
    nom,
    prenom,
    specialite,
    role: 'Médecin',
  }));

  const patients = [
    ['Marchand', 'Jean-Pierre', '1955-04-12', 'M', 'O+', 78.5],
    ['Rousseau', 'Françoise', '1962-08-28', 'F', 'A+', 65],
    ['Delaunay', 'Marc', '1948-12-05', 'M', 'B+', 82.3],
    ['Fontaine', 'Christine', '1970-02-19', 'F', 'AB+', 58.7],
    ['Garnier', 'Michel', '1960-06-14', 'M', 'O-', 75.2],
    ['Mercier', 'Véronique', '1965-10-03', 'F', 'A-', 62.1],
    ['Leclerc', 'Régis', '1952-03-22', 'M', 'B-', 80.9],
    ['Laurent', 'Jacqueline', '1958-07-11', 'F', 'AB-', 61.3],
    ['Simon', 'Philippe', '1968-01-30', 'M', 'O+', 71],
    ['Girard', 'Nathalie', '1975-11-08', 'F', 'A+', 59.4],
  ].map(([nom, prenom, dn, sexe, gs, poids]) => ({
    id: randomUUID(),
    nom,
    prenom,
    dateNaissance: dn,
    sexe,
    groupeSanguin: gs,
    poids,
    antecedentsMedicaux: 'Antécédents en cours de saisie',
  }));

  const salles = [
    ['Salle Endoscopie 1', 'S01', 1, 'Coloscope HD'],
    ['Salle Endoscopie 2', 'S02', 1, 'Gastroscope'],
    ['Salle Endoscopie 3', 'S03', 2, 'CPRE + monitoring'],
    ['Salle Urgences', 'SU1', 1, 'Matériel urgence'],
  ].map(([nom, numero, capacite, equipement]) => ({
    id: randomUUID(),
    nom,
    numero,
    capacite,
    equipement,
    estActive: 1,
  }));

  await conn.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const t of [
    'checklistavant',
    'dossiercpa',
    'rendezvous',
    'prescription',
    'salle',
    'patient',
    'medecin',
  ]) {
    await conn.query(`TRUNCATE TABLE \`${t}\``);
  }
  await conn.query('SET FOREIGN_KEY_CHECKS = 1');

  for (const m of medecins) {
    await conn.query(
      'INSERT INTO medecin (id, nom, prenom, specialite, role) VALUES (?, ?, ?, ?, ?)',
      [m.id, m.nom, m.prenom, m.specialite, m.role],
    );
  }

  for (const p of patients) {
    await conn.query(
      'INSERT INTO patient (id, nom, prenom, dateNaissance, sexe, groupeSanguin, poids, antecedentsMedicaux) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [p.id, p.nom, p.prenom, p.dateNaissance, p.sexe, p.groupeSanguin, p.poids, p.antecedentsMedicaux],
    );
  }

  for (const s of salles) {
    await conn.query(
      'INSERT INTO salle (id, nom, numero, capacite, equipement, estActive) VALUES (?, ?, ?, ?, ?, ?)',
      [s.id, s.nom, s.numero, s.capacite, s.equipement, s.estActive],
    );
  }

  const typesExamen = [
    'Fibroscopie digestive haute',
    'Injection de colle biologique',
    'Dilatation oesophagienne',
    'Extraction de corps étranger',
    'Coloscopie',
    'Rectosigmoidoscopie',
  ];

  for (const typeName of typesExamen) {
    await conn.query(
      'INSERT IGNORE INTO EndoscopyExamType (id, name, code, description) VALUES (?, ?, ?, ?)',
      [
        randomUUID(),
        typeName,
        typeName
          .normalize('NFD')
          .replace(/\p{Diacritic}/gu, '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_|_$/g, ''),
        typeName,
      ],
    );
  }

  const priorites = ['Standard', 'Urgent', 'STAT'];
  const motifs = [
    'Dépistage cancer colorectal',
    'Surveillance polypose',
    'Symptômes digestifs',
    'Douleurs abdominales',
    'Saignement digestif',
  ];

  const prescriptions = [];
  let rxCount = 0;
  while (rxCount < 40) {
    const patient = patients[rxCount % patients.length];
    const medecin = medecins[rxCount % medecins.length];
    const id = randomUUID();
    prescriptions.push({
      id,
      patientId: patient.id,
      medecinId: medecin.id,
      typeExamen: typesExamen[rxCount % typesExamen.length],
      motif: motifs[rxCount % motifs.length],
      priorite: priorites[rxCount % priorites.length],
      statut: rxCount % 3 === 0 ? 'Planifié' : 'A planifier',
      dateDemande: new Date(Date.now() - rxCount * 86400000),
    });
    rxCount++;
  }

  for (const rx of prescriptions) {
    await conn.query(
      `INSERT INTO prescription (id, patientId, medecinId, typeExamen, motif, priorite, statut, dateDemande)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        rx.id,
        rx.patientId,
        rx.medecinId,
        rx.typeExamen,
        rx.motif,
        rx.priorite,
        rx.statut,
        rx.dateDemande,
      ],
    );
  }

  for (let i = 0; i < 15; i++) {
    const rx = prescriptions[i];
    const salle = salles[i % salles.length];
    const start = new Date();
    start.setHours(8 + (i % 8), (i % 2) * 30, 0, 0);
    const end = new Date(start.getTime() + 45 * 60000);
    await conn.query(
      `INSERT INTO rendezvous (id, patientId, prescriptionId, salleId, medecinId, dateHeureDebut, dateHeureFin, statut, notesCliniques)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        rx.patientId,
        rx.id,
        salle.id,
        rx.medecinId,
        start,
        end,
        i % 4 === 0 ? 'En cours' : 'Prevu',
        `RDV planifié #${i + 1}`,
      ],
    );
  }

  await conn.end();
  console.log(`✅ MySQL: ${medecins.length} médecins, ${patients.length} patients, ${salles.length} salles, ${prescriptions.length} prescriptions, 15 rendez-vous`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
