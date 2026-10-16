import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const musicNotes = [392, 494, 587, 494, 440, 523, 659, 523];

export function useGameAudio({ lobby = false } = {}) {
  const contextRef = useRef(null);
  const noteRef = useRef(0);
  const [enabled, setEnabled] = useState(() => localStorage.getItem('quizblitz-sound-enabled') === 'true');

  const context = useCallback(() => {
    if (!contextRef.current) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) contextRef.current = new AudioContextClass();
    }
    return contextRef.current;
  }, []);

  const tone = useCallback((frequency, start, duration, wave = 'sine', volume = 0.06) => {
    const audio = context();
    if (!audio) return;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = wave;
    oscillator.frequency.setValueAtTime(frequency, audio.currentTime + start);
    gain.gain.setValueAtTime(0.0001, audio.currentTime + start);
    gain.gain.exponentialRampToValueAtTime(volume, audio.currentTime + start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + start + duration);
    oscillator.connect(gain);
    gain.connect(audio.destination);
    oscillator.start(audio.currentTime + start);
    oscillator.stop(audio.currentTime + start + duration + 0.02);
  }, [context]);

  const play = useCallback((sound) => {
    if (!enabled) return;
    const audio = context();
    if (audio?.state === 'suspended') audio.resume().catch(() => {});
    const notes = {
      tick: [[880, 0, 0.065, 'sine', 0.035]],
      correct: [[523, 0, 0.14, 'sine', 0.07], [659, 0.09, 0.18, 'sine', 0.07], [784, 0.18, 0.25, 'sine', 0.07]],
      wrong: [[247, 0, 0.2, 'triangle', 0.065], [196, 0.13, 0.25, 'triangle', 0.055]],
      podium: [[523, 0, 0.2, 'sine', 0.06], [659, 0.12, 0.2, 'sine', 0.06], [784, 0.24, 0.2, 'sine', 0.06], [1047, 0.38, 0.4, 'sine', 0.06]],
      lobby: [[musicNotes[noteRef.current++ % musicNotes.length], 0, 0.6, 'sine', 0.018]],
    };
    (notes[sound] || []).forEach(([frequency, start, duration, wave, volume]) => tone(frequency, start, duration, wave, volume));
  }, [enabled, context, tone]);

  const toggle = useCallback(() => {
    const next = !enabled;
    if (next) context()?.resume().catch(() => {});
    localStorage.setItem('quizblitz-sound-enabled', String(next));
    setEnabled(next);
  }, [context, enabled]);

  useEffect(() => {
    if (!enabled || !lobby) return undefined;
    play('lobby');
    const timer = window.setInterval(() => play('lobby'), 2400);
    return () => window.clearInterval(timer);
  }, [enabled, lobby, play]);

  useEffect(() => () => { contextRef.current?.close(); contextRef.current = null; }, []);

  return useMemo(() => ({ enabled, toggle, play }), [enabled, toggle, play]);
}
