CREATE TABLE IF NOT EXISTS users (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  display_name VARCHAR(40) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT users_email_lowercase CHECK (email = lower(email)),
  CONSTRAINT users_email_unique UNIQUE (email)
);

CREATE TABLE IF NOT EXISTS quizzes (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  host_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(120) NOT NULL,
  cover_image_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS questions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  quiz_id BIGINT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position > 0),
  text TEXT NOT NULL,
  options JSONB NOT NULL,
  correct_option INTEGER NOT NULL CHECK (correct_option BETWEEN 0 AND 3),
  time_limit_seconds INTEGER NOT NULL DEFAULT 20 CHECK (time_limit_seconds BETWEEN 5 AND 60),
  points_mode TEXT NOT NULL DEFAULT 'standard' CHECK (points_mode IN ('standard', 'double', 'none')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (quiz_id, position),
  CHECK (jsonb_typeof(options) = 'array' AND jsonb_array_length(options) BETWEEN 2 AND 4),
  CHECK (correct_option < jsonb_array_length(options))
);

CREATE TABLE IF NOT EXISTS games (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pin CHAR(6) NOT NULL UNIQUE CHECK (pin ~ '^[0-9]{6}$'),
  quiz_id BIGINT NOT NULL REFERENCES quizzes(id) ON DELETE RESTRICT,
  host_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS game_results (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  game_id BIGINT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  nickname VARCHAR(32) NOT NULL,
  final_score INTEGER NOT NULL DEFAULT 0 CHECK (final_score >= 0),
  rank INTEGER CHECK (rank > 0),
  correct_count INTEGER NOT NULL DEFAULT 0 CHECK (correct_count >= 0),
  answered_count INTEGER NOT NULL DEFAULT 0 CHECK (answered_count >= 0),
  best_streak INTEGER NOT NULL DEFAULT 0 CHECK (best_streak >= 0),
  question_stats JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (game_id, nickname)
);

CREATE INDEX IF NOT EXISTS quizzes_host_created_idx ON quizzes(host_id, created_at DESC);
CREATE INDEX IF NOT EXISTS games_host_created_idx ON games(host_id, created_at DESC);
CREATE INDEX IF NOT EXISTS games_quiz_idx ON games(quiz_id);
CREATE INDEX IF NOT EXISTS game_results_score_idx ON game_results(final_score DESC);
