import * as quizService from '../services/quiz-service.js';
import { asyncHandler } from '../utils/async-handler.js';

export const list = asyncHandler(async (req, res) => {
  res.json({ quizzes: await quizService.listForHost(req.user.id) });
});

export const get = asyncHandler(async (req, res) => {
  res.json({ quiz: await quizService.getForHost(req.user.id, req.params.quizId) });
});

export const create = asyncHandler(async (req, res) => {
  res.status(201).json({ quiz: await quizService.create(req.user.id, req.body) });
});

export const update = asyncHandler(async (req, res) => {
  res.json({ quiz: await quizService.update(req.user.id, req.params.quizId, req.body) });
});

export const remove = asyncHandler(async (req, res) => {
  await quizService.remove(req.user.id, req.params.quizId);
  res.status(204).end();
});
