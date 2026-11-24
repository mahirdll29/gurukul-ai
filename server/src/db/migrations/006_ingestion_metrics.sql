ALTER TABLE ingestion_jobs ADD COLUMN IF NOT EXISTS duration_ms bigint;
ALTER TABLE ingestion_jobs ADD COLUMN IF NOT EXISTS lease_recoveries int NOT NULL DEFAULT 0;
