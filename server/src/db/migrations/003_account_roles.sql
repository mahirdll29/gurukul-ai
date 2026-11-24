ALTER TABLE users ADD COLUMN IF NOT EXISTS account_role text NOT NULL DEFAULT 'student';
DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT users_account_role_check CHECK(account_role IN ('student','professor'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
UPDATE users u SET account_role='professor'
WHERE EXISTS (SELECT 1 FROM memberships m WHERE m.user_id=u.id AND m.role='faculty');
