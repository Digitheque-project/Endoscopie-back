-- Add external API access management for external services
-- Tables for ServiceExterne and LogAccesExterne

CREATE TABLE "ServiceExterne" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "nom" TEXT NOT NULL UNIQUE,
    "apiKey" TEXT NOT NULL UNIQUE,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "contact" TEXT,
    "hopital" TEXT
);

CREATE TABLE "LogAccesExterne" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "serviceExterneId" TEXT NOT NULL,
    "prescriptionId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "statut" INTEGER NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LogAccesExterne_serviceExterneId_fkey" FOREIGN KEY ("serviceExterneId") REFERENCES "ServiceExterne" ("id") ON DELETE CASCADE
);

CREATE INDEX "ServiceExterne_apiKey_idx" ON "ServiceExterne"("apiKey");
CREATE INDEX "LogAccesExterne_serviceExterneId_idx" ON "LogAccesExterne"("serviceExterneId");
CREATE INDEX "LogAccesExterne_prescriptionId_idx" ON "LogAccesExterne"("prescriptionId");
CREATE INDEX "LogAccesExterne_patientId_idx" ON "LogAccesExterne"("patientId");
CREATE INDEX "LogAccesExterne_timestamp_idx" ON "LogAccesExterne"("timestamp");
