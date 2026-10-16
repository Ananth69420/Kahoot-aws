import { Router } from 'express';
import { z } from 'zod';
import { login, me, signup } from '../controllers/auth-controller.js';
import { requireAuth } from '../middleware/require-auth.js';
import { HttpError } from '../utils/http-error.js';

const router = Router();
const signupSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(10).max(72),
  displayName: z.string().trim().min(2).max(40),
}).strict();
const loginSchema = z.object({ email: z.string().trim().email().max(254), password: z.string().min(1).max(72) }).strict();

const validate = (schema) => (req, _res, next) => {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    return next(new HttpError(400, result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')));
  }
  req.body = result.data;
  return next();
};

router.post('/signup', validate(signupSchema), signup);
router.post('/login', validate(loginSchema), login);
router.get('/me', requireAuth, me);

export default router;
