/*
  Warnings:

  - You are about to drop the column `etat` on the `ChecklistApres` table. All the data in the column will be lost.
  - You are about to drop the column `notes` on the `ChecklistApres` table. All the data in the column will be lost.
  - You are about to drop the column `autres` on the `ChecklistAvant` table. All the data in the column will be lost.
  - You are about to drop the column `bilan` on the `ChecklistAvant` table. All the data in the column will be lost.
  - You are about to drop the column `consentement` on the `ChecklistAvant` table. All the data in the column will be lost.
  - You are about to drop the column `depistageCovid` on the `ChecklistAvant` table. All the data in the column will be lost.
  - You are about to drop the column `jejunum` on the `ChecklistAvant` table. All the data in the column will be lost.
  - You are about to drop the column `medicaments` on the `ChecklistAvant` table. All the data in the column will be lost.
  - You are about to drop the column `tenueSterile` on the `ChecklistAvant` table. All the data in the column will be lost.
  - You are about to drop the column `dateOperation` on the `OperationEndoscopie` table. All the data in the column will be lost.
  - You are about to drop the column `duree` on the `OperationEndoscopie` table. All the data in the column will be lost.
  - You are about to drop the column `medecinId` on the `OperationEndoscopie` table. All the data in the column will be lost.
  - You are about to drop the column `notes` on the `OperationEndoscopie` table. All the data in the column will be lost.
  - You are about to drop the column `salleId` on the `OperationEndoscopie` table. All the data in the column will be lost.
  - You are about to drop the column `typeAnesthesie` on the `OperationEndoscopie` table. All the data in the column will be lost.
  - You are about to drop the column `patientName` on the `RendezVous` table. All the data in the column will be lost.
  - You are about to drop the column `findings` on the `ResultatEndoscopie` table. All the data in the column will be lost.
  - Added the required column `dateModification` to the `ChecklistApres` table without a default value. This is not possible if the table is not empty.
  - Added the required column `patientId` to the `ChecklistApres` table without a default value. This is not possible if the table is not empty.
  - Added the required column `patientId` to the `ChecklistAvant` table without a default value. This is not possible if the table is not empty.
  - Made the column `dateModification` on table `ChecklistAvant` required. This step will fail if there are existing NULL values in that column.
  - Added the required column `dateModification` to the `OperationEndoscopie` table without a default value. This is not possible if the table is not empty.
  - Added the required column `patientId` to the `OperationEndoscopie` table without a default value. This is not possible if the table is not empty.
  - Added the required column `dateModification` to the `ResultatEndoscopie` table without a default value. This is not possible if the table is not empty.
  - Added the required column `patientId` to the `ResultatEndoscopie` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "OperationEndoscopie" DROP CONSTRAINT "OperationEndoscopie_medecinId_fkey";

-- DropForeignKey
ALTER TABLE "OperationEndoscopie" DROP CONSTRAINT "OperationEndoscopie_salleId_fkey";

-- DropIndex
DROP INDEX "OperationEndoscopie_medecinId_idx";

-- DropIndex
DROP INDEX "OperationEndoscopie_salleId_idx";

-- AlterTable
ALTER TABLE "ChecklistApres" DROP COLUMN "etat",
DROP COLUMN "notes",
ADD COLUMN     "confirmationEtiquetage" TEXT,
ADD COLUMN     "dateModification" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "estValide" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "patientId" TEXT NOT NULL,
ADD COLUMN     "prescriptionsPostActe" TEXT,
ADD COLUMN     "remarques" TEXT;

-- AlterTable
ALTER TABLE "ChecklistAvant" DROP COLUMN "autres",
DROP COLUMN "bilan",
DROP COLUMN "consentement",
DROP COLUMN "depistageCovid",
DROP COLUMN "jejunum",
DROP COLUMN "medicaments",
DROP COLUMN "tenueSterile",
ADD COLUMN     "antibioprophylaxie" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "anticoagulantsArretes" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "constantes_pouls" TEXT,
ADD COLUMN     "constantes_saturation" TEXT,
ADD COLUMN     "constantes_tension" TEXT,
ADD COLUMN     "estValide" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "identiteVerifiee" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "jeuneRespecte" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "materielDisponible" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "observations" TEXT,
ADD COLUMN     "patientId" TEXT NOT NULL,
ADD COLUMN     "preparationAdequate" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "procedureConfirmee" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "rendezVousId" TEXT,
ADD COLUMN     "risquesVerifies" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "tenueAppropriee" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "validationCollegiale" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "dateModification" SET NOT NULL;

-- AlterTable
ALTER TABLE "OperationEndoscopie" DROP COLUMN "dateOperation",
DROP COLUMN "duree",
DROP COLUMN "medecinId",
DROP COLUMN "notes",
DROP COLUMN "salleId",
DROP COLUMN "typeAnesthesie",
ADD COLUMN     "dateCreation" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "dateModification" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "medicalNotes" TEXT,
ADD COLUMN     "patientId" TEXT NOT NULL,
ADD COLUMN     "voiceTranscripts" JSONB;

-- AlterTable
ALTER TABLE "Prescription" ADD COLUMN     "typeExamenRefId" TEXT;

-- AlterTable
ALTER TABLE "RendezVous" DROP COLUMN "patientName";

-- AlterTable
ALTER TABLE "ResultatEndoscopie" DROP COLUMN "findings",
ADD COLUMN     "biopsy" TEXT,
ADD COLUMN     "complication" TEXT,
ADD COLUMN     "conclusion" TEXT,
ADD COLUMN     "dateModification" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "followUp" TEXT,
ADD COLUMN     "mainDiagnosis" TEXT,
ADD COLUMN     "observations" TEXT,
ADD COLUMN     "patientId" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "EndoscopyExamType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "description" TEXT,

    CONSTRAINT "EndoscopyExamType_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EndoscopyExamType_name_key" ON "EndoscopyExamType"("name");

-- CreateIndex
CREATE UNIQUE INDEX "EndoscopyExamType_code_key" ON "EndoscopyExamType"("code");

-- CreateIndex
CREATE INDEX "ChecklistApres_patientId_idx" ON "ChecklistApres"("patientId");

-- CreateIndex
CREATE INDEX "ChecklistAvant_patientId_idx" ON "ChecklistAvant"("patientId");

-- CreateIndex
CREATE INDEX "OperationEndoscopie_patientId_idx" ON "OperationEndoscopie"("patientId");

-- CreateIndex
CREATE INDEX "Prescription_typeExamenRefId_idx" ON "Prescription"("typeExamenRefId");

-- CreateIndex
CREATE INDEX "ResultatEndoscopie_patientId_idx" ON "ResultatEndoscopie"("patientId");

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_typeExamenRefId_fkey" FOREIGN KEY ("typeExamenRefId") REFERENCES "EndoscopyExamType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistAvant" ADD CONSTRAINT "ChecklistAvant_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationEndoscopie" ADD CONSTRAINT "OperationEndoscopie_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistApres" ADD CONSTRAINT "ChecklistApres_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultatEndoscopie" ADD CONSTRAINT "ResultatEndoscopie_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
