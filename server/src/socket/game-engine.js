import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { pool } from '../db/pool.js';

const games = new Map();
const PIN_PATTERN = /^\d{6}$/;
const TOKEN_PATTERN = /^[\w-]{32,80}$/;

class GameError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function fail(code, message) { throw new GameError(code, message); }
function pinFrom(input) {
  const pin = String(input ?? '').trim();
  if (!PIN_PATTERN.test(pin)) fail('INVALID_PIN', 'Enter a valid 6-digit game PIN.');
  return pin;
}
function hostFor(socket) {
  if (!socket.data.host) fail('AUTH_REQUIRED', 'Log in as a host to do that.');
  return socket.data.host;
}
function gameForHost(socket, value) {
  const host = hostFor(socket);
  const room = games.get(pinFrom(value));
  if (!room) fail('GAME_NOT_FOUND', 'That game is no longer available.');
  if (String(room.hostId) !== String(host.id)) fail('NOT_GAME_HOST', 'Only this game’s host can do that.');
  if (room.hostSocketId !== socket.id) fail('HOST_SESSION_REPLACED', 'This host session was replaced by another connection.');
  return room;
}
function publicPlayers(room) {
  return [...room.players.values()].filter((player) => !player.kicked).map(({ id, nickname, connected }) => ({ id, nickname, connected }));
}
function emitPlayers(io, room) { io.to(room.pin).emit('lobby:players', { pin: room.pin, players: publicPlayers(room) }); }
function roomByPlayerToken(room, token) {
  if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) return null;
  const playerId = room.playersByToken.get(token);
  return playerId ? room.players.get(playerId) ?? null : null;
}
function rankOf(room, player) {
  const sorted = leaderboard(room);
  return sorted.findIndex((entry) => entry.playerId === player.id) + 1;
}
function leaderboard(room) {
  const sorted = [...room.players.values()].filter((player) => !player.kicked)
    .sort((a, b) => b.score - a.score || a.joinedAt - b.joinedAt || a.nickname.localeCompare(b.nickname));
  let lastScore = null;
  let lastRank = 0;
  return sorted.map((player, index) => {
    const rank = player.score === lastScore ? lastRank : index + 1;
    lastScore = player.score;
    lastRank = rank;
    return { playerId: player.id, nickname: player.nickname, score: player.score, rank };
  });
}
function finalStats(room, player) {
  const standing = leaderboard(room).find((entry) => entry.playerId === player.id);
  return {
    pin: room.pin,
    finalRank: standing?.rank ?? null,
    finalScore: player.score,
    correctCount: player.correctCount,
    answeredCount: player.answeredCount,
    accuracy: player.answeredCount ? Math.round((player.correctCount / player.answeredCount) * 100) : 0,
    bestStreak: player.bestStreak,
  };
}
function questionForPlayers(room) {
  const question = room.questions[room.questionIndex];
  return {
    pin: room.pin,
    questionNumber: room.questionIndex + 1,
    totalQuestions: room.questions.length,
    text: question.text,
    options: question.options,
    timeLimitSeconds: question.timeLimitSeconds,
    pointsMode: question.pointsMode,
    playerCount: publicPlayers(room).length,
    endsAt: room.endsAt,
  };
}
function playerResult(room, player) {
  const answer = player.currentAnswer;
  return {
    pin: room.pin,
    questionNumber: room.questionIndex + 1,
    correct: Boolean(answer?.correct),
    noAnswer: !answer?.answered,
    pointsEarned: answer?.pointsEarned ?? 0,
    streakBonus: answer?.streakBonus ?? 0,
    totalScore: player.score,
    currentRank: rankOf(room, player),
    currentStreak: player.streak,
  };
}
function hostSnapshot(room) {
  return {
    pin: room.pin,
    quizTitle: room.quizTitle,
    status: room.status,
    endReason: room.endReason ?? null,
    players: publicPlayers(room),
    question: room.status === 'question' || room.status === 'results' ? questionForPlayers(room) : null,
    results: room.status === 'results' ? room.lastResults : null,
    leaderboard: room.status === 'results' || room.status === 'ended' ? leaderboard(room) : null,
  };
}

async function loadQuizForHost(hostId, quizId) {
  const { rows: [quiz] } = await pool.query(
    `SELECT id, title FROM quizzes WHERE id = $1 AND host_id = $2 AND deleted_at IS NULL`,
    [quizId, hostId],
  );
  if (!quiz) fail('QUIZ_NOT_FOUND', 'Choose one of your active quizzes.');
  const { rows: questions } = await pool.query(
    `SELECT text, options, correct_option AS "correctOption", time_limit_seconds AS "timeLimitSeconds", points_mode AS "pointsMode"
     FROM questions WHERE quiz_id = $1 ORDER BY position`,
    [quizId],
  );
  if (!questions.length) fail('QUIZ_EMPTY', 'Add at least one question before starting a game.');
  return { quiz, questions };
}

async function createPersistentGame(hostId, quizId, quiz, questions) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const pin = String(randomInt(100000, 1000000));
    try {
      const { rows: [game] } = await pool.query(
        `INSERT INTO games (pin, quiz_id, host_id, quiz_snapshot)
         VALUES ($1, $2, $3, $4::jsonb) RETURNING id`,
        [pin, quizId, hostId, JSON.stringify({ title: quiz.title, questions: questions.map((question, index) => ({
          position: index + 1, text: question.text, options: question.options,
          correctOption: question.correctOption, timeLimitSeconds: question.timeLimitSeconds, pointsMode: question.pointsMode,
        })) })],
      );
      return { pin, id: game.id };
    } catch (error) {
      if (error.code !== '23505') throw error;
    }
  }
  fail('PIN_UNAVAILABLE', 'Could not reserve a game PIN. Please try again.');
}

async function persistGameResults(room) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE games SET ended_at = now() WHERE id = $1', [room.id]);
    for (const result of leaderboard(room)) {
      const player = room.players.get(result.playerId);
      await client.query(
        `INSERT INTO game_results (game_id, nickname, final_score, rank, correct_count, answered_count, best_streak, question_stats)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
         ON CONFLICT (game_id, nickname) DO UPDATE SET final_score = EXCLUDED.final_score, rank = EXCLUDED.rank,
           correct_count = EXCLUDED.correct_count, answered_count = EXCLUDED.answered_count,
           best_streak = EXCLUDED.best_streak, question_stats = EXCLUDED.question_stats`,
        [room.id, player.nickname, player.score, result.rank, player.correctCount, player.answeredCount,
          player.bestStreak, JSON.stringify(player.questionStats)],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

async function endGame(io, room, reason) {
  if (room.status === 'ended') return;
  clearTimeout(room.questionTimer);
  room.status = 'ended';
  room.endReason = reason;
  room.endedAt = Date.now();
  const results = leaderboard(room);
  io.to(room.pin).emit('game:end', { pin: room.pin, reason, leaderboard: results });
  for (const player of room.players.values()) {
    if (!player.kicked && player.socketId) io.to(player.socketId).emit('player:game-summary', finalStats(room, player));
  }
  try {
    await persistGameResults(room);
  } catch (error) {
    console.error(`Could not persist results for game ${room.pin}:`, error);
    io.to(room.hostSocketId).emit('game:error', { event: 'game:end', code: 'RESULTS_NOT_SAVED', message: 'The game ended, but results could not be saved.' });
  }
  room.cleanupTimer = setTimeout(() => games.delete(room.pin), 30 * 60 * 1000);
  room.cleanupTimer.unref?.();
}

function answerDistribution(room) {
  const counts = Array(room.questions[room.questionIndex].options.length).fill(0);
  let answered = 0;
  for (const player of room.players.values()) {
    if (player.kicked || !player.currentAnswer?.answered) continue;
    answered += 1;
    counts[player.currentAnswer.optionIndex] += 1;
  }
  return { counts, answered };
}

function finishQuestion(io, room) {
  if (room.status !== 'question') return;
  clearTimeout(room.questionTimer);
  const question = room.questions[room.questionIndex];
  for (const player of room.players.values()) {
    if (player.kicked) continue;
    if (!player.currentAnswer) {
      player.streak = 0;
      player.currentAnswer = { answered: false, correct: false, optionIndex: null, pointsEarned: 0, streakBonus: 0 };
      player.questionStats.push({ questionNumber: room.questionIndex + 1, answered: false, correct: false, pointsEarned: 0 });
    }
  }
  const distribution = answerDistribution(room);
  room.status = 'results';
  room.lastResults = {
    pin: room.pin,
    questionNumber: room.questionIndex + 1,
    totalQuestions: room.questions.length,
    text: question.text,
    options: question.options,
    correctOption: question.correctOption,
    answerCounts: distribution.counts,
    answeredCount: distribution.answered,
    playerCount: publicPlayers(room).length,
  };
  io.to(room.pin).emit('game:question-results', room.lastResults);
  for (const player of room.players.values()) {
    if (!player.kicked && player.socketId) io.to(player.socketId).emit('player:answer-result', playerResult(room, player));
  }
  io.to(room.pin).emit('game:leaderboard', { pin: room.pin, leaderboard: leaderboard(room) });
}

function beginQuestion(io, room) {
  room.status = 'question';
  room.questionIndex += 1;
  room.questionStartedAt = Date.now();
  const question = room.questions[room.questionIndex];
  room.endsAt = room.questionStartedAt + question.timeLimitSeconds * 1000;
  room.lastResults = null;
  for (const player of room.players.values()) player.currentAnswer = null;
  io.to(room.pin).emit('game:question', questionForPlayers(room));
  room.questionTimer = setTimeout(() => finishQuestion(io, room), question.timeLimitSeconds * 1000);
}

function stateForPlayer(io, socket, room, player) {
  socket.join(room.pin);
  player.socketId = socket.id;
  player.connected = true;
  socket.emit('player:joined', { pin: room.pin, playerId: player.id, nickname: player.nickname, playerToken: player.token, reconnected: true });
  emitPlayers(io, room);
  if (room.status === 'lobby') {
    socket.emit('player:lobby-state', { pin: room.pin, players: publicPlayers(room) });
  } else if (room.status === 'question') {
    if (player.currentAnswer) socket.emit('player:answer-accepted', { alreadyAnswered: true });
    else socket.emit('game:question', questionForPlayers(room));
  } else if (room.status === 'results') {
    socket.emit('game:question-results', room.lastResults);
    socket.emit('player:answer-result', playerResult(room, player));
    socket.emit('game:leaderboard', { pin: room.pin, leaderboard: leaderboard(room) });
  } else if (room.status === 'ended') {
    socket.emit('game:end', { pin: room.pin, reason: room.endReason ?? 'completed', leaderboard: leaderboard(room) });
    socket.emit('player:game-summary', finalStats(room, player));
  }
}

export function attachGameEngine(io) {
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next();
    try {
      const payload = jwt.verify(token, env.JWT_SECRET, { issuer: 'quizblitz-api' });
      socket.data.host = { id: payload.sub, email: payload.email, displayName: payload.name };
      return next();
    } catch {
      return next(new Error('Host session is invalid or expired.'));
    }
  });

  io.on('connection', (socket) => {
    const listen = (event, handler) => socket.on(event, (payload = {}) => {
      Promise.resolve().then(() => handler(payload)).catch((error) => {
        socket.emit('game:error', {
          event,
          code: error.code ?? 'SERVER_ERROR',
          message: error instanceof GameError ? error.message : 'The game could not process that action.',
        });
        if (!(error instanceof GameError)) console.error(`Socket event ${event} failed:`, error);
      });
    });

    listen('host:create-game', async ({ quizId }) => {
      const host = hostFor(socket);
      const id = Number(quizId);
      if (!Number.isSafeInteger(id) || id < 1) fail('INVALID_QUIZ', 'Choose a valid quiz.');
      const { quiz, questions } = await loadQuizForHost(host.id, id);
      const record = await createPersistentGame(host.id, id, quiz, questions);
      const room = {
        ...record, hostId: host.id, hostSocketId: socket.id, hostConnected: true,
        quizId: id, quizTitle: quiz.title, questions, players: new Map(), playersByToken: new Map(),
        status: 'lobby', questionIndex: -1, questionTimer: null, cleanupTimer: null,
        createdAt: Date.now(), lastResults: null,
      };
      games.set(room.pin, room);
      socket.join(room.pin);
      socket.emit('host:game-created', hostSnapshot(room));
    });

    listen('host:resume-game', ({ pin: value }) => {
      const host = hostFor(socket);
      const room = games.get(pinFrom(value));
      if (!room) fail('GAME_NOT_FOUND', 'That game can no longer be resumed.');
      if (String(room.hostId) !== String(host.id)) fail('NOT_GAME_HOST', 'That game belongs to another host.');
      if (room.status !== 'ended') clearTimeout(room.cleanupTimer);
      room.hostSocketId = socket.id;
      room.hostConnected = true;
      socket.join(room.pin);
      socket.emit('host:game-state', hostSnapshot(room));
      io.to(room.pin).emit('host:connection', { connected: true });
      emitPlayers(io, room);
    });

    listen('player:join', ({ pin: value, nickname: rawNickname, playerToken }) => {
      const pin = pinFrom(value);
      const room = games.get(pin);
      if (!room) fail('GAME_NOT_FOUND', 'We couldn’t find that game. Check the PIN and try again.');
      const existing = roomByPlayerToken(room, playerToken);
      if (existing && !existing.kicked) return stateForPlayer(io, socket, room, existing);
      if (room.status !== 'lobby') fail('GAME_ALREADY_STARTED', 'This game has already started.');
      const nickname = typeof rawNickname === 'string' ? rawNickname.trim().replace(/\s+/g, ' ').replace(/\p{Cf}/gu, '') : '';
      if (!nickname) fail('INVALID_NICKNAME', 'Enter a nickname to join.');
      if (nickname.length > 20) fail('INVALID_NICKNAME', 'Nicknames can be up to 20 characters.');
      if (/[\u0000-\u001f\u007f]/.test(nickname)) fail('INVALID_NICKNAME', 'That nickname contains unsupported characters.');
      if ([...room.players.values()].some((player) => !player.kicked && player.nickname.toLocaleLowerCase() === nickname.toLocaleLowerCase())) {
        fail('DUPLICATE_NICKNAME', 'That nickname is already in the lobby. Try another one.');
      }
      const token = randomBytes(32).toString('base64url');
      const player = {
        id: randomUUID(), token, nickname, socketId: socket.id, connected: true, kicked: false,
        score: 0, streak: 0, bestStreak: 0, correctCount: 0, answeredCount: 0,
        questionStats: [], currentAnswer: null, joinedAt: Date.now(),
      };
      room.players.set(player.id, player);
      room.playersByToken.set(token, player.id);
      socket.join(pin);
      socket.emit('player:joined', { pin, playerId: player.id, nickname, playerToken: token, reconnected: false });
      socket.emit('player:lobby-state', { pin, players: publicPlayers(room) });
      emitPlayers(io, room);
    });

    listen('host:start', async ({ pin: value }) => {
      const room = gameForHost(socket, value);
      if (room.status !== 'lobby') fail('GAME_NOT_IN_LOBBY', 'This game has already started.');
      if (publicPlayers(room).length === 0) fail('NO_PLAYERS', 'Wait for at least one player before starting.');
      room.status = 'starting';
      try {
        await pool.query('UPDATE games SET started_at = now() WHERE id = $1', [room.id]);
      } catch (error) {
        room.status = 'lobby';
        throw error;
      }
      io.to(room.pin).emit('game:started', { pin: room.pin, quizTitle: room.quizTitle, totalQuestions: room.questions.length });
      beginQuestion(io, room);
    });

    listen('player:answer', ({ pin: value, playerToken, optionIndex }) => {
      const room = games.get(pinFrom(value));
      if (!room) fail('GAME_NOT_FOUND', 'That game is no longer available.');
      const player = roomByPlayerToken(room, playerToken);
      if (!player || player.kicked || player.socketId !== socket.id) fail('PLAYER_SESSION_INVALID', 'Rejoin the game before answering.');
      if (room.status !== 'question') fail('QUESTION_CLOSED', 'This question is closed.');
      if (player.currentAnswer) fail('ALREADY_ANSWERED', 'Your answer has already been submitted.');
      if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= room.questions[room.questionIndex].options.length) {
        fail('INVALID_ANSWER', 'Choose one of the available answers.');
      }
      if (Date.now() >= room.endsAt) {
        finishQuestion(io, room);
        fail('TIME_EXPIRED', 'Time is up for this question.');
      }
      const question = room.questions[room.questionIndex];
      const correct = optionIndex === question.correctOption;
      const elapsedRatio = Math.max(0, Math.min(1, (Date.now() - room.questionStartedAt) / (question.timeLimitSeconds * 1000)));
      const base = question.pointsMode === 'none' ? 0 : question.pointsMode === 'double' ? 2000 : 1000;
      let streakBonus = 0;
      let pointsEarned = 0;
      if (correct) {
        player.streak += 1;
        player.bestStreak = Math.max(player.bestStreak, player.streak);
        streakBonus = question.pointsMode === 'none' ? 0 : Math.min((player.streak - 1) * 100, 500);
        pointsEarned = Math.round(base * (1 - elapsedRatio * 0.5)) + streakBonus;
        player.correctCount += 1;
      } else player.streak = 0;
      player.answeredCount += 1;
      player.score += pointsEarned;
      player.currentAnswer = { answered: true, optionIndex, correct, pointsEarned, streakBonus };
      player.questionStats.push({ questionNumber: room.questionIndex + 1, answered: true, correct, pointsEarned });
      socket.emit('player:answer-accepted', { questionNumber: room.questionIndex + 1, waiting: true });
      io.to(room.pin).emit('game:answer-count', { pin: room.pin, answeredCount: answerDistribution(room).answered, playerCount: publicPlayers(room).length });
      if ([...room.players.values()].filter((entry) => !entry.kicked).every((entry) => entry.currentAnswer)) finishQuestion(io, room);
    });

    listen('host:skip', ({ pin: value }) => {
      const room = gameForHost(socket, value);
      if (room.status !== 'question') fail('NO_ACTIVE_QUESTION', 'There is no active question to skip.');
      finishQuestion(io, room);
    });

    listen('host:next', ({ pin: value }) => {
      const room = gameForHost(socket, value);
      if (room.status !== 'results') fail('RESULTS_NOT_READY', 'Wait for question results before continuing.');
      if (room.questionIndex + 1 >= room.questions.length) return endGame(io, room, 'completed');
      beginQuestion(io, room);
    });

    listen('host:end', ({ pin: value }) => endGame(io, gameForHost(socket, value), 'host-ended'));

    listen('host:kick', ({ pin: value, playerId }) => {
      const room = gameForHost(socket, value);
      if (room.status !== 'lobby') fail('KICK_CLOSED', 'Players can only be kicked from the lobby.');
      const player = room.players.get(playerId);
      if (!player || player.kicked) fail('PLAYER_NOT_FOUND', 'That player is no longer in this lobby.');
      player.kicked = true;
      player.connected = false;
      if (player.socketId) {
        io.to(player.socketId).emit('player:kicked', { pin: room.pin, message: 'The host removed you from this game.' });
        io.in(player.socketId).socketsLeave(room.pin);
      }
      room.playersByToken.delete(player.token);
      emitPlayers(io, room);
    });

    listen('player:leave', ({ pin: value, playerToken }) => {
      const room = games.get(pinFrom(value));
      const player = room && roomByPlayerToken(room, playerToken);
      if (!player || player.socketId !== socket.id) return;
      player.connected = false;
      player.socketId = null;
      socket.leave(room.pin);
      emitPlayers(io, room);
    });

    socket.on('disconnect', () => {
      const host = socket.data.host;
      if (host) {
        for (const room of games.values()) {
          if (room.hostSocketId !== socket.id) continue;
          room.hostConnected = false;
          io.to(room.pin).emit('host:connection', { connected: false });
        }
      }
      for (const room of games.values()) {
        for (const player of room.players.values()) {
          if (player.socketId !== socket.id) continue;
          player.socketId = null;
          player.connected = false;
          emitPlayers(io, room);
        }
      }
    });
  });
}

export const __gameEngineInternals = { games, leaderboard };
