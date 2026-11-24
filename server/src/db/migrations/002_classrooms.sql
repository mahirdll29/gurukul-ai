ALTER TABLE orgs ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '';
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS join_code text;
UPDATE orgs
SET join_code = upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 10))
WHERE join_code IS NULL;
ALTER TABLE orgs ALTER COLUMN join_code SET DEFAULT upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 10));
ALTER TABLE orgs ALTER COLUMN join_code SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS orgs_join_code_idx ON orgs(join_code);

ALTER TABLE files ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'classroom';
DO $$ BEGIN
  ALTER TABLE files ADD CONSTRAINT files_visibility_check CHECK(visibility IN ('classroom','selected'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS file_shares (
  file_id uuid NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shared_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(file_id,user_id)
);
CREATE INDEX IF NOT EXISTS file_shares_user_idx ON file_shares(user_id,file_id);
