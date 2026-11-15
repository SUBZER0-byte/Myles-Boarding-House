import { useCallback, useEffect, useState } from "react";

const INDEX_KEY = "authSlideIndex";
const PAUSED_KEY = "authSlidePausedUntil";
const INTERVAL_MS = 4000;
// Pause briefly across navigations so the image doesn't change at the same
// time as the form swap animation.
const NAV_PAUSE_MS = 1500;

/**
 * Shared slideshow state for the auth pages (Login / SignUp).
 * - Persists the current slide index in sessionStorage so the image doesn't
 *   reset to slide 0 when navigating between /login and /signup.
 * - Pauses auto-rotation for a short window after unmount, so the image
 *   stays still while the form transitions.
 */
export const useAuthSlideshow = (slideCount: number) => {
  const [currentSlide, setCurrentSlideState] = useState<number>(() => {
    if (typeof window === "undefined") return 0;
    const saved = sessionStorage.getItem(INDEX_KEY);
    const n = saved ? Number(saved) : 0;
    return Number.isFinite(n) && n >= 0 && n < slideCount ? n : 0;
  });

  const setCurrentSlide = useCallback((next: number | ((prev: number) => number)) => {
    setCurrentSlideState((prev) => {
      const value = typeof next === "function" ? (next as (p: number) => number)(prev) : next;
      sessionStorage.setItem(INDEX_KEY, String(value));
      return value;
    });
  }, []);

  const advance = useCallback(() => {
    setCurrentSlide((prev) => (prev + 1) % slideCount);
  }, [slideCount, setCurrentSlide]);

  useEffect(() => {
    const pausedUntil = Number(sessionStorage.getItem(PAUSED_KEY) || 0);
    const remainingPause = Math.max(0, pausedUntil - Date.now());
    let interval: ReturnType<typeof setInterval> | undefined;

    const initial = setTimeout(() => {
      interval = setInterval(advance, INTERVAL_MS);
    }, remainingPause + INTERVAL_MS);

    return () => {
      clearTimeout(initial);
      if (interval) clearInterval(interval);
      // Pause auto-rotation briefly to cover the next page's mount + transition.
      sessionStorage.setItem(PAUSED_KEY, String(Date.now() + NAV_PAUSE_MS));
    };
  }, [advance]);

  return { currentSlide, setCurrentSlide };
};
