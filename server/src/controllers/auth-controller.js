import { asyncHandler } from '../utils/async-handler.js';
import * as authService from '../services/auth-service.js';

export const signup = asyncHandler(async (req, res) => {
  const result = await authService.register(req.body);
  res.status(201).json(result);
});

export const login = asyncHandler(async (req, res) => {
  res.json(await authService.login(req.body));
});

export const me = (req, res) => res.json({ user: req.user });
