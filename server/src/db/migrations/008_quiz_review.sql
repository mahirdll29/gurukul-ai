CREATE TABLE IF NOT EXISTS quiz_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  quiz_file_id uuid NOT NULL REFERENCES files(id),
  answers jsonb NOT NULL,
  score int NOT NULL,
  total int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS quiz_attempts_user_created_idx ON quiz_attempts(user_id,created_at DESC);
CREATE TABLE IF NOT EXISTS review_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  quiz_file_id uuid NOT NULL REFERENCES files(id),
  question_index int NOT NULL,
  box int NOT NULL DEFAULT 1,
  due_at timestamptz NOT NULL,
  last_result boolean,
  times_seen int NOT NULL DEFAULT 0,
  UNIQUE(user_id,quiz_file_id,question_index)
);
CREATE INDEX IF NOT EXISTS review_items_due_idx ON review_items(user_id,due_at);
