import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * ScrambleText - a "decode" effect: every letter starts as flickering random
 * characters, then the letters lock into place one by one, left to right.
 *
 *   <ScrambleText text="CodeCraft" />
 *   <ScrambleText text="CodeCraft" idleReplayMs={25000} letterClassName={(i) => (i < 4 ? 'text-navy' : 'text-orange')} />
 *
 * - Plays on mount; replays on hover (replayOnHover); optionally replays every
 *   idleReplayMs while the tab is visible (0 = off).
 * - No layout shift: each letter has a slot exactly as wide as its final
 *   letter (the real letter is there, invisible); the random character is
 *   drawn on top in a monospace font.
 * - Reduced motion: shows the text straight away, never animates.
 * - Screen readers only ever get `text`; the animated letters are hidden from them.
 */

const DEFAULT_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789#%&@$*+=?!<>/';
const FLICKER_MS = 45; // how often a still-scrambling letter changes

function prefersReducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export default function ScrambleText({
  text,
  duration = 1200,
  characters = DEFAULT_CHARS,
  replayOnHover = true,
  idleReplayMs = 0,
  className = '',
  letterClassName,
  scrambleClassName = 'opacity-55',
  as: Tag = 'span',
}) {
  const letters = [...String(text)];
  // null = settled (show the real letter); otherwise the random character shown now.
  const [shown, setShown] = useState(() => letters.map(() => null));
  const frameRef = useRef(0);
  const runningRef = useRef(false);

  const randomChar = useCallback(() => characters[Math.floor(Math.random() * characters.length)], [characters]);

  const play = useCallback(() => {
    if (runningRef.current || prefersReducedMotion() || !letters.length) return;
    runningRef.current = true;
    const start = performance.now();
    // Letter i locks in at lockAt[i]; the first one after a short all-scrambled moment.
    const lead = duration * 0.25;
    const step = (duration - lead) / letters.length;
    const lockAt = letters.map((_, i) => lead + step * (i + 1));
    let lastFlicker = 0;
    const tick = (now) => {
      const t = now - start;
      if (now - lastFlicker >= FLICKER_MS || t >= duration) {
        lastFlicker = now;
        setShown(letters.map((ch, i) => (t >= lockAt[i] || ch.trim() === '' ? null : randomChar())));
      }
      if (t < duration) {
        frameRef.current = requestAnimationFrame(tick);
      } else {
        setShown(letters.map(() => null));
        runningRef.current = false;
      }
    };
    frameRef.current = requestAnimationFrame(tick);
  }, [duration, letters.join(''), randomChar]); // eslint-disable-line react-hooks/exhaustive-deps

  // Play on mount (and when the text changes).
  useEffect(() => {
    play();
    return () => {
      cancelAnimationFrame(frameRef.current);
      runningRef.current = false;
    };
  }, [play]);

  // Optional soft replay while idle (only when the tab is visible).
  useEffect(() => {
    if (!idleReplayMs) return undefined;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') play();
    }, idleReplayMs);
    return () => clearInterval(id);
  }, [idleReplayMs, play]);

  return (
    <Tag className={`relative inline-block ${className}`} onMouseEnter={replayOnHover ? play : undefined}>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true" className="whitespace-pre">
        {letters.map((ch, i) => {
          const scramble = shown[i];
          const color = letterClassName ? letterClassName(i) : '';
          return (
            <span key={i} className={`relative inline-block ${color}`}>
              {/* The real letter always sets the slot width; hidden while scrambling. */}
              <span className={scramble === null ? '' : 'invisible'}>{ch}</span>
              {scramble !== null && (
                <span className={`absolute inset-0 flex items-center justify-center font-[var(--font-mono)] font-semibold text-[0.82em] ${scrambleClassName}`}>
                  {scramble}
                </span>
              )}
            </span>
          );
        })}
      </span>
    </Tag>
  );
}
