import { useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { Link } from 'react-router-dom';
import { apiRequest } from './lib/api.js';
import './game-lab.css';

const apiOrigin = (import.meta.env.VITE_API_URL || window.location.origin).replace(/\/$/, '');

function Distribution({ results }) {
  const max = Math.max(1, ...results.answerCounts);
  return <div className="lab-distribution" aria-label="Answer distribution">{results.options.map((option, index) => <div className={`lab-bar-row ${index === results.correctOption ? 'is-correct' : ''}`} key={index}>
    <span className="lab-bar-label">{option}</span><div className="lab-bar-track"><div className="lab-bar-fill" style={{ width: `${(results.answerCounts[index] / max) * 100}%` }} /></div><strong>{results.answerCounts[index]}</strong>
  </div>)}</div>;
}

export function GameLab() {
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

  useEffect(() => {
    let alive = true;
    apiRequest('/api/quizzes').then(({ quizzes: items }) => { if (alive) { setQuizzes(items); setQuizId((value) => value || String(items[0]?.id || '')); } })
      .catch((requestError) => alive && setError(requestError.message));
    const onConnect = () => {
      setConnected(true);
      const pin = localStorage.getItem('quizblitz-host-pin');
      if (pin) socket.emit('host:resume-game', { pin });
    };
    const onDisconnect = () => setConnected(false);
    const onCreated = (snapshot) => {
      localStorage.setItem('quizblitz-host-pin', snapshot.pin);
      setGame(snapshot); setPlayers(snapshot.players); setQuestion(null); setResults(null); setLeaderboard([]); setError('');
    };
    const onSnapshot = (snapshot) => {
      setGame(snapshot); setPlayers(snapshot.players); setQuestion(snapshot.question);
      setResults(snapshot.results); setLeaderboard(snapshot.leaderboard || []);
      if (snapshot.question) setAnswerCount({ answeredCount: 0, playerCount: snapshot.players.length });
    };
    const onQuestion = (payload) => { setQuestion(payload); setResults(null); setAnswerCount({ answeredCount: 0, playerCount: payload.playerCount }); };
    const onError = (payload) => setError(payload.message || 'The game could not process that action.');
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('host:game-created', onCreated);
    socket.on('host:game-state', onSnapshot);
    socket.on('lobby:players', ({ players: list }) => setPlayers(list));
    socket.on('game:question', onQuestion);
    socket.on('game:answer-count', setAnswerCount);
    socket.on('game:question-results', setResults);
    socket.on('game:leaderboard', ({ leaderboard: entries }) => setLeaderboard(entries));
    socket.on('game:started', () => setGame((value) => value ? { ...value, status: 'question' } : value));
    socket.on('game:end', ({ reason, leaderboard: entries }) => { setGame((value) => value ? { ...value, status: 'ended', endReason: reason } : value); setLeaderboard(entries); setQuestion(null); setResults(null); });
    socket.on('host:connection', ({ connected: hostConnected }) => setGame((value) => value ? { ...value, hostConnected } : value));
    socket.on('game:error', onError);
    socket.connect();
    return () => {
      alive = false;
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [socket]);

  function createGame(event) {
    event.preventDefault();
    if (!quizId) return setError('Create a quiz first, then come back to start a game.');
    setError(''); socket.emit('host:create-game', { quizId: Number(quizId) });
  }
  function startGame() { setError(''); socket.emit('host:start', { pin: game.pin }); }
  function skipQuestion() { socket.emit('host:skip', { pin: game.pin }); }
  function nextQuestion() { socket.emit('host:next', { pin: game.pin }); }
  function endGame() { if (window.confirm('End this game for everyone?')) socket.emit('host:end', { pin: game.pin }); }
  function kickPlayer(player) { socket.emit('host:kick', { pin: game.pin, playerId: player.id }); }
  function resetGame() { localStorage.removeItem('quizblitz-host-pin'); setGame(null); setPlayers([]); setQuestion(null); setResults(null); setLeaderboard([]); setError(''); }

  return <main className="host-dashboard"><header className="dash-nav"><Link className="brand" to="/">✦ QuizBlitz</Link><Link className="back-link" to="/dashboard">← Back to studio</Link></header>
    <section className="lab-content"><div className="eyebrow"><span className={`live-dot ${connected ? '' : 'offline'}`} /> {connected ? 'REAL-TIME CONNECTION READY' : 'CONNECTING TO GAME SERVER'}</div>
      {!game ? <><h1>Start a live game.</h1><p className="lab-intro">Pick a quiz and open a room. Share the PIN with players on their phones.</p>
        <form className="lab-create" onSubmit={createGame}><label className="field-label">CHOOSE A QUIZ<select value={quizId} onChange={(event) => setQuizId(event.target.value)} disabled={!quizzes.length}><option value="">{quizzes.length ? 'Select a quiz' : 'No quizzes yet'}</option>{quizzes.map((quiz) => <option key={quiz.id} value={quiz.id}>{quiz.title} · {quiz.questionCount} questions</option>)}</select></label><button className="create-button" disabled={!connected || !quizzes.length}>Create game room <span>→</span></button></form>
      </> : <>
        <div className="lab-title-row"><div><div className="eyebrow">{game.quizTitle || 'QUIZBLITZ LIVE'}</div><h1>{game.status === 'ended' ? 'Game complete.' : game.status === 'lobby' ? 'Room is open.' : results ? 'Question results.' : 'Game in progress.'}</h1></div><span className={`lab-status ${game.status}`}>{game.status}</span></div>
        <div className="lab-pin-card"><div><span>GAME PIN</span><strong>{game.pin}</strong></div><p>Players join at <a href={`/join?pin=${game.pin}`} target="_blank" rel="noreferrer">Open player test ↗</a></p></div>
        {game.status === 'lobby' && <section className="lab-panel"><div className="lab-panel-head"><div><h2>Players in the room</h2><p>Waiting for your crew to arrive.</p></div><span className="lab-player-count">{players.length}</span></div>
          {players.length ? <div className="lab-player-list">{players.map((player) => <div className="lab-player" key={player.id}><span className="lab-player-dot" />{player.nickname}<span className="player-connection">{player.connected ? 'HERE' : 'RECONNECTING'}</span><button onClick={() => kickPlayer(player)} aria-label={`Kick ${player.nickname}`} title={`Kick ${player.nickname}`}>×</button></div>)}</div> : <div className="lab-empty-players">Share the PIN to bring players in.</div>}
          <button className="create-button lab-wide" onClick={startGame} disabled={!players.length}>Start game <span>→</span></button>
        </section>}
        {game.status === 'question' && question && <section className="lab-panel"><div className="lab-panel-head"><div><span className="question-chip">QUESTION {question.questionNumber} / {question.totalQuestions}</span><h2>{question.text}</h2></div><span className="lab-answer-count">{answerCount.answeredCount}<small> / {answerCount.playerCount} ANSWERED</small></span></div>
          <div className="lab-option-list">{question.options.map((option, index) => <div className="lab-option" key={index}><span className={`lab-option-color color-${index}`} />{option}</div>)}</div>
          <div className="lab-control-row"><button className="lab-quiet-button" onClick={skipQuestion}>Skip question</button><button className="lab-danger-button" onClick={endGame}>End game</button></div>
        </section>}
        {results && <section className="lab-panel"><div className="lab-panel-head"><div><span className="question-chip">CORRECT ANSWER</span><h2>{results.options[results.correctOption]}</h2></div><span className="lab-answer-count">{results.answeredCount}<small> / {results.playerCount} ANSWERED</small></span></div><Distribution results={results} />
          <div className="lab-panel-head leaderboard-title"><div><h2>Leaderboard</h2></div></div><div className="lab-rank-list">{leaderboard.map((entry) => <div className="lab-rank-row" key={entry.playerId}><strong>{String(entry.rank).padStart(2, '0')}</strong><span>{entry.nickname}</span><b>{entry.score.toLocaleString()}</b></div>)}</div>
          <div className="lab-control-row"><button className="lab-quiet-button" onClick={endGame}>End game</button><button className="create-button" onClick={nextQuestion}>{results.questionNumber === results.totalQuestions ? 'Finish game' : 'Next question'} <span>→</span></button></div>
        </section>}
        {game.status === 'ended' && <section className="lab-panel"><h2>Final leaderboard</h2><div className="lab-rank-list">{leaderboard.map((entry) => <div className="lab-rank-row" key={entry.playerId}><strong>{String(entry.rank).padStart(2, '0')}</strong><span>{entry.nickname}</span><b>{entry.score.toLocaleString()}</b></div>)}</div><button className="create-button" onClick={resetGame}>Start another game <span>→</span></button></section>}
      </>}
      {error && <div className="form-error dashboard-error" role="alert">{error}</div>}
    </section>
  </main>;
}

export function PlayerLab() {
  const params = new URLSearchParams(window.location.search);
  const initialPin = (params.get('pin') || '').replace(/\D/g, '').slice(0, 6);
  const [pin, setPin] = useState(initialPin);
  const [nickname, setNickname] = useState('');
  const [phase, setPhase] = useState('join');
  const [players, setPlayers] = useState([]);
  const [question, setQuestion] = useState(null);
  const [selected, setSelected] = useState(null);
  const [results, setResults] = useState(null);
  const [answerResult, setAnswerResult] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const [error, setError] = useState('');
  const [socket, setSocket] = useState(null);
  const [playerToken, setPlayerToken] = useState('');
  const joinedRef = useRef(false);
  const socketRef = useRef(null);
  const storedKey = `quizblitz-player-${pin}`;

  function enterGame(formPin, formNickname) {
    const token = localStorage.getItem(`quizblitz-player-${formPin}`) || '';
    const name = formNickname || localStorage.getItem(`quizblitz-name-${formPin}`) || '';
    socketRef.current?.disconnect();
    const client = io(apiOrigin, { auth: {} });
    socketRef.current = client;
    joinedRef.current = false;
    setSocket(client); setPhase('connecting'); setError('');
    client.on('connect', () => client.emit('player:join', { pin: formPin, nickname: name, playerToken: token }));
    client.on('player:joined', (payload) => {
      joinedRef.current = true;
      setPin(payload.pin); setNickname(payload.nickname); setPlayerToken(payload.playerToken);
      localStorage.setItem(`quizblitz-player-${payload.pin}`, payload.playerToken);
      localStorage.setItem(`quizblitz-name-${payload.pin}`, payload.nickname);
      setPhase('lobby'); setError('');
    });
    client.on('player:lobby-state', ({ players: list }) => setPlayers(list));
    client.on('lobby:players', ({ players: list }) => setPlayers(list));
    client.on('game:started', () => setPhase('question'));
    client.on('game:question', (payload) => { setQuestion(payload); setSelected(null); setResults(null); setAnswerResult(null); setPhase('question'); });
    client.on('player:answer-accepted', () => setPhase('waiting'));
    client.on('game:question-results', setResults);
    client.on('player:answer-result', (payload) => { setAnswerResult(payload); setPhase('results'); });
    client.on('game:leaderboard', ({ leaderboard: entries }) => setLeaderboard(entries));
    client.on('game:end', ({ reason, leaderboard: entries }) => { setLeaderboard(entries); setPhase('ended'); setError(reason === 'host-ended' ? 'The host ended the game early.' : 'Quiz complete.'); });
    client.on('player:kicked', ({ message }) => { setError(message); setPhase('join'); client.disconnect(); });
    client.on('game:error', (payload) => { setError(payload.message); if (!joinedRef.current) setPhase('join'); });
    client.on('connect_error', (connectError) => setError(connectError.message || 'Could not connect to the game server.'));
  }

  useEffect(() => {
    const token = localStorage.getItem(storedKey);
    const name = localStorage.getItem(`quizblitz-name-${pin}`);
    if (initialPin.length === 6 && token && name) enterGame(initialPin, name);
    // A mount-time reconnect is intentional; subsequent pin edits must not create sockets.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => socketRef.current?.disconnect(), []);

  function join(event) {
    event.preventDefault();
    const cleanPin = pin.replace(/\D/g, '').slice(0, 6);
    const cleanNickname = nickname.trim().replace(/\s+/g, ' ');
    if (cleanPin.length !== 6) return setError('Enter the 6-digit game PIN.');
    if (!cleanNickname) return setError('Enter a nickname to join.');
    socket?.disconnect();
    setPin(cleanPin); setNickname(cleanNickname);
    enterGame(cleanPin, cleanNickname);
  }

  function answer(index) {
    if (!socket || !playerToken) return;
    setSelected(index); setPhase('waiting');
    socket.emit('player:answer', { pin, playerToken, optionIndex: index });
  }

  function leave() {
    joinedRef.current = false;
    if (socket) socket.emit('player:leave', { pin, playerToken });
    socketRef.current?.disconnect(); socketRef.current = null; setSocket(null); setPhase('join'); setQuestion(null); setResults(null); setAnswerResult(null); setError('');
  }

  return <main className="player-lab"><header><Link className="brand" to="/">✦ QuizBlitz</Link><span>PLAYER TEST</span></header>
    {phase === 'join' && <form className="player-join-card" onSubmit={join}><div className="eyebrow">YOUR SPOT IN THE ROOM</div><h1>Jump into<br />the game.</h1><label>GAME PIN<input value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="000000" maxLength={6} required /></label><label>NICKNAME<input value={nickname} onChange={(event) => setNickname(event.target.value)} autoComplete="nickname" maxLength={20} placeholder="What should we call you?" required /></label><button className="create-button">Join the game <span>→</span></button>{error && <div className="form-error" role="alert">{error}</div>}</form>}
    {phase === 'connecting' && <div className="player-message"><div className="player-loader" /><h1>Finding your room…</h1><p>PIN {pin}</p>{error && <div className="form-error" role="alert">{error}</div>}</div>}
    {phase === 'lobby' && <div className="player-message"><div className="eyebrow">ROOM {pin}</div><h1>You’re in, {nickname}.</h1><p>Waiting for the host to start. {players.length} {players.length === 1 ? 'player' : 'players'} are here.</p><div className="player-chip-list">{players.map((player) => <span key={player.id}>{player.nickname}</span>)}</div><button className="lab-quiet-button" onClick={leave}>Leave room</button></div>}
    {phase === 'question' && question && <div className="player-question"><div className="player-question-top"><span>QUESTION {question.questionNumber} / {question.totalQuestions}</span><span>{question.timeLimitSeconds}s</span></div><h1>{question.text}</h1><div className="player-answer-grid">{question.options.map((option, index) => <button className={`player-answer answer-color-${index}`} key={index} onClick={() => answer(index)}><span>{['◆', '●', '▲', '■'][index]}</span>{option}</button>)}</div></div>}
    {phase === 'waiting' && <div className="player-message"><div className="player-wait-icon">✓</div><h1>Answer locked in.</h1><p>Hang tight while the others finish.</p></div>}
    {phase === 'results' && <div className="player-message"><div className={`player-result-icon ${answerResult?.correct ? 'correct' : 'wrong'}`}>{answerResult?.correct ? '✓' : '×'}</div><h1>{answerResult?.noAnswer ? 'Time’s up.' : answerResult?.correct ? 'Nailed it!' : 'Not quite.'}</h1><p>{answerResult?.pointsEarned?.toLocaleString()} points this round · Rank #{answerResult?.currentRank}</p>{answerResult?.streakBonus > 0 && <div className="streak-bonus">✦ +{answerResult.streakBonus} STREAK BONUS</div>}{results && <p className="correct-answer-note">Correct answer: <strong>{results.options[results.correctOption]}</strong></p>}<div className="player-message-foot">Current score <strong>{answerResult?.totalScore?.toLocaleString()}</strong></div></div>}
    {phase === 'ended' && <div className="player-message"><div className="eyebrow">GAME {pin}</div><h1>That was a good one.</h1><p>{error || 'Quiz complete.'}</p><div className="player-message-foot">Final rank <strong>#{leaderboard.find((entry) => entry.nickname === nickname)?.rank ?? '—'}</strong></div><button className="lab-quiet-button" onClick={leave}>Done</button></div>}
  </main>;
}
