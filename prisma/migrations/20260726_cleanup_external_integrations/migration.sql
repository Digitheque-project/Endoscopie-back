-- Clean up unused external service integrations
-- Removes ResultatExterne table (orphaned data from external services)
-- Date: 2026-07-26

DROP TABLE IF EXISTS "ResultatExterne" CASCADE;
