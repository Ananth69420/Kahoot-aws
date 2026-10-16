import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/require-auth.js';
import * as controller from '../controllers/quiz-controller.js';
import { HttpError } from '../utils/http-error.js';

const router = Router();
const questionSchema = z.object({
  text: z.string().trim().min(1).max(300),
  options: z.array(z.string().trim().min(1).max(120)).min(2).max(4),
  correctOption: z.number().int().min(0).max(3),
  timeLimitSeconds: z.number().int().min(5).max(60).default(20),
  pointsMode: z.enum(['standard', 'double', 'none']).default('standard'),
}).strict().superRefine((question, ctx) => {
  if (question.correctOption >= question.options.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['correctOption'], message: 'Choose one of the available answers.' });
  }
  const normalizedOptions = question.options.map((option) => option.toLocaleLowerCase());
  if (new Set(normalizedOptions).size !== normalizedOptions.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['options'], message: 'Answer options must be unique.' });
  }
});
const quizSchema = z.object({
  title: z.string().trim().min(1).max(120),
  coverImageUrl: z.union([
    z.string().trim().url().max(2048).refine((url) => /^https?:\/\//i.test(url), 'Cover image must use HTTP or HTTPS.'),
    z.literal(''), z.null(),
  ]).optional().transform((url) => url || null),
  questions: z.array(questionSchema).min(1).max(50),
}).strict();
const idSchema = z.string().regex(/^\d+$/).transform(Number).refine((id) => Number.isSafeInteger(id) && id > 0);

const validateBody = (req, _res, next) => {
  const result = quizSchema.safeParse(req.body);
  if (!result.success) {
    return next(new HttpError(400, result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')));
  }
  req.body = result.data;
  return next();
};
const validateId = (req, _res, next) => {
  const result = idSchema.safeParse(req.params.quizId);
  if (!result.success) return next(new HttpError(400, 'Quiz id must be a positive integer.'));
  req.params.quizId = result.data;
  return next();
};

router.use(requireAuth);
router.get('/', controller.list);
router.post('/', validateBody, controller.create);
router.get('/:quizId', validateId, controller.get);
router.put('/:quizId', validateId, validateBody, controller.update);
router.delete('/:quizId', validateId, controller.remove);

export default router;
