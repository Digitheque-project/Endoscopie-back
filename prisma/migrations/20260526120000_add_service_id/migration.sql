-- Service Endoscopie CHU (Railway)
ALTER TABLE "Prescription" ADD COLUMN IF NOT EXISTS "serviceId" TEXT;
ALTER TABLE "RendezVous" ADD COLUMN IF NOT EXISTS "serviceId" TEXT;
ALTER TABLE "Salle" ADD COLUMN IF NOT EXISTS "serviceId" TEXT;
ALTER TABLE "DossierCPA" ADD COLUMN IF NOT EXISTS "serviceId" TEXT;
ALTER TABLE "ChecklistAvant" ADD COLUMN IF NOT EXISTS "serviceId" TEXT;

UPDATE "Prescription" SET "serviceId" = '38f39d38-152e-495b-8c48-28937750d9eb' WHERE "serviceId" IS NULL;
UPDATE "RendezVous" SET "serviceId" = '38f39d38-152e-495b-8c48-28937750d9eb' WHERE "serviceId" IS NULL;
UPDATE "Salle" SET "serviceId" = '38f39d38-152e-495b-8c48-28937750d9eb' WHERE "serviceId" IS NULL;
UPDATE "DossierCPA" SET "serviceId" = '38f39d38-152e-495b-8c48-28937750d9eb' WHERE "serviceId" IS NULL;
UPDATE "ChecklistAvant" SET "serviceId" = '38f39d38-152e-495b-8c48-28937750d9eb' WHERE "serviceId" IS NULL;

ALTER TABLE "Prescription" ALTER COLUMN "serviceId" SET NOT NULL;
ALTER TABLE "RendezVous" ALTER COLUMN "serviceId" SET NOT NULL;
ALTER TABLE "Salle" ALTER COLUMN "serviceId" SET NOT NULL;
ALTER TABLE "DossierCPA" ALTER COLUMN "serviceId" SET NOT NULL;
ALTER TABLE "ChecklistAvant" ALTER COLUMN "serviceId" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "Prescription_serviceId_idx" ON "Prescription"("serviceId");
CREATE INDEX IF NOT EXISTS "RendezVous_serviceId_idx" ON "RendezVous"("serviceId");
CREATE INDEX IF NOT EXISTS "Salle_serviceId_idx" ON "Salle"("serviceId");
CREATE INDEX IF NOT EXISTS "DossierCPA_serviceId_idx" ON "DossierCPA"("serviceId");
CREATE INDEX IF NOT EXISTS "ChecklistAvant_serviceId_idx" ON "ChecklistAvant"("serviceId");
