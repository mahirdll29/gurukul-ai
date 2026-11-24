ALTER TABLE units ADD COLUMN IF NOT EXISTS tsv tsvector GENERATED ALWAYS AS (to_tsvector('english',coalesce(text,''))) STORED;
CREATE INDEX IF NOT EXISTS units_tsv_gin_idx ON units USING GIN(tsv);
