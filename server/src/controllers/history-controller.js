import { HttpError } from '../utils/http-error.js';
import { getHallOfFame, getHostGame, listHostGames } from '../services/history-service.js';

export async function listHistory(req, res) {
  res.json({ games: await listHostGames(req.user.id) });
}

export async function getHistoryDetail(req, res) {
  const id = Number(req.params.gameId);
  if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(400, 'Enter a valid game ID.');
  const result = await getHostGame(req.user.id, id);
  if (!result) throw new HttpError(404, 'That game could not be found in your history.');
  res.json(result);
}

export async function hallOfFame(_req, res) {
  res.json({ entries: await getHallOfFame() });
}
