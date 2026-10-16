import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export function requireAuth(req, res, next) {
  const header = req.get('authorization');
  const [scheme, token] = header?.split(' ') ?? [];
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: { message: 'Authentication required.' } });
  }
  try {
    const payload = jwt.verify(token, env.JWT_SECRET, { issuer: 'quizblitz-api' });
    req.user = { id: payload.sub, email: payload.email, displayName: payload.name };
    return next();
  } catch {
    return res.status(401).json({ error: { message: 'Session is invalid or expired.' } });
  }
}
