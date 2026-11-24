CREATE TABLE IF NOT EXISTS annotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id uuid NOT NULL REFERENCES files(id),
  version_id uuid NOT NULL REFERENCES file_versions(id),
  unit_id uuid REFERENCES units(id),
  locator text NOT NULL,
  anchor_hash text NOT NULL,
  quote text,
  body text NOT NULL,
  visibility text NOT NULL CHECK(visibility IN ('private','class')),
  author_id uuid NOT NULL REFERENCES users(id),
  parent_id uuid REFERENCES annotations(id),
  resolved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS annotations_file_version_idx ON annotations(file_id,version_id);
