-- CreateTable
CREATE TABLE "Patient" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "prenom" TEXT NOT NULL,
    "dateNaissance" TIMESTAMP(3),
    "sexe" TEXT,
    "groupeSanguin" TEXT,
    "poids" DOUBLE PRECISION,
    "antecedentsMedicaux" TEXT,

    CONSTRAINT "Patient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Medecin" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "prenom" TEXT NOT NULL,
    "specialite" TEXT,
    "role" TEXT,

    CONSTRAINT "Medecin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Salle" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "capacite" INTEGER NOT NULL DEFAULT 1,
    "equipement" TEXT DEFAULT '',
    "estActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Salle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Prescription" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "medecinId" TEXT NOT NULL,
    "typeExamen" TEXT NOT NULL,
    "motif" TEXT,
    "priorite" TEXT NOT NULL DEFAULT 'Standard',
    "statut" TEXT NOT NULL DEFAULT 'A planifier',
    "dateDemande" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Prescription_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Prescription_medecinId_idx" ON "Prescription"("medecinId");
CREATE INDEX "Prescription_patientId_idx" ON "Prescription"("patientId");

-- CreateTable
CREATE TABLE "RendezVous" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "prescriptionId" TEXT,
    "salleId" TEXT NOT NULL,
    "medecinId" TEXT,
    "dateHeureDebut" TIMESTAMP(3) NOT NULL,
    "dateHeureFin" TIMESTAMP(3),
    "typeAnesthesie" TEXT,
    "statut" TEXT NOT NULL DEFAULT 'Prevu',
    "notesCliniques" TEXT,

    CONSTRAINT "RendezVous_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RendezVous_prescriptionId_key" ON "RendezVous"("prescriptionId");
CREATE INDEX "RendezVous_patientId_idx" ON "RendezVous"("patientId");
CREATE INDEX "RendezVous_medecinId_idx" ON "RendezVous"("medecinId");
CREATE INDEX "RendezVous_prescriptionId_idx" ON "RendezVous"("prescriptionId");

-- CreateTable
CREATE TABLE "DossierCPA" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "prescriptionId" TEXT,
    "anesthesisteId" TEXT,
    "typeAnesthesie" TEXT,
    "observations" TEXT,
    "statut" TEXT NOT NULL DEFAULT 'Brouillon',
    "dateValidation" TIMESTAMP(3),

    CONSTRAINT "DossierCPA_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DossierCPA_prescriptionId_key" ON "DossierCPA"("prescriptionId");
CREATE INDEX "DossierCPA_patientId_idx" ON "DossierCPA"("patientId");
CREATE INDEX "DossierCPA_anesthesisteId_idx" ON "DossierCPA"("anesthesisteId");
CREATE INDEX "DossierCPA_prescriptionId_idx" ON "DossierCPA"("prescriptionId");

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_medecinId_fkey" FOREIGN KEY ("medecinId") REFERENCES "Medecin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RendezVous" ADD CONSTRAINT "RendezVous_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RendezVous" ADD CONSTRAINT "RendezVous_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "Prescription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RendezVous" ADD CONSTRAINT "RendezVous_salleId_fkey" FOREIGN KEY ("salleId") REFERENCES "Salle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RendezVous" ADD CONSTRAINT "RendezVous_medecinId_fkey" FOREIGN KEY ("medecinId") REFERENCES "Medecin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DossierCPA" ADD CONSTRAINT "DossierCPA_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DossierCPA" ADD CONSTRAINT "DossierCPA_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "Prescription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DossierCPA" ADD CONSTRAINT "DossierCPA_anesthesisteId_fkey" FOREIGN KEY ("anesthesisteId") REFERENCES "Medecin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "ChecklistAvant" (
    "id" TEXT NOT NULL,
    "prescriptionId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "bilan" TEXT,
    "depistageCovid" BOOLEAN,
    "tenueSterile" BOOLEAN,
    "consentement" BOOLEAN,
    "jejunum" BOOLEAN,
    "medicaments" TEXT,
    "autres" TEXT,
    "dateCreation" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dateModification" TIMESTAMP(3),

    CONSTRAINT "ChecklistAvant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChecklistAvant_prescriptionId_key" ON "ChecklistAvant"("prescriptionId");
CREATE INDEX "ChecklistAvant_prescriptionId_idx" ON "ChecklistAvant"("prescriptionId");
CREATE INDEX "ChecklistAvant_serviceId_idx" ON "ChecklistAvant"("serviceId");

-- CreateTable
CREATE TABLE "OperationEndoscopie" (
    "id" TEXT NOT NULL,
    "prescriptionId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "dateOperation" TIMESTAMP(3),
    "typeAnesthesie" TEXT,
    "medecinId" TEXT,
    "salleId" TEXT,
    "duree" INTEGER,
    "notes" TEXT,

    CONSTRAINT "OperationEndoscopie_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OperationEndoscopie_prescriptionId_key" ON "OperationEndoscopie"("prescriptionId");
CREATE INDEX "OperationEndoscopie_prescriptionId_idx" ON "OperationEndoscopie"("prescriptionId");
CREATE INDEX "OperationEndoscopie_serviceId_idx" ON "OperationEndoscopie"("serviceId");
CREATE INDEX "OperationEndoscopie_medecinId_idx" ON "OperationEndoscopie"("medecinId");
CREATE INDEX "OperationEndoscopie_salleId_idx" ON "OperationEndoscopie"("salleId");

-- CreateTable
CREATE TABLE "ChecklistApres" (
    "id" TEXT NOT NULL,
    "prescriptionId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "etat" TEXT,
    "notes" TEXT,
    "dateCreation" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChecklistApres_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChecklistApres_prescriptionId_key" ON "ChecklistApres"("prescriptionId");
CREATE INDEX "ChecklistApres_prescriptionId_idx" ON "ChecklistApres"("prescriptionId");
CREATE INDEX "ChecklistApres_serviceId_idx" ON "ChecklistApres"("serviceId");

-- CreateTable
CREATE TABLE "ResultatEndoscopie" (
    "id" TEXT NOT NULL,
    "prescriptionId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "findings" TEXT,
    "reportText" TEXT,
    "doctorName" TEXT,
    "dateCreation" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResultatEndoscopie_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ResultatEndoscopie_prescriptionId_key" ON "ResultatEndoscopie"("prescriptionId");
CREATE INDEX "ResultatEndoscopie_prescriptionId_idx" ON "ResultatEndoscopie"("prescriptionId");
CREATE INDEX "ResultatEndoscopie_serviceId_idx" ON "ResultatEndoscopie"("serviceId");

-- AddForeignKey
ALTER TABLE "ChecklistAvant" ADD CONSTRAINT "ChecklistAvant_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "Prescription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationEndoscopie" ADD CONSTRAINT "OperationEndoscopie_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "Prescription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationEndoscopie" ADD CONSTRAINT "OperationEndoscopie_medecinId_fkey" FOREIGN KEY ("medecinId") REFERENCES "Medecin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationEndoscopie" ADD CONSTRAINT "OperationEndoscopie_salleId_fkey" FOREIGN KEY ("salleId") REFERENCES "Salle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistApres" ADD CONSTRAINT "ChecklistApres_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "Prescription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultatEndoscopie" ADD CONSTRAINT "ResultatEndoscopie_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "Prescription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
