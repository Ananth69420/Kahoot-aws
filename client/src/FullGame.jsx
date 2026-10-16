import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';
import { QRCodeSVG } from 'qrcode.react';
import { io } from 'socket.io-client';
import { Link } from 'react-router-dom';
import { apiRequest } from './lib/api.js';
import { useCountdown } from './useCountdown.js';
import { useGameAudio } from './useGameAudio.js';
import ThemeToggle from './ThemeToggle.jsx';
import './full-game.css';

const apiOrigin = (import.meta.env.VITE_API_URL || window.location.origin).replace(/\/$/, '');
const answerColors = ['coral', 'blue', 'gold', 'green'];
const answerShapes = ['◆', '●', '▲', '■'];

function SoundButton({ audio }) {
  return <button className="sound-toggle" type="button" onClick={audio.toggle} aria-label={audio.enabled ? 'Mute game sounds' : 'Turn on game sounds'} aria-pressed={audio.enabled}>
    <span aria-hidden="true">{audio.enabled ? '♫' : '♪̸'}</span><small>{audio.enabled ? 'SOUND ON' : 'SOUND OFF'}</small>
  </button>;
}

function GameHeader({ label, audio, children }) {
  return <header className="game-header"><Link to="/" className="game-brand"><span>✦</span> QUIZBLITZ</Link><div className="game-header-right"><span className="game-context">{label}</span>{children}<ThemeToggle /><SoundButton audio={audio} /></div></header>;
}

function CountdownRing({ endsAt, durationSeconds, large = false, seconds: override }) {
  const timer = useCountdown(endsAt, durationSeconds);
  const seconds = override ?? timer.seconds;
  const progress = override === undefined ? timer.progress : Math.max(0, Math.min(1, override / Math.max(1, durationSeconds)));
  const circumference = 2 * Math.PI * 43;
  const urgent = seconds <= 5;
  return <div className={`countdown ${large ? 'countdown-large' : ''} ${urgent ? 'countdown-urgent' : ''}`} role="timer" aria-label={`${seconds} seconds remaining`}>
    <svg viewBox="0 0 100 100" aria-hidden="true"><circle className="countdown-track" cx="50" cy="50" r="43" /><circle className="countdown-value" cx="50" cy="50" r="43" style={{ strokeDasharray: circumference, strokeDashoffset: circumference * (1 - progress) }} /></svg>
    <strong>{seconds}</strong><span>SEC</span>
  </div>;
}

function AnimatedBars({ results }) {
  const maximum = Math.max(1, ...results.answerCounts);
  return <div className="answer-distribution" aria-label="Answer distribution">
    {results.options.map((option, index) => <motion.div layout className={`distribution-row ${index === results.correctOption ? 'distribution-correct' : ''}`} key={`${results.questionNumber}-${index}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.07 }}>
      <div className="distribution-option"><span className={`shape-dot ${answerColors[index]}`}>{answerShapes[index]}</span><span>{option}</span></div>
      <div className="distribution-track"><motion.div className={`distribution-fill ${answerColors[index]}`} initial={{ width: 0 }} animate={{ width: `${(results.answerCounts[index] / maximum) * 100}%` }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }} /></div>
      <strong>{results.answerCounts[index]}</strong>
    </motion.div>)}
    <p className="distribution-caption">{results.answeredCount} OF {results.playerCount} PLAYERS ANSWERED</p>
  </div>;
}

function Leaderboard({ entries, compact = false }) {
  if (!entries?.length) return <div className="leaderboard-empty">No scores to show yet.</div>;
  return <LayoutGroup><div className={`full-leaderboard ${compact ? 'leaderboard-compact' : ''}`}>
    {entries.map((entry) => <motion.div layout key={entry.playerId} className="leaderboard-row" transition={{ type: 'tween', duration: 0.28, ease: [0.22, 1, 0.36, 1] }}>
      <strong className={`rank-number rank-${entry.rank}`}>{String(entry.rank).padStart(2, '0')}</strong><span className="leaderboard-name">{entry.nickname}</span><span className="leaderboard-score">{entry.score.toLocaleString()} <small>PTS</small></span>
    </motion.div>)}
  </div></LayoutGroup>;
}

function Confetti() {
  const particles = useMemo(() => Array.from({ length: 52 }, (_, index) => ({
    id: index,
    left: `${(index * 47 + 11) % 100}%`,
    delay: (index % 13) * 0.11,
    duration: 3.8 + (index % 7) * 0.35,
    rotate: (index * 73) % 540,
    color: ['#536cf3', '#46bd8b', '#ffcb4b', '#f36b79', '#71cce7'][index % 5],
    size: 5 + (index % 4) * 2,
  })), []);
  return <div className="confetti-layer" aria-hidden="true">{particles.map((particle) => <motion.i key={particle.id} style={{ left: particle.left, width: particle.size, height: particle.size * 1.6, background: particle.color }} initial={{ y: -30, rotate: 0, opacity: 0 }} animate={{ y: '110vh', rotate: particle.rotate, opacity: [0, 1, 1, 0] }} transition={{ duration: particle.duration, delay: particle.delay, ease: 'linear', repeat: Infinity, repeatDelay: 1.7 }} />)}</div>;
}

function Podium({ entries }) {
  const top = entries.slice(0, 3);
  const order = [top[1], top[0], top[2]].filter(Boolean);
  return <div className="podium" aria-label="Top three players">
    {order.map((entry) => <motion.div layout key={entry.playerId} className={`podium-place podium-${entry.rank}`} initial={{ opacity: 0, y: 22 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 + (3 - entry.rank) * 0.14, duration: 0.5 }}>
      <div className="podium-person"><span className="podium-medal">{entry.rank === 1 ? '✦' : entry.rank}</span><strong>{entry.nickname}</strong><small>{entry.score.toLocaleString()} PTS</small></div>
      <div className="podium-block"><b>{entry.rank === 1 ? '1ST' : entry.rank === 2 ? '2ND' : '3RD'}</b></div>
    </motion.div>)}
  </div>;
}

export function HostGame() {
  const [quizzes, setQuizzes] = useState([]);
  const [quizId, setQuizId] = useState('');
  const [game, setGame] = useState(null);
  const [players, setPlayers] = useState([]);
  const [question, setQuestion] = useState(null);
  const [results, setResults] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const [answerCount, setAnswerCount] = useState({ answeredCount: 0, playerCount: 0 });
  const [error, setError] = useState('');
  const [connected, setConnected] = useState(false);
  const socket = useMemo(() => io(apiOrigin, { autoConnect: false, auth: { token: localStorage.getItem('quizblitz-token') } }), []);
  const audio = useGameAudio({ lobby: game?.status === 'lobby' });
  const timer = useCountdown(question?.endsAt, question?.timeLimitSeconds);
  const previousSecond = useRef(null);
  const endedPin = useRef('');

  useEffect(() => {
    let alive = true;
    apiRequest('/api/quizzes').then(({ quizzes: items }) => {
      if (alive) { setQuizzes(items); setQuizId((value) => value || String(items[0]?.id || '')); }
    }).catch((requestError) => alive && setError(requestError.message));
    const onConnect = () => {
      setConnected(true);
      const pin = localStorage.getItem('quizblitz-host-pin');
      if (pin) socket.emit('host:resume-game', { pin });
    };
    const onCreated = (snapshot) => {
      localStorage.setItem('quizblitz-host-pin', snapshot.pin);
      setGame(snapshot); setPlayers(snapshot.players); setQuestion(null); setResults(null); setLeaderboard([]); setError('');
    };
    const onState = (snapshot) => {
      setGame(snapshot); setPlayers(snapshot.players); setQuestion(snapshot.question); setResults(snapshot.results); setLeaderboard(snapshot.leaderboard || []);
      setAnswerCount({ answeredCount: 0, playerCount: snapshot.players.length });
    };
    socket.on('connect', onConnect);
    socket.on('disconnect', () => setConnected(false));
    socket.on('host:game-created', onCreated);
    socket.on('host:game-state', onState);
    socket.on('lobby:players', ({ players: list }) => setPlayers(list));
    socket.on('game:started', () => setGame((current) => current ? { ...current, status: 'question' } : current));
    socket.on('game:question', (payload) => { setQuestion(payload); setResults(null); setAnswerCount({ answeredCount: 0, playerCount: payload.playerCount }); setGame((current) => current ? { ...current, status: 'question' } : current); previousSecond.current = null; });
    socket.on('game:answer-count', setAnswerCount);
    socket.on('game:question-results', (payload) => { setResults(payload); setGame((current) => current ? { ...current, status: 'results' } : current); });
    socket.on('game:leaderboard', ({ leaderboard: entries }) => setLeaderboard(entries));
    socket.on('game:end', ({ reason, leaderboard: entries }) => { setGame((current) => current ? { ...current, status: 'ended', endReason: reason } : current); setLeaderboard(entries); setQuestion(null); setResults(null); });
    socket.on('game:error', (payload) => setError(payload.message || 'The game could not process that action.'));
    socket.on('connect_error', (connectError) => setError(connectError.message || 'Could not connect to the game server.'));
    socket.connect();
    return () => { alive = false; socket.removeAllListeners(); socket.disconnect(); };
  }, [socket]);

  useEffect(() => {
    if (!question || game?.status !== 'question') { previousSecond.current = null; return; }
    if (timer.seconds > 0 && timer.seconds <= 5 && previousSecond.current !== null && timer.seconds < previousSecond.current) audio.play('tick');
    previousSecond.current = timer.seconds;
  }, [audio, game?.status, question, timer.seconds]);
  useEffect(() => {
    if (game?.status === 'ended' && endedPin.current !== game.pin) { endedPin.current = game.pin; audio.play('podium'); }
  }, [audio, game?.pin, game?.status]);

  function createGame(event) {
    event.preventDefault();
    if (!quizId) return setError('Create a quiz before starting a live game.');
    setError(''); socket.emit('host:create-game', { quizId: Number(quizId) });
  }
  function reset() {
    localStorage.removeItem('quizblitz-host-pin');
    setGame(null); setPlayers([]); setQuestion(null); setResults(null); setLeaderboard([]); setError(''); endedPin.current = '';
  }
  const joinUrl = game ? `${window.location.origin}/join?pin=${game.pin}` : '';
  const stage = !game ? 'select' : game.status === 'lobby' ? 'lobby' : game.status === 'ended' ? 'podium' : results ? 'results' : 'question';

  return <main className="host-game-shell">
    <GameHeader label={game ? `ROOM ${game.pin}` : 'HOST STUDIO'} audio={audio}><span className={`connection-indicator ${connected ? 'online' : ''}`}>{connected ? 'LIVE' : 'CONNECTING'}</span></GameHeader>
    <AnimatePresence mode="wait" initial={false}>
      {stage === 'select' && <motion.section key="select" className="host-select-stage" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.24 }}>
        <div className="stage-kicker">YOUR NEXT BIG MOMENT</div><h1>Bring your quiz<br />to the <em>room.</em></h1><p>Choose a quiz to open a live room. Players join from their phones.</p>
        <form className="host-select-form" onSubmit={createGame}><label>SELECT A QUIZ<select value={quizId} onChange={(event) => setQuizId(event.target.value)} disabled={!quizzes.length}><option value="">{quizzes.length ? 'Choose from your library' : 'No quizzes yet'}</option>{quizzes.map((quiz) => <option key={quiz.id} value={quiz.id}>{quiz.title} · {quiz.questionCount} questions</option>)}</select></label><button className="game-primary" disabled={!connected || !quizzes.length}>Open game lobby <span>→</span></button></form>
        {!quizzes.length && <Link className="return-studio-link" to="/dashboard">Build a quiz in your studio ↗</Link>}
      </motion.section>}

      {stage === 'lobby' && <motion.section key="lobby" className="host-lobby-stage" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
        <div className="lobby-topline"><div><div className="stage-kicker">{game.quizTitle}</div><h1>Your room is <em>open.</em></h1><p>Players can scan the code or visit the join page.</p></div><div className="game-pin-block"><span>GAME PIN</span><strong>{game.pin}</strong></div></div>
        <div className="lobby-grid"><section className="lobby-roster-card"><div className="lobby-card-heading"><div><span className="stage-kicker">THE CREW</span><h2>Players in the room</h2></div><span className="roster-count">{players.length}</span></div>
          {players.length ? <LayoutGroup><div className="lobby-roster"><AnimatePresence initial={false}>{players.map((player, index) => <motion.div layout key={player.id} className="lobby-player-chip" initial={{ opacity: 0, scale: 0.94, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9 }} transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}><span className="roster-avatar" style={{ '--avatar-tone': ['#536cf3', '#38a984', '#dcad35', '#d26b80'][index % 4] }}>{player.nickname.slice(0, 1).toUpperCase()}</span><span className="roster-name">{player.nickname}</span><span className={`roster-dot ${player.connected ? 'connected' : ''}`} /><button type="button" onClick={() => socket.emit('host:kick', { pin: game.pin, playerId: player.id })} aria-label={`Remove ${player.nickname}`} title="Remove player">×</button></motion.div>)}</AnimatePresence></div></LayoutGroup> : <div className="lobby-empty"><span>✦</span><p>The room is ready.<br />Waiting for players to join…</p></div>}
          <div className="lobby-footer"><span><i /> {players.length} {players.length === 1 ? 'PLAYER' : 'PLAYERS'} JOINED</span><button type="button" className="game-primary" disabled={!players.length} onClick={() => socket.emit('host:start', { pin: game.pin })}>Start game <span>→</span></button></div>
        </section><aside className="lobby-join-card"><div className="qr-frame"><QRCodeSVG value={joinUrl} size={166} level="M" bgColor="#ffffff" fgColor="#17152a" /></div><span className="stage-kicker">SCAN TO JOIN</span><h2>Jump in from<br />your phone.</h2><a href={joinUrl} target="_blank" rel="noreferrer">Open player screen ↗</a><button type="button" className="end-lobby-button" onClick={() => socket.emit('host:end', { pin: game.pin })}>Close this room</button></aside></div>
      </motion.section>}

      {stage === 'question' && question && <motion.section key={`q-${question.questionNumber}`} className="host-question-stage" initial={{ opacity: 0, x: 18 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.24 }}>
        <div className="question-stage-head"><div><span className="stage-kicker">QUESTION {String(question.questionNumber).padStart(2, '0')} <i /> {String(question.totalQuestions).padStart(2, '0')}</span><h1>{question.text}</h1></div><CountdownRing endsAt={question.endsAt} durationSeconds={question.timeLimitSeconds} large /></div>
        <div className="host-answer-options">{question.options.map((option, index) => <motion.div layout key={`${question.questionNumber}-${index}`} className={`host-answer-option ${answerColors[index]}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.06 }}><span className="shape-dot">{answerShapes[index]}</span><strong>{option}</strong></motion.div>)}</div>
        <div className="host-question-bottom"><div className="answering-count"><div className="answering-number">{answerCount.answeredCount}<small>/{answerCount.playerCount}</small></div><span>HAVE ANSWERED</span></div><div className="host-question-actions"><button type="button" className="game-quiet" onClick={() => socket.emit('host:skip', { pin: game.pin })}>Skip question <span>↷</span></button><button type="button" className="game-stop" onClick={() => socket.emit('host:end', { pin: game.pin })}>End game</button></div></div>
      </motion.section>}

      {stage === 'results' && results && <motion.section key={`results-${results.questionNumber}`} className="host-results-stage" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.25 }}>
        <div className="stage-kicker">QUESTION {String(results.questionNumber).padStart(2, '0')} RESULTS</div><div className="results-heading"><h1>{results.text}</h1><span>{results.answeredCount}<small> / {results.playerCount} ANSWERED</small></span></div>
        <div className="results-grid"><section className="results-card"><div className="results-card-title"><div><span className="stage-kicker">ANSWER DISTRIBUTION</span><h2>Here’s how it went.</h2></div><span className="correct-pill">✓ {results.options[results.correctOption]}</span></div><AnimatedBars results={results} /></section>
          <section className="results-card results-rank-card"><span className="stage-kicker">LIVE STANDINGS</span><h2>Leaderboard</h2><Leaderboard entries={leaderboard} compact /></section></div>
        <div className="results-footer"><button type="button" className="game-stop" onClick={() => socket.emit('host:end', { pin: game.pin })}>End game</button><button type="button" className="game-primary" onClick={() => socket.emit('host:next', { pin: game.pin })}>{results.questionNumber === results.totalQuestions ? 'Finish game' : 'Next question'} <span>→</span></button></div>
      </motion.section>}

      {stage === 'podium' && <motion.section key="podium" className="host-podium-stage" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <Confetti /><div className="stage-kicker">{game.endReason === 'host-ended' ? 'GAME ENDED EARLY' : 'THAT’S A WRAP'}</div><h1>And the room<br /><em>goes to…</em></h1>
        {leaderboard.length ? <Podium entries={leaderboard} /> : <div className="podium-no-players">No one made it onto the leaderboard this time.</div>}
        <section className="final-board"><div className="final-board-heading"><span className="stage-kicker">FINAL STANDINGS</span><span>{leaderboard.length} PLAYERS</span></div><Leaderboard entries={leaderboard} /></section>
        <div className="podium-actions"><Link className="game-quiet" to="/dashboard">Back to studio</Link><button className="game-primary" onClick={() => { localStorage.removeItem('quizblitz-host-pin'); setGame(null); setPlayers([]); setLeaderboard([]); endedPin.current = ''; }}>Host another game <span>→</span></button></div>
      </motion.section>}
    </AnimatePresence>
    {error && <motion.div className="game-toast" role="alert" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>{error}<button onClick={() => setError('')} aria-label="Dismiss">×</button></motion.div>}
  </main>;
}

export function PlayerGame() {
  const initialPin = (new URLSearchParams(window.location.search).get('pin') || '').replace(/\D/g, '').slice(0, 6);
  const [pin, setPin] = useState(initialPin);
  const [nickname, setNickname] = useState('');
  const [phase, setPhase] = useState('join');
  const [question, setQuestion] = useState(null);
  const [selected, setSelected] = useState(null);
  const [results, setResults] = useState(null);
  const [answerResult, setAnswerResult] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const [summary, setSummary] = useState(null);
  const [lobbyPlayers, setLobbyPlayers] = useState([]);
  const [error, setError] = useState('');
  const [socket, setSocket] = useState(null);
  const [playerToken, setPlayerToken] = useState('');
  const socketRef = useRef(null);
  const joinedRef = useRef(false);
  const previousSecond = useRef(null);
  const audio = useGameAudio({ lobby: phase === 'lobby' });
  const timer = useCountdown(question?.endsAt, question?.timeLimitSeconds);

  function connectToGame(gamePin, name) {
    const token = localStorage.getItem(`quizblitz-player-${gamePin}`) || '';
    socketRef.current?.disconnect();
    joinedRef.current = false;
    const client = io(apiOrigin, { auth: {} });
    socketRef.current = client;
    setSocket(client); setPhase('connecting'); setError('');
    client.on('connect', () => client.emit('player:join', { pin: gamePin, nickname: name, playerToken: token }));
    client.on('player:joined', (payload) => {
      joinedRef.current = true;
      setPin(payload.pin); setNickname(payload.nickname); setPlayerToken(payload.playerToken);
      localStorage.setItem(`quizblitz-player-${payload.pin}`, payload.playerToken);
      localStorage.setItem(`quizblitz-name-${payload.pin}`, payload.nickname);
      setPhase('lobby'); setError('');
    });
    client.on('player:lobby-state', ({ players }) => setLobbyPlayers(players));
    client.on('lobby:players', ({ players }) => setLobbyPlayers(players));
    client.on('game:question', (payload) => { setQuestion(payload); setSelected(null); setResults(null); setAnswerResult(null); setPhase('question'); previousSecond.current = null; });
    client.on('player:answer-accepted', () => setPhase('waiting'));
    client.on('game:question-results', setResults);
    client.on('player:answer-result', (payload) => { setAnswerResult(payload); setPhase('results'); });
    client.on('game:leaderboard', ({ leaderboard: entries }) => setLeaderboard(entries));
    client.on('game:end', ({ leaderboard: entries }) => { setLeaderboard(entries); setPhase('ended'); });
    client.on('player:game-summary', setSummary);
    client.on('player:kicked', ({ message }) => { joinedRef.current = false; setError(message); setPhase('join'); client.disconnect(); });
    client.on('game:error', (payload) => { setError(payload.message); if (!joinedRef.current) setPhase('join'); });
    client.on('connect_error', (connectError) => { setError(connectError.message || 'Could not connect to the game.'); setPhase('join'); });
  }

  useEffect(() => {
    const token = initialPin && localStorage.getItem(`quizblitz-player-${initialPin}`);
    const name = initialPin && localStorage.getItem(`quizblitz-name-${initialPin}`);
    if (token && name) connectToGame(initialPin, name);
    return () => socketRef.current?.disconnect();
    // Reconnect only when the join page is opened with the original PIN.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!question || !['question', 'waiting'].includes(phase)) { previousSecond.current = null; return; }
    if (timer.seconds > 0 && timer.seconds <= 5 && previousSecond.current !== null && timer.seconds < previousSecond.current) audio.play('tick');
    previousSecond.current = timer.seconds;
  }, [audio, phase, question, timer.seconds]);
  useEffect(() => {
    if (phase === 'results' && answerResult) audio.play(answerResult.correct ? 'correct' : 'wrong');
  }, [answerResult, audio, phase]);
  useEffect(() => {
    if (phase === 'ended') audio.play('podium');
  }, [audio, phase]);
  useEffect(() => {
    if (phase === 'waiting' && answerResult) setPhase('results');
  }, [answerResult, phase]);

  function join(event) {
    event.preventDefault();
    const cleanPin = pin.replace(/\D/g, '').slice(0, 6);
    const cleanName = nickname.trim().replace(/\s+/g, ' ');
    if (cleanPin.length !== 6) return setError('Enter the 6-digit game PIN.');
    if (!cleanName) return setError('Enter a nickname to join.');
    setPin(cleanPin); setNickname(cleanName);
    connectToGame(cleanPin, cleanName);
  }
  function answer(index) {
    if (!socket || !playerToken || selected !== null) return;
    setSelected(index);
    socket.emit('player:answer', { pin, playerToken, optionIndex: index });
  }
  function leave() {
    socket?.emit('player:leave', { pin, playerToken });
    socketRef.current?.disconnect(); socketRef.current = null; setSocket(null); joinedRef.current = false;
    setQuestion(null); setResults(null); setAnswerResult(null); setSummary(null); setPhase('join'); setError('');
  }
  const phaseTitle = phase === 'lobby' ? 'ROOM ' + pin : phase === 'question' || phase === 'waiting' ? `QUESTION ${question?.questionNumber ?? ''}` : 'QUIZBLITZ LIVE';
  const transition = { duration: 0.2, ease: [0.22, 1, 0.36, 1] };

  return <main className="player-game-shell"><GameHeader label={phaseTitle} audio={audio}>
    {phase === 'lobby' && <button className="player-leave-top" onClick={leave}>Leave</button>}
  </GameHeader>
    <AnimatePresence mode="wait" initial={false}>
      {phase === 'join' && <motion.section key="join" className="player-join-stage" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={transition}>
        <div className="player-join-mark">✦</div><div className="stage-kicker">THE ROOM IS WAITING</div><h1>Jump into<br /><em>the game.</em></h1><p>Enter the PIN on the host screen and pick a name.</p>
        <form className="player-join-form" onSubmit={join}><label>GAME PIN<input autoFocus={!initialPin} value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="000000" maxLength="6" required /></label><label>NICKNAME<input value={nickname} onChange={(event) => setNickname(event.target.value)} autoComplete="nickname" maxLength="20" placeholder="What should we call you?" required /></label><button className="game-primary" type="submit">Join game <span>→</span></button></form>
        {error && <div className="player-error" role="alert">{error}</div>}
      </motion.section>}

      {phase === 'connecting' && <motion.section key="connecting" className="player-simple-stage" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><div className="connecting-orb" /><h1>Finding your room…</h1><p>PIN {pin}</p>{error && <div className="player-error" role="alert">{error}</div>}</motion.section>}

      {phase === 'lobby' && <motion.section key="lobby" className="player-simple-stage player-lobby-stage" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={transition}>
        <div className="player-lobby-star">✦</div><div className="stage-kicker">YOU’RE IN THE ROOM</div><h1>Hey, {nickname}.</h1><p>Waiting for the host to kick things off.</p><div className="lobby-player-total"><strong>{lobbyPlayers.length}</strong><span>{lobbyPlayers.length === 1 ? 'PLAYER IN' : 'PLAYERS IN'} THE ROOM</span></div>
        <div className="player-lobby-chips"><AnimatePresence initial={false}>{lobbyPlayers.map((player, index) => <motion.span layout key={player.id} initial={{ opacity: 0, scale: 0.88 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.88 }} transition={{ delay: index * 0.025 }} className={player.nickname === nickname ? 'you-chip' : ''}>{player.nickname}</motion.span>)}</AnimatePresence></div>
      </motion.section>}

      {phase === 'question' && question && <motion.section key={`question-${question.questionNumber}`} className="player-question-stage" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={transition}>
        <div className="player-question-heading"><div className="player-question-label"><span>QUESTION {String(question.questionNumber).padStart(2, '0')}</span><i />{String(question.totalQuestions).padStart(2, '0')}</div><CountdownRing endsAt={question.endsAt} durationSeconds={question.timeLimitSeconds} /></div>
        <h1>{question.text}</h1><div className="player-answer-options">{question.options.map((option, index) => <motion.button type="button" key={index} disabled={selected !== null} className={`player-answer-button ${answerColors[index]} ${selected === index ? 'answer-selected' : ''}`} whileTap={selected === null ? { scale: 0.97 } : undefined} onClick={() => answer(index)}>
          <span className="answer-shape">{answerShapes[index]}</span><span className="answer-copy">{option}</span>{selected === index && <motion.span className="answer-check" initial={{ scale: 0 }} animate={{ scale: 1 }}>✓</motion.span>}
        </motion.button>)}</div>
        <div className="player-footnote">{question.pointsMode === 'double' ? 'DOUBLE POINTS ROUND' : question.pointsMode === 'none' ? 'NO POINTS ROUND' : 'FAST ANSWERS SCORE MORE'}</div>
      </motion.section>}

      {phase === 'waiting' && <motion.section key="waiting" className="player-simple-stage player-waiting-stage" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={transition}>
        <div className="wait-signal"><span /><span /><span /></div><h1>Answer locked in.</h1><p>Hang tight while the rest of the room decides.</p>{question && <CountdownRing endsAt={question.endsAt} durationSeconds={question.timeLimitSeconds} seconds={timer.seconds} />}
      </motion.section>}

      {phase === 'results' && answerResult && <motion.section key={`feedback-${answerResult.questionNumber}`} className="player-simple-stage player-feedback-stage" initial={{ opacity: 0, scale: 0.98 }} animate={answerResult.correct ? { opacity: 1, scale: [0.98, 1.025, 1] } : { opacity: 1, x: [0, -9, 9, -5, 5, 0] }} exit={{ opacity: 0, y: -6 }} transition={{ duration: answerResult.correct ? 0.42 : 0.38 }}>
        <div className={`feedback-symbol ${answerResult.correct ? 'feedback-correct' : 'feedback-wrong'}`}>{answerResult.noAnswer ? '◷' : answerResult.correct ? '✓' : '×'}</div><div className="stage-kicker">{answerResult.noAnswer ? 'TIME IS UP' : answerResult.correct ? 'THAT WAS RIGHT' : 'NEXT ONE IS YOURS'}</div><h1>{answerResult.noAnswer ? 'Time’s up.' : answerResult.correct ? 'Nice one!' : 'Not quite.'}</h1>
        <div className="points-earned"><strong>+{answerResult.pointsEarned.toLocaleString()}</strong><span>POINTS</span></div>{answerResult.streakBonus > 0 && <motion.div className="streak-bonus-chip" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>✦ +{answerResult.streakBonus} STREAK BONUS</motion.div>}
        {results && <div className="answer-reveal"><span>THE CORRECT ANSWER</span><strong>{results.options[results.correctOption]}</strong></div>}
        <div className="round-stats"><div><strong>#{answerResult.currentRank}</strong><span>YOUR RANK</span></div><div><strong>{answerResult.totalScore.toLocaleString()}</strong><span>TOTAL POINTS</span></div><div><strong>{answerResult.currentStreak}</strong><span>STREAK</span></div></div>
        <p className="player-wait-copy">Waiting for the host to continue…</p>
      </motion.section>}

      {phase === 'ended' && <motion.section key="final" className="player-final-stage" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={transition}>
        <div className="stage-kicker">GAME COMPLETE</div><h1>You played<br /><em>your part.</em></h1><div className="final-player-stats"><div className="final-rank-stat"><span>FINAL RANK</span><strong>#{summary?.finalRank ?? leaderboard.find((entry) => entry.nickname === nickname)?.rank ?? '—'}</strong></div><div><span>FINAL SCORE</span><strong>{(summary?.finalScore ?? leaderboard.find((entry) => entry.nickname === nickname)?.score ?? 0).toLocaleString()}</strong></div><div><span>ACCURACY</span><strong>{summary?.accuracy ?? 0}%</strong></div><div><span>BEST STREAK</span><strong>{summary?.bestStreak ?? 0}</strong></div><div><span>CORRECT</span><strong>{summary?.correctCount ?? 0}/{summary?.answeredCount ?? 0}</strong></div></div>
        <div className="player-final-board"><div className="player-final-board-head"><span>FINAL LEADERBOARD</span><strong>{leaderboard.length} PLAYERS</strong></div><Leaderboard entries={leaderboard} compact /></div><button className="game-primary player-done-button" onClick={leave}>Done <span>→</span></button>
      </motion.section>}
    </AnimatePresence>
  </main>;
}
