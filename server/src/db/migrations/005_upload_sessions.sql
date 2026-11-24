CREATE TABLE IF NOT EXISTS upload_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  object_key text NOT NULL UNIQUE,
  declared_sha256 text NOT NULL,
  declared_size bigint NOT NULL,
  filename text NOT NULL,
  params jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','completed','expired','rejected')),
  file_id uuid REFERENCES files(id),
  version_id uuid REFERENCES file_versions(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS upload_sessions_pending_expiry_idx ON upload_sessions(status,expires_at);
CREATE TABLE IF NOT EXISTS upload_metrics (
  id boolean PRIMARY KEY DEFAULT true CHECK(id),
  direct_bytes bigint NOT NULL DEFAULT 0,
  dedup_before_transfer_count bigint NOT NULL DEFAULT 0,
  dedup_before_transfer_bytes bigint NOT NULL DEFAULT 0
);
INSERT INTO upload_metrics(id) VALUES(true) ON CONFLICT DO NOTHING;
