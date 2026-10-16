import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { apiRequest } from './lib/api.js';
import ThemeToggle from './ThemeToggle.jsx';

const blankQuestion = () => ({ text: '', options: ['', ''], correctOption: 0, timeLimitSeconds: 20, pointsMode: 'standard' });
const blankQuiz = { title: '', coverImageUrl: '', questions: [blankQuestion()] };
const colors = ['#ff596b', '#548aff', '#f6c848', '#42c88a'];

export default function QuizEditor() {
  const { quizId } = useParams();
  const editing = Boolean(quizId);
  const navigate = useNavigate();
  const [quiz, setQuiz] = useState(blankQuiz);
  const [loading, setLoading] = useState(editing);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!editing) return;
    apiRequest(`/api/quizzes/${quizId}`).then(({ quiz: savedQuiz }) => setQuiz({
      title: savedQuiz.title,
      coverImageUrl: savedQuiz.coverImageUrl || '',
      questions: savedQuiz.questions.map((question) => ({ ...question })),
    })).catch((loadError) => setError(loadError.message)).finally(() => setLoading(false));
  }, [editing, quizId]);

  function updateQuiz(field, value) { setQuiz((current) => ({ ...current, [field]: value })); }
  function updateQuestion(index, field, value) {
    setQuiz((current) => ({ ...current, questions: current.questions.map((question, i) => i === index ? { ...question, [field]: value } : question) }));
  }
  function updateOption(questionIndex, optionIndex, value) {
    setQuiz((current) => ({ ...current, questions: current.questions.map((question, i) => i === questionIndex ? { ...question, options: question.options.map((option, j) => j === optionIndex ? value : option) } : question) }));
  }
  function removeOption(questionIndex, optionIndex) {
    setQuiz((current) => ({ ...current, questions: current.questions.map((question, i) => {
      if (i !== questionIndex) return question;
      const options = question.options.filter((_, j) => j !== optionIndex);
      let correctOption = question.correctOption;
      if (correctOption === optionIndex) correctOption = 0;
      else if (correctOption > optionIndex) correctOption -= 1;
      return { ...question, options, correctOption };
    }) }));
  }
  function removeQuestion(index) { setQuiz((current) => ({ ...current, questions: current.questions.filter((_, i) => i !== index) })); }

  async function handleSubmit(event) {
    event.preventDefault();
    if (saving) return;
    setSaving(true); setError('');
    const payload = { ...quiz, coverImageUrl: quiz.coverImageUrl.trim() || null,
      questions: quiz.questions.map(({ text, options, correctOption, timeLimitSeconds, pointsMode }) => ({
        text, options, correctOption: Number(correctOption), timeLimitSeconds: Number(timeLimitSeconds), pointsMode,
      })) };
    try {
      const result = await apiRequest(editing ? `/api/quizzes/${quizId}` : '/api/quizzes', {
        method: editing ? 'PUT' : 'POST', body: JSON.stringify(payload),
      });
      navigate('/dashboard', { state: { toast: editing ? 'Quiz changes saved.' : 'Your quiz is ready.' } });
    } catch (saveError) {
      setError(saveError.message);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally { setSaving(false); }
  }

  if (loading) return <main className="host-dashboard"><div className="editor-loading"><div className="quiz-skeleton" /><p>Loading your quiz…</p></div></main>;
  return <main className="host-dashboard">
    <header className="dash-nav"><Link className="brand" to="/">✦ QuizBlitz</Link><div className="editor-nav-actions"><ThemeToggle /><Link className="back-link" to="/dashboard">← Back to studio</Link></div></header>
    <form className="editor-content" onSubmit={handleSubmit}>
      <div className="editor-heading"><div className="eyebrow"><span className="live-dot" /> QUIZ BUILDER</div><h1>{editing ? 'Tune your quiz.' : 'Set the room on fire.'}</h1><p>Make a great title, then stack the questions.</p></div>
      {error && <div className="form-error dashboard-error" role="alert">{error}</div>}
      <section className="quiz-details editor-panel"><div className="panel-heading"><div><span className="step-no">01</span><div><h2>Set the scene</h2><p>Give your quiz a title players remember.</p></div></div></div>
        <label className="field-label">QUIZ TITLE<input value={quiz.title} onChange={(event) => updateQuiz('title', event.target.value)} placeholder="e.g. The ultimate movie night" minLength="1" maxLength="120" required /></label>
        <label className="field-label">COVER IMAGE URL <span className="optional">OPTIONAL</span><input type="url" value={quiz.coverImageUrl} onChange={(event) => updateQuiz('coverImageUrl', event.target.value)} placeholder="https://example.com/your-image.jpg" maxLength="2048" /></label>
      </section>
      <div className="questions-title"><div><span className="step-no">02</span><div><h2>Write the questions</h2><p>{quiz.questions.length} of 50 questions</p></div></div><button className="add-question" type="button" disabled={quiz.questions.length >= 50} onClick={() => setQuiz((current) => ({ ...current, questions: [...current.questions, blankQuestion()] }))}>＋ Add question</button></div>
      {quiz.questions.map((question, questionIndex) => <section className="editor-panel question-panel" key={question.id || questionIndex}>
        <div className="question-panel-head"><span className="question-chip">QUESTION {String(questionIndex + 1).padStart(2, '0')}</span>{quiz.questions.length > 1 && <button className="remove-question" type="button" onClick={() => removeQuestion(questionIndex)}>Remove</button>}</div>
        <label className="field-label">QUESTION TEXT<textarea value={question.text} onChange={(event) => updateQuestion(questionIndex, 'text', event.target.value)} placeholder="What do you want to ask?" maxLength="300" required rows="2" /></label>
        <div className="answers-header"><span className="field-label-title">ANSWER OPTIONS</span><span className="answer-hint">Select the correct answer</span></div>
        <div className="answer-editor-grid">{question.options.map((option, optionIndex) => <div className="answer-edit" key={optionIndex} style={{ '--answer-color': colors[optionIndex] }}>
          <span className="answer-marker" aria-hidden="true" />
          <input aria-label={`Question ${questionIndex + 1}, answer ${optionIndex + 1}`} value={option} onChange={(event) => updateOption(questionIndex, optionIndex, event.target.value)} maxLength="120" placeholder={`Answer ${optionIndex + 1}`} required />
          <label title="Mark as correct"><input type="radio" aria-label={`Mark answer ${optionIndex + 1} as correct`} name={`correct-${questionIndex}`} checked={question.correctOption === optionIndex} onChange={() => updateQuestion(questionIndex, 'correctOption', optionIndex)} /><span>{question.correctOption === optionIndex ? '✓' : ''}</span></label>
          {question.options.length > 2 && <button type="button" aria-label={`Remove answer ${optionIndex + 1}`} onClick={() => removeOption(questionIndex, optionIndex)}>×</button>}
        </div>)}</div>
        {question.options.length < 4 && <button className="add-option" type="button" onClick={() => updateQuestion(questionIndex, 'options', [...question.options, ''])}>＋ Add answer option</button>}
        <div className="question-settings"><label className="field-label">TIME LIMIT<select value={question.timeLimitSeconds} onChange={(event) => updateQuestion(questionIndex, 'timeLimitSeconds', Number(event.target.value))}>{[5, 10, 15, 20, 30, 45, 60].map((seconds) => <option key={seconds} value={seconds}>{seconds} seconds</option>)}</select></label>
          <label className="field-label">POINTS<select value={question.pointsMode} onChange={(event) => updateQuestion(questionIndex, 'pointsMode', event.target.value)}><option value="standard">Standard</option><option value="double">Double points</option><option value="none">No points</option></select></label></div>
      </section>)}
      <div className="editor-footer"><Link className="cancel-edit" to="/dashboard">Cancel</Link><span className="save-note">Changes save to your quiz library</span><button className="create-button" type="submit" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Create quiz'} <span>→</span></button></div>
    </form>
  </main>;
}
