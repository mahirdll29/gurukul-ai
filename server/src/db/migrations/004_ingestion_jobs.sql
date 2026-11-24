CREATE TABLE IF NOT EXISTS ingestion_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id uuid NOT NULL REFERENCES file_versions(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed','dead')),
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 5,
  run_after timestamptz NOT NULL DEFAULT now(),
  locked_by text,
  locked_until timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS ingestion_jobs_active_version_idx
  ON ingestion_jobs(version_id) WHERE status IN ('queued','running');
CREATE INDEX IF NOT EXISTS ingestion_jobs_status_run_after_idx ON ingestion_jobs(status,run_after);
INSERT INTO ingestion_jobs(version_id)
SELECT id FROM file_versions WHERE status='processing'
ON CONFLICT DO NOTHING;
DELETE FROM near_duplicate_links a USING near_duplicate_links b
WHERE a.ctid>b.ctid AND a.user_id=b.user_id AND a.version_id=b.version_id AND a.matched_version_id=b.matched_version_id;
CREATE UNIQUE INDEX IF NOT EXISTS near_duplicate_links_pair_unique_idx ON near_duplicate_links(user_id,version_id,matched_version_id);
