import { pool } from '../db/pool.js';
import { HttpError } from '../utils/http-error.js';

const quizColumns = `q.id, q.title, q.cover_image_url AS "coverImageUrl",
  q.created_at AS "createdAt", q.updated_at AS "updatedAt",
  COUNT(question.id)::int AS "questionCount"`;

export async function listForHost(hostId) {
  const { rows } = await pool.query(
    `SELECT ${quizColumns} FROM quizzes q
     LEFT JOIN questions question ON question.quiz_id = q.id
     WHERE q.host_id = $1 AND q.deleted_at IS NULL
     GROUP BY q.id ORDER BY q.updated_at DESC, q.id DESC`,
    [hostId],
  );
  return rows;
}

export async function getForHost(hostId, quizId) {
  const { rows: [quiz] } = await pool.query(
    `SELECT ${quizColumns} FROM quizzes q
     LEFT JOIN questions question ON question.quiz_id = q.id
     WHERE q.host_id = $1 AND q.id = $2 AND q.deleted_at IS NULL GROUP BY q.id`,
    [hostId, quizId],
  );
  if (!quiz) throw new HttpError(404, 'Quiz not found.');
  const { rows: questions } = await pool.query(
    `SELECT id, position, text, options, correct_option AS "correctOption",
      time_limit_seconds AS "timeLimitSeconds", points_mode AS "pointsMode"
     FROM questions WHERE quiz_id = $1 ORDER BY position`,
    [quizId],
  );
  return { ...quiz, questions };
}

async function saveQuestions(client, quizId, questions) {
  for (const [index, question] of questions.entries()) {
    await client.query(
      `INSERT INTO questions (quiz_id, position, text, options, correct_option, time_limit_seconds, points_mode)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)`,
      [quizId, index + 1, question.text, JSON.stringify(question.options), question.correctOption,
        question.timeLimitSeconds, question.pointsMode],
    );
  }
}

export async function create(hostId, input) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [quiz] } = await client.query(
      `INSERT INTO quizzes (host_id, title, cover_image_url) VALUES ($1, $2, $3)
       RETURNING id, title, cover_image_url AS "coverImageUrl", created_at AS "createdAt", updated_at AS "updatedAt"`,
      [hostId, input.title, input.coverImageUrl ?? null],
    );
    await saveQuestions(client, quiz.id, input.questions);
    await client.query('COMMIT');
    return { ...quiz, questionCount: input.questions.length };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function update(hostId, quizId, input) {
  const client = await pool.connect();
  let committed = false;
  try {
    await client.query('BEGIN');
    const { rowCount } = await client.query(
      `UPDATE quizzes SET title = $1, cover_image_url = $2, updated_at = now()
       WHERE id = $3 AND host_id = $4 AND deleted_at IS NULL`,
      [input.title, input.coverImageUrl ?? null, quizId, hostId],
    );
    if (!rowCount) throw new HttpError(404, 'Quiz not found.');
    await client.query('DELETE FROM questions WHERE quiz_id = $1', [quizId]);
    await saveQuestions(client, quizId, input.questions);
    await client.query('COMMIT');
    committed = true;
  } catch (error) {
    if (!committed) await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  return getForHost(hostId, quizId);
}

export async function remove(hostId, quizId) {
  const { rowCount } = await pool.query(
    `UPDATE quizzes SET deleted_at = now(), updated_at = now()
     WHERE id = $1 AND host_id = $2 AND deleted_at IS NULL`,
    [quizId, hostId],
  );
  if (!rowCount) throw new HttpError(404, 'Quiz not found.');
}
