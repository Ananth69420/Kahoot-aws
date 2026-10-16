import { useEffect, useState } from 'react';

const preferenceKey = 'quizblitz-theme';

export default function ThemeToggle() {
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem(preferenceKey) === 'dark' ? 'dark' : 'light'; }
    catch { return 'light'; }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#201f2b' : '#faf8f1');
    try { localStorage.setItem(preferenceKey, theme); } catch { /* Keep the in-memory selection if storage is disabled. */ }
  }, [theme]);

  const dark = theme === 'dark';
  return <button className="theme-toggle" type="button" onClick={() => setTheme(dark ? 'light' : 'dark')} aria-label={`Switch to ${dark ? 'light' : 'dark'} theme`} aria-pressed={dark} title={`Switch to ${dark ? 'light' : 'dark'} theme`}>
    <span className="theme-toggle-icon" aria-hidden="true">{dark ? '☀' : '☾'}</span><span className="theme-toggle-label">{dark ? 'LIGHT' : 'DARK'}</span>
  </button>;
}
