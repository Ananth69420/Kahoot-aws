import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { pool } from '../db/pool.js';
import { env } from '../config/env.js';
import { HttpError } from '../utils/http-error.js';

const publicUser = ({ id, email, display_name: displayName }) => ({
  id: String(id), email, displayName,
});

function issueToken(user) {
  return jwt.sign({ email: user.email, name: user.display_name }, env.JWT_SECRET, {
    subject: String(user.id), expiresIn: env.JWT_EXPIRES_IN, issuer: 'quizblitz-api',
  });
}

export async function register({ email, password, displayName }) {
  const normalizedEmail = email.trim().toLowerCase();
  const passwordHash = await bcrypt.hash(password, env.BCRYPT_ROUNDS);
  try {
    const { rows: [user] } = await pool.query(
      `INSERT INTO users (email, password_hash, display_name)
       VALUES ($1, $2, $3) RETURNING id, email, display_name`,
      [normalizedEmail, passwordHash, displayName.trim()],
    );
    return { user: publicUser(user), token: issueToken(user) };
  } catch (error) {
    if (error.code === '23505') throw new HttpError(409, 'An account with this email already exists.');
    throw error;
  }
}

export async function login({ email, password }) {
  const { rows: [user] } = await pool.query(
    'SELECT id, email, password_hash, display_name FROM users WHERE email = $1',
    [email.trim().toLowerCase()],
  );
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    throw new HttpError(401, 'Email or password is incorrect.');
  }
  return { user: publicUser(user), token: issueToken(user) };
}
