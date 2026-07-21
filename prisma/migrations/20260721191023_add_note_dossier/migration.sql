-- CreateTable
CREATE TABLE "NoteDossier" (
    "id" TEXT NOT NULL,
    "prescriptionId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "auteur" TEXT NOT NULL,
    "contenu" TEXT NOT NULL,
    "dateCreation" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NoteDossier_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NoteDossier_prescriptionId_idx" ON "NoteDossier"("prescriptionId");

-- CreateIndex
CREATE INDEX "NoteDossier_serviceId_idx" ON "NoteDossier"("serviceId");

-- AddForeignKey
ALTER TABLE "NoteDossier" ADD CONSTRAINT "NoteDossier_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "Prescription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

