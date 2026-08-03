-- Migration: Ajouter snapshot du patient au moment du résultat (audit + RGPD)
-- Date: 26 juillet 2026

-- Ajouter colonnes de snapshot patient à ResultatEndoscopie
ALTER TABLE "ResultatEndoscopie"
ADD COLUMN IF NOT EXISTS "patientIdAtCreation" TEXT,
ADD COLUMN IF NOT EXISTS "patientNomAtCreation" TEXT,
ADD COLUMN IF NOT EXISTS "patientPrenomAtCreation" TEXT,
ADD COLUMN IF NOT EXISTS "patientDataSnapshot" JSONB;

-- Créer index pour requêtes audit
CREATE INDEX IF NOT EXISTS "ResultatEndoscopie_patientIdAtCreation_idx"
ON "ResultatEndoscopie"("patientIdAtCreation");

-- Remplir les snapshots pour les résultats existants (avec les données actuelles)
UPDATE "ResultatEndoscopie" r
SET
  "patientIdAtCreation" = r."patientId",
  "patientDataSnapshot" = jsonb_build_object(
    'patientId', r."patientId",
    'dateCreation', r."dateCreation"
  )
WHERE "patientIdAtCreation" IS NULL;
