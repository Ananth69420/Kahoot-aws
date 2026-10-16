ALTER TABLE games ADD COLUMN IF NOT EXISTS quiz_snapshot JSONB;

UPDATE games g
SET quiz_snapshot = jsonb_build_object(
  'title', q.title,
  'questions', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'position', question.position,
      'text', question.text,
      'options', question.options,
      'correctOption', question.correct_option,
      'timeLimitSeconds', question.time_limit_seconds,
      'pointsMode', question.points_mode
    ) ORDER BY question.position)
    FROM questions question WHERE question.quiz_id = q.id
  ), '[]'::jsonb)
)
FROM quizzes q
WHERE g.quiz_id = q.id AND g.quiz_snapshot IS NULL;
