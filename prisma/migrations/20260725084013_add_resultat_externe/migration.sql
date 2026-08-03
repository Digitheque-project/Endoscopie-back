-- CreateTable
CREATE TABLE "ResultatExterne" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "sourceService" TEXT,
    "typeExamen" TEXT,
    "motif" TEXT NOT NULL,
    "payload" JSONB,
    "entiteRefType" TEXT,
    "entiteRefId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResultatExterne_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ResultatExterne_patientId_idx" ON "ResultatExterne"("patientId");

-- CreateIndex
CREATE INDEX "ResultatExterne_serviceId_idx" ON "ResultatExterne"("serviceId");
