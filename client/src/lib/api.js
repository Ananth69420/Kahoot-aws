const baseUrl = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

export async function apiRequest(path, options = {}) {
  let response;
  try {
    const token = localStorage.getItem('quizblitz-token');
    response = await fetch(`${baseUrl}${path.startsWith('/api/') ? path : `/api/${path}`}`, {
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new Error('Could not reach the QuizBlitz API. Check that the server is running.');
  }
  if (response.status === 401 && localStorage.getItem('quizblitz-token')) {
    localStorage.removeItem('quizblitz-token');
    localStorage.removeItem('quizblitz-user');
    window.location.assign('/login');
    throw new Error('Your session expired. Please log in again.');
  }
  const data = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || 'Request failed.');
  return data;
}

export function authRequest(path, payload) {
  return apiRequest(`/api/auth/${path}`, { method: 'POST', body: JSON.stringify(payload) });
}
