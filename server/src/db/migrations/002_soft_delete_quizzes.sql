ALTER TABLE quizzes ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS quizzes_active_host_updated_idx
  ON quizzes(host_id, updated_at DESC) WHERE deleted_at IS NULL;
