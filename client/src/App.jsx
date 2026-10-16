import { useState } from 'react';
import { Link, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { authRequest } from './lib/api.js';
import QuizDashboard from './QuizDashboard.jsx';
import QuizEditor from './QuizEditor.jsx';
import { HostGame, PlayerGame } from './FullGame.jsx';
import { GameHistory, HallOfFame } from './HistoryPages.jsx';
import ThemeToggle from './ThemeToggle.jsx';

const apiUrl = import.meta.env.VITE_API_URL;

function Landing() {
  const navigate = useNavigate();
  const [pin, setPin] = useState('');
  function joinGame(event) {
    event.preventDefault();
    navigate(`/join?pin=${pin}`);
  }
  return <main className="landing min-h-screen">
    <nav className="nav"><Link className="brand" to="/">✦ QuizBlitz</Link><div className="landing-nav-links"><Link to="/hall-of-fame">Hall of Fame</Link><Link className="login" to="/login">Host log in <span>↗</span></Link><ThemeToggle /></div></nav>
    <section className="hero">
      <div className="eyebrow"><span className="live-dot" /> THE QUIZ GAME FOR EVERYONE</div>
      <h1>Bring the room<br />to <span>life.</span></h1>
      <p className="intro">Big questions. Bigger energy. Start a quiz night your friends will still be talking about tomorrow.</p>
      <form className="join-card" onSubmit={joinGame}><label htmlFor="pin">Got a game PIN?</label><div className="join-row"><input id="pin" placeholder="Enter PIN" inputMode="numeric" maxLength="6" value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 6))} /><button type="submit">Join game <span>→</span></button></div></form>
      <Link to="/signup" className="host-link">Want to host? <strong>Create your free account →</strong></Link>
      <div className="orbit orbit-one" /><div className="orbit orbit-two" />
    </section>
    <footer><span>QUIZBLITZ © 2026</span><span>MADE FOR THE MOMENT</span></footer>
  </main>;
}

function AuthPage({ mode }) {
  const signup = mode === 'signup';
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function handleSubmit(event) {
    event.preventDefault();
    if (busy) return;
    setError('');
    setBusy(true);
    const form = new FormData(event.currentTarget);
    const payload = signup
      ? { displayName: form.get('displayName'), email: form.get('email'), password: form.get('password') }
      : { email: form.get('email'), password: form.get('password') };
    try {
      const result = await authRequest(signup ? 'signup' : 'login', payload);
      localStorage.setItem('quizblitz-token', result.token);
      localStorage.setItem('quizblitz-user', JSON.stringify(result.user));
      navigate('/dashboard');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }
  return <main className="auth-shell"><div className="auth-topbar"><Link className="brand" to="/">✦ QuizBlitz</Link><ThemeToggle /></div><form className="auth-card" onSubmit={handleSubmit}>
    <div className="eyebrow">HOST YOUR NEXT BIG THING</div><h1>{signup ? 'Make it a game.' : 'Welcome back.'}</h1><p>{signup ? 'Create an account to start building quizzes.' : 'Log in to your host dashboard.'}</p>
    {signup && <label>Display name<input name="displayName" autoComplete="name" required minLength="2" maxLength="40" /></label>}
    <label>Email address<input name="email" type="email" autoComplete="email" required /></label><label>Password<input name="password" type="password" autoComplete={signup ? 'new-password' : 'current-password'} minLength={signup ? 10 : 1} maxLength="72" required /></label>
    {error && <div className="form-error" role="alert">{error}</div>}
    <button className="submit" type="submit" disabled={busy}>{busy ? 'Please wait…' : signup ? 'Create account' : 'Log in'} <span>→</span></button><div className="switch">{signup ? 'Already hosting?' : 'New to QuizBlitz?'} <Link to={signup ? '/login' : '/signup'}>{signup ? 'Log in' : 'Create an account'}</Link></div>
    </form><div className="api-note">API endpoint · {apiUrl || 'same origin'}</div></main>;
}

export default function App() {
  const Private = ({ children }) => localStorage.getItem('quizblitz-token') ? children : <Navigate to="/login" replace />;
  return <Routes>
    <Route path="/" element={<Landing />} />
    <Route path="/signup" element={<AuthPage mode="signup" />} />
    <Route path="/login" element={<AuthPage mode="login" />} />
    <Route path="/dashboard" element={<Private><QuizDashboard /></Private>} />
    <Route path="/history" element={<Private><GameHistory /></Private>} />
    <Route path="/history/:gameId" element={<Private><GameHistory /></Private>} />
    <Route path="/hall-of-fame" element={<HallOfFame />} />
    <Route path="/game-lab" element={<Private><HostGame /></Private>} />
    <Route path="/quizzes/new" element={<Private><QuizEditor /></Private>} />
    <Route path="/quizzes/:quizId/edit" element={<Private><QuizEditor /></Private>} />
    <Route path="/join" element={<PlayerGame />} />
    <Route path="*" element={<Landing />} />
  </Routes>;
}
