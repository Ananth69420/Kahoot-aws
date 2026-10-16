import { Router } from 'express';
import { requireAuth } from '../middleware/require-auth.js';
import { asyncHandler } from '../utils/async-handler.js';
import { getHistoryDetail, listHistory } from '../controllers/history-controller.js';

const router = Router();
router.use(requireAuth);
router.get('/', asyncHandler(listHistory));
router.get('/:gameId', asyncHandler(getHistoryDetail));
export default router;
