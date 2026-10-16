import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import authRoutes from './routes/auth-routes.js';
import quizRoutes from './routes/quiz-routes.js';
import historyRoutes from './routes/history-routes.js';
import leaderboardRoutes from './routes/leaderboard-routes.js';
import { env } from './config/env.js';
import { HttpError } from './utils/http-error.js';

export const app = express();
app.disable('x-powered-by');
if (env.TRUST_PROXY) app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({ origin: env.CLIENT_ORIGIN, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization'] }));
app.use(express.json({ limit: '32kb' }));
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: { message: 'Too many authentication attempts. Try again later.' } } });
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/quizzes', quizRoutes);
app.use('/api/history', historyRoutes);
app.use('/api/leaderboards', leaderboardRoutes);
app.use((_req, _res, next) => next(new HttpError(404, 'Endpoint not found.')));
app.use((error, _req, res, _next) => {
  if (error.type === 'entity.parse.failed') return res.status(400).json({ error: { message: 'Request body must be valid JSON.' } });
  const status = error.status ?? 500;
  if (status >= 500) console.error(error);
  return res.status(status).json({ error: { message: status >= 500 ? 'Something went wrong.' : error.message } });
});
