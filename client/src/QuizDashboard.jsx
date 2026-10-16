import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { apiRequest } from './lib/api.js';
import ThemeToggle from './ThemeToggle.jsx';

function initials(name = 'Host') {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('');
}

export default function QuizDashboard() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = JSON.parse(localStorage.getItem('quizblitz-user') || 'null');
  const [quizzes, setQuizzes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const loadQuizzes = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await apiRequest('/api/quizzes');
      setQuizzes(result.quizzes);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { loadQuizzes(); }, [loadQuizzes]);

  async function deleteQuiz(quiz) {
    if (!window.confirm(`Delete “${quiz.title}”? It will disappear from your library.`)) return;
    try {
      await apiRequest(`/api/quizzes/${quiz.id}`, { method: 'DELETE' });
      setQuizzes((current) => current.filter((item) => item.id !== quiz.id));
    } catch (deleteError) {
      setError(deleteError.message);
    }
  }

  function signOut() {
    localStorage.removeItem('quizblitz-token');
    localStorage.removeItem('quizblitz-user');
    navigate('/');
  }

  const visibleQuizzes = quizzes.filter((quiz) => quiz.title.toLowerCase().includes(search.toLowerCase()));
  return <main className="host-dashboard">
    <header className="dash-nav"><Link className="brand" to="/">✦ QuizBlitz</Link><div className="host-profile"><ThemeToggle /><div className="avatar">{initials(user?.displayName)}</div><span className="host-name">{user?.displayName || 'Quiz host'}</span><button className="signout" onClick={signOut}>Sign out</button></div></header>
    <section className="dash-content">
      <div className="dash-heading"><div><div className="eyebrow"><span className="live-dot" /> YOUR STUDIO</div><h1>Make some <span>noise.</span></h1><p>Your quizzes, ready to light up a room.</p></div><div className="heading-actions"><Link className="test-game-link" to="/game-lab">Test live game <span>↗</span></Link><Link className="test-game-link" to="/history">Past games <span>↗</span></Link><Link className="create-button" to="/quizzes/new"><span>＋</span> Create a quiz</Link></div></div>
      <div className="library-toolbar"><div className="library-count"><strong>{quizzes.length.toString().padStart(2, '0')}</strong><span>QUIZZES IN YOUR LIBRARY</span></div><label className="search-box"><span aria-hidden="true">⌕</span><input aria-label="Search quizzes" placeholder="Search your quizzes" value={search} onChange={(event) => setSearch(event.target.value)} /></label></div>
      {location.state?.toast && <div className="success-toast" role="status">✦ {location.state.toast}</div>}
      {error && <div className="form-error dashboard-error" role="alert">{error}<button onClick={loadQuizzes}>Try again</button></div>}
      {loading ? <div className="quiz-grid" aria-label="Loading quizzes">{[1, 2, 3].map((item) => <div className="quiz-skeleton" key={item} />)}</div> : visibleQuizzes.length ? <div className="quiz-grid">
        {visibleQuizzes.map((quiz, index) => <article className="quiz-card" key={quiz.id} style={{ '--card-index': index }}>
          <div className="quiz-cover" style={quiz.coverImageUrl ? { backgroundImage: `linear-gradient(180deg, transparent 20%, #0d0b1be8), url("${quiz.coverImageUrl}")` } : undefined}>
            <span className="cover-mark">{String(index + 1).padStart(2, '0')}</span><span className="cover-spark">✦</span>
          </div>
          <div className="quiz-card-body"><div className="quiz-meta"><span>{quiz.questionCount} {quiz.questionCount === 1 ? 'QUESTION' : 'QUESTIONS'}</span><span className="meta-dot">·</span><span>UPDATED {new Date(quiz.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }).toUpperCase()}</span></div><h2>{quiz.title}</h2>
            <div className="quiz-card-actions"><Link to={`/quizzes/${quiz.id}/edit`}>Edit quiz <span>↗</span></Link><button className="delete-quiz" aria-label={`Delete ${quiz.title}`} title="Delete quiz" onClick={() => deleteQuiz(quiz)}>⌫</button></div></div>
        </article>)}
      </div> : <div className="empty-library"><div className="empty-icon">✦</div><h2>{search ? 'No quiz matches that search.' : 'Your first quiz starts here.'}</h2><p>{search ? 'Try another title or clear your search.' : 'Build a round, add a few questions, and get your friends competing.'}</p>{!search && <Link className="create-button" to="/quizzes/new">Create your first quiz <span>→</span></Link>}</div>}
      <div className="studio-foot"><span>✦ KEEP THE GOOD QUESTIONS COMING</span><span>QUIZBLITZ STUDIO · 2026</span></div>
    </section>
  </main>;
}
