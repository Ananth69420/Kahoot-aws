import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiRequest } from './lib/api.js';
import ThemeToggle from './ThemeToggle.jsx';
import './history.css';

function HistoryFrame({ title, eyebrow, children }) {
  const user = JSON.parse(localStorage.getItem('quizblitz-user') || 'null');
  return <main className="history-shell"><header className="history-nav"><Link className="history-brand" to="/">✦ QuizBlitz</Link><nav><Link to="/dashboard">Studio</Link><Link to="/history">Game history</Link><Link to="/hall-of-fame">Hall of Fame</Link>{user && <span>{user.displayName}</span>}<ThemeToggle /></nav></header><section className="history-content"><div className="history-heading"><span>{eyebrow}</span><h1>{title}</h1></div>{children}</section><footer className="history-foot">QUIZBLITZ · EVERY ROUND COUNTS</footer></main>;
}

function Empty({ children }) { return <div className="history-empty"><span>✦</span><h2>{children}</h2><p>Finish a live game and it will show up here.</p><Link to="/game-lab">Host a game →</Link></div>; }

function LoadError({ error, retry }) { return <div className="history-error" role="alert">{error}<button onClick={retry}>Try again</button></div>; }

export function GameHistory() {
  const { gameId } = useParams();
  const [games, setGames] = useState([]);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = async () => {
    setLoading(true); setError('');
    try {
      if (gameId) setDetail(await apiRequest(`/api/history/${gameId}`));
      else setGames((await apiRequest('/api/history')).games);
    } catch (requestError) { setError(requestError.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [gameId]);

  if (gameId) return <HistoryFrame title={detail?.game.quizTitle || 'Game details'} eyebrow="THE FULL STORY">
    <Link className="history-back" to="/history">← All games</Link>
    {loading ? <div className="history-loading">Loading game…</div> : error ? <LoadError error={error} retry={load} /> : detail && <>
      <div className="history-game-summary"><div><span>GAME PIN</span><strong>{detail.game.pin}</strong></div><div><span>PLAYED</span><strong>{new Date(detail.game.endedAt).toLocaleString()}</strong></div><div><span>PLAYERS</span><strong>{detail.game.playerCount}</strong></div></div>
      <section className="history-panel"><div className="history-panel-title"><span>FINAL STANDINGS</span><h2>The leaderboard</h2></div>{detail.leaderboard.length ? <div className="history-table-wrap"><table className="history-table"><thead><tr><th>RANK</th><th>PLAYER</th><th>SCORE</th><th>ACCURACY</th><th>BEST STREAK</th></tr></thead><tbody>{detail.leaderboard.map((entry) => <tr key={`${entry.rank}-${entry.nickname}`}><td><b className={`history-rank rank-${entry.rank}`}>{String(entry.rank).padStart(2, '0')}</b></td><td>{entry.nickname}</td><td>{entry.finalScore.toLocaleString()}</td><td>{entry.accuracy}% <small>({entry.correctCount}/{entry.answeredCount})</small></td><td>{entry.bestStreak}</td></tr>)}</tbody></table></div> : <p className="history-muted">No players completed this game.</p>}</section>
      <section className="history-panel"><div className="history-panel-title"><span>QUESTION REPORT</span><h2>Accuracy by question</h2></div>{detail.questions.map((question) => <article className="question-report" key={question.questionNumber}><div className="question-report-head"><span>QUESTION {String(question.questionNumber).padStart(2, '0')}</span><strong>{question.accuracy}% accuracy</strong></div><h3>{question.text}</h3><div className="accuracy-track"><i style={{ width: `${question.accuracy}%` }} /></div><p>{question.correctCount} correct out of {question.answeredCount} answers · {question.playerCount} players</p></article>)}</section>
    </>}
  </HistoryFrame>;

  return <HistoryFrame title="Past games." eyebrow="YOUR HOST HISTORY">
    {loading ? <div className="history-loading">Loading your games…</div> : error ? <LoadError error={error} retry={load} /> : games.length ? <div className="history-game-list">{games.map((game) => <Link className="history-game-card" to={`/history/${game.id}`} key={game.id}><div><span className="history-quiz-title">{game.quizTitle}</span><span className="history-game-date">{new Date(game.endedAt).toLocaleString()}</span></div><div className="history-game-meta"><span><strong>{game.playerCount}</strong> PLAYERS</span><span><strong>{game.topScore?.toLocaleString() || 0}</strong> TOP SCORE</span><b>VIEW REPORT ↗</b></div></Link>)}</div> : <Empty>No games yet.</Empty>}
  </HistoryFrame>;
}

export function HallOfFame() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  async function load() { setLoading(true); setError(''); try { setEntries((await apiRequest('/api/leaderboards/hall-of-fame')).entries); } catch (requestError) { setError(requestError.message); } finally { setLoading(false); } }
  useEffect(() => { load(); }, []);
  return <HistoryFrame title={<>The Hall of <em>Fame.</em></>} eyebrow="SCORES THAT STICK AROUND">
    <p className="hall-intro">The highest scores from every finished QuizBlitz game.</p>
    {loading ? <div className="history-loading">Finding the top scores…</div> : error ? <LoadError error={error} retry={load} /> : entries.length ? <section className="history-panel hall-panel"><div className="history-panel-title"><span>ALL TIME</span><h2>Top scores</h2></div><div className="history-table-wrap"><table className="history-table"><thead><tr><th>#</th><th>PLAYER</th><th>QUIZ</th><th>SCORE</th><th>ACCURACY</th></tr></thead><tbody>{entries.map((entry, index) => <tr key={`${entry.nickname}-${entry.quizTitle}-${entry.endedAt}-${index}`}><td><b className={`history-rank rank-${index + 1}`}>{String(index + 1).padStart(2, '0')}</b></td><td>{entry.nickname}</td><td>{entry.quizTitle}</td><td>{entry.finalScore.toLocaleString()}</td><td>{entry.accuracy}%</td></tr>)}</tbody></table></div></section> : <Empty>The Hall is waiting.</Empty>}
  </HistoryFrame>;
}
