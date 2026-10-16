import { useEffect, useState } from 'react';

export function useCountdown(endsAt, durationSeconds) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!endsAt) return undefined;
    const tick = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(tick);
  }, [endsAt]);
  const milliseconds = Math.max(0, endsAt - now);
  return {
    seconds: Math.ceil(milliseconds / 1000),
    progress: durationSeconds ? Math.min(1, milliseconds / (durationSeconds * 1000)) : 0,
  };
}
