-- DropForeignKey
ALTER TABLE "RendezVous" DROP CONSTRAINT "RendezVous_patientId_fkey";

-- DropForeignKey
ALTER TABLE "RendezVous" DROP CONSTRAINT "RendezVous_salleId_fkey";

-- AlterTable
ALTER TABLE "RendezVous" ADD COLUMN "patientName" TEXT,
    ALTER COLUMN "patientId" DROP NOT NULL,
    ALTER COLUMN "salleId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "RendezVous" ADD CONSTRAINT "RendezVous_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RendezVous" ADD CONSTRAINT "RendezVous_salleId_fkey" FOREIGN KEY ("salleId") REFERENCES "Salle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
