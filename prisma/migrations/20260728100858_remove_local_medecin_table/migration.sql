-- Les médecins ne sont plus dupliqués localement : ils sont désormais lus en direct
-- depuis le service auth centralisé (voir src/services/medecins.service.ts). Les colonnes
-- medecinId/anesthesisteId restent en place (elles référencent l'ID utilisateur du service
-- auth), seules la contrainte de clé étrangère locale et la table miroir sont supprimées.

ALTER TABLE "Prescription" DROP CONSTRAINT IF EXISTS "Prescription_medecinId_fkey";
ALTER TABLE "RendezVous" DROP CONSTRAINT IF EXISTS "RendezVous_medecinId_fkey";
ALTER TABLE "DossierCPA" DROP CONSTRAINT IF EXISTS "DossierCPA_anesthesisteId_fkey";

DROP TABLE IF EXISTS "Medecin";
