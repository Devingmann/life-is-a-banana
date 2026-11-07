'use client';

import { useRef, useEffect } from 'react';

/**
 * Life is a Banana: The Cosmic Slip
 * ---------------------------------
 * The game is a self-contained vanilla ES6-module SPA (three.js + cannon-es)
 * served from /game/index.html. This page mounts it full-screen and keeps
 * keyboard focus inside the game frame so controls stay responsive.
 */
export default function Home() {
  const frameRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    // Re-focus the game frame whenever the user interacts with the outer page
    const focusGame = () => {
      try {
        frameRef.current?.contentWindow?.focus();
      } catch {
        // cross-origin safety — same origin here, but never crash
      }
    };
    window.addEventListener('mouseup', focusGame);
    return () => window.removeEventListener('mouseup', focusGame);
  }, []);

  return (
    <iframe
      ref={frameRef}
      src="/game/index.html"
      title="Life is a Banana: The Cosmic Slip"
      className="fixed inset-0 z-50 h-screen w-screen border-0 bg-black"
      allow="autoplay; fullscreen; gamepad"
      // Browser extensions (screenshotners, translators...) inject bis_* /
      // __processed_* attributes into the DOM before React hydrates, which
      // triggers a harmless-but-noisy hydration mismatch warning. Suppress it
      // on this leaf node — the game itself lives in a plain iframe.
      suppressHydrationWarning
    />
  );
}
