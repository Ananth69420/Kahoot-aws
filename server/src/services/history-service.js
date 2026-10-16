import { pool } from '../db/pool.js';

export async function listHostGames(hostId) {
  const { rows } = await pool.query(
    `SELECT g.id, g.pin, g.started_at AS "startedAt", g.ended_at AS "endedAt",
            q.title AS "quizTitle", count(DISTINCT r.id)::int AS "playerCount",
            max(r.final_score)::int AS "topScore"
     FROM games g
     JOIN quizzes q ON q.id = g.quiz_id
     LEFT JOIN game_results r ON r.game_id = g.id
     WHERE g.host_id = $1 AND g.ended_at IS NOT NULL
     GROUP BY g.id, q.title
     ORDER BY g.ended_at DESC, g.id DESC`,
    [hostId],
  );
  return rows;
}

export async function getHostGame(hostId, gameId) {
  const { rows: [game] } = await pool.query(
    `SELECT g.id, g.pin, g.started_at AS "startedAt", g.ended_at AS "endedAt",
            COALESCE(g.quiz_snapshot->>'title', q.title) AS "quizTitle",
            g.quiz_snapshot AS "quizSnapshot", u.display_name AS "hostName"
     FROM games g
     JOIN quizzes q ON q.id = g.quiz_id
     JOIN users u ON u.id = g.host_id
     WHERE g.id = $1 AND g.host_id = $2 AND g.ended_at IS NOT NULL`,
    [gameId, hostId],
  );
  if (!game) return null;

  const [{ rows: leaderboard }, { rows: questions }] = await Promise.all([
    pool.query(
      `SELECT nickname, final_score AS "finalScore", rank,
              correct_count AS "correctCount", answered_count AS "answeredCount",
              best_streak AS "bestStreak", question_stats AS "questionStats"
       FROM game_results WHERE game_id = $1 ORDER BY rank ASC, final_score DESC, nickname ASC`,
      [gameId],
    ),
    game.quizSnapshot?.questions
      ? Promise.resolve({ rows: game.quizSnapshot.questions.map((question) => ({ questionNumber: question.position, text: question.text, options: question.options })) })
      : pool.query(
        `SELECT position AS "questionNumber", text, options
         FROM questions q JOIN games g ON g.quiz_id = q.quiz_id
         WHERE g.id = $1 ORDER BY position`,
        [gameId],
      ),
  ]);
  const summary = questions.map((question) => {
    let answeredCount = 0;
    let correctCount = 0;
    for (const player of leaderboard) {
      const stat = player.questionStats?.find((entry) => entry.questionNumber === question.questionNumber);
      if (stat?.answered) answeredCount += 1;
      if (stat?.correct) correctCount += 1;
    }
    return {
      questionNumber: question.questionNumber,
      text: question.text,
      options: question.options,
      playerCount: leaderboard.length,
      answeredCount,
      correctCount,
      accuracy: answeredCount ? Math.round((correctCount / answeredCount) * 100) : 0,
    };
  });
  const players = leaderboard.map(({ questionStats, ...player }) => ({
    ...player,
    accuracy: player.answeredCount ? Math.round((player.correctCount / player.answeredCount) * 100) : 0,
  }));
  const { quizSnapshot, ...publicGame } = game;
  return { game: { ...publicGame, playerCount: players.length }, leaderboard: players, questions: summary };
}

export async function getHallOfFame(limit = 50) {
  const { rows } = await pool.query(
    `SELECT r.nickname, r.final_score AS "finalScore", r.rank,
            r.correct_count AS "correctCount", r.answered_count AS "answeredCount",
            r.best_streak AS "bestStreak", q.title AS "quizTitle", g.ended_at AS "endedAt"
     FROM game_results r
     JOIN games g ON g.id = r.game_id
     JOIN quizzes q ON q.id = g.quiz_id
     WHERE g.ended_at IS NOT NULL
     ORDER BY r.final_score DESC, g.ended_at DESC, r.nickname ASC
     LIMIT $1`,
    [limit],
  );
  return rows.map((row) => ({
    ...row,
    accuracy: row.answeredCount ? Math.round((row.correctCount / row.answeredCount) * 100) : 0,
  }));
}
