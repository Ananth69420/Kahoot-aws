import bcrypt from 'bcrypt';
import { env } from '../config/env.js';
import { pool } from './pool.js';

const email = process.env.SEED_EMAIL?.trim().toLowerCase();
const password = process.env.SEED_PASSWORD;
const displayName = process.env.SEED_DISPLAY_NAME?.trim() || 'QuizBlitz Demo Host';

const sampleQuizzes = [
  {
    title: 'Campus Brain Break',
    questions: [
      { text: 'Which planet is known as the Red Planet?', options: ['Venus', 'Mars', 'Jupiter', 'Mercury'], correctOption: 1, timeLimitSeconds: 20, pointsMode: 'standard' },
      { text: 'What is the chemical symbol for gold?', options: ['Ag', 'Au', 'Go', 'Gd'], correctOption: 1, timeLimitSeconds: 15, pointsMode: 'double' },
      { text: 'How many sides does a hexagon have?', options: ['Five', 'Six', 'Seven', 'Eight'], correctOption: 1, timeLimitSeconds: 15, pointsMode: 'standard' },
    ],
  },
  {
    title: 'Film & Music Mix',
    questions: [
      { text: 'Which instrument has 88 keys?', options: ['Piano', 'Violin', 'Flute', 'Harp'], correctOption: 0, timeLimitSeconds: 20, pointsMode: 'standard' },
      { text: 'Which film features the song “My Heart Will Go On”?', options: ['Moulin Rouge!', 'Titanic', 'The Bodyguard', 'La La Land'], correctOption: 1, timeLimitSeconds: 20, pointsMode: 'double' },
      { text: 'How many strings does a standard guitar have?', options: ['Four', 'Five', 'Six', 'Seven'], correctOption: 2, timeLimitSeconds: 15, pointsMode: 'standard' },
    ],
  },
];

async function seed() {
  if (!email || !password || password.length < 10) {
    throw new Error('Set SEED_EMAIL and a SEED_PASSWORD of at least 10 characters before running the seed command.');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const passwordHash = await bcrypt.hash(password, env.BCRYPT_ROUNDS);
    await client.query(
      `INSERT INTO users (email, password_hash, display_name)
       VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING`,
      [email, passwordHash, displayName],
    );
    const { rows: [user] } = await client.query('SELECT id FROM users WHERE email = $1', [email]);
    for (const sample of sampleQuizzes) {
      const { rows: existing } = await client.query(
        'SELECT id FROM quizzes WHERE host_id = $1 AND title = $2 AND deleted_at IS NULL LIMIT 1',
        [user.id, sample.title],
      );
      if (existing.length) continue;
      const { rows: [quiz] } = await client.query(
        'INSERT INTO quizzes (host_id, title) VALUES ($1, $2) RETURNING id',
        [user.id, sample.title],
      );
      for (const [index, question] of sample.questions.entries()) {
        await client.query(
          `INSERT INTO questions (quiz_id, position, text, options, correct_option, time_limit_seconds, points_mode)
           VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)`,
          [quiz.id, index + 1, question.text, JSON.stringify(question.options), question.correctOption, question.timeLimitSeconds, question.pointsMode],
        );
      }
    }
    await client.query('COMMIT');
    console.log(`Seeded two sample quizzes for ${email}.`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

seed().catch((error) => { console.error('Database seed failed:', error.message); process.exitCode = 1; }).finally(() => pool.end());
