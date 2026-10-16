import { Router } from 'express';
import { asyncHandler } from '../utils/async-handler.js';
import { hallOfFame } from '../controllers/history-controller.js';

const router = Router();
router.get('/hall-of-fame', asyncHandler(hallOfFame));
export default router;
