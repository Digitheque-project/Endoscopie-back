-- CreateTable ServiceSource
CREATE TABLE "ServiceSource" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "urlWebhook" TEXT NOT NULL,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "contact" TEXT,
    "hopital" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastNotifiedAt" TIMESTAMP(3),

    CONSTRAINT "ServiceSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable LogWebhook
CREATE TABLE "LogWebhook" (
    "id" TEXT NOT NULL,
    "serviceSourceId" TEXT NOT NULL,
    "prescriptionId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL DEFAULT 'EXAMEN_TERMINE',
    "httpStatus" INTEGER,
    "tentatives" INTEGER NOT NULL DEFAULT 1,
    "prochainEssai" TIMESTAMP(3),
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LogWebhook_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ServiceSource_nom_key" ON "ServiceSource"("nom");

-- CreateIndex
CREATE INDEX "ServiceSource_actif_idx" ON "ServiceSource"("actif");

-- CreateIndex
CREATE INDEX "LogWebhook_serviceSourceId_idx" ON "LogWebhook"("serviceSourceId");

-- CreateIndex
CREATE INDEX "LogWebhook_prescriptionId_idx" ON "LogWebhook"("prescriptionId");

-- CreateIndex
CREATE INDEX "LogWebhook_patientId_idx" ON "LogWebhook"("patientId");

-- CreateIndex
CREATE INDEX "LogWebhook_timestamp_idx" ON "LogWebhook"("timestamp");

-- AddForeignKey
ALTER TABLE "LogWebhook" ADD CONSTRAINT "LogWebhook_serviceSourceId_fkey" FOREIGN KEY ("serviceSourceId") REFERENCES "ServiceSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
