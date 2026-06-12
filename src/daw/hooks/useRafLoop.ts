import { useEffect, useRef } from "react";

// Runs fn() every animation frame, with a fallback interval so a throttled or
// hidden tab (where rAF is suspended) still ticks. Ported from daw-ui.jsx.
export function useRafLoop(fn: () => void) {
  const fnRef = useRef(fn);
  // keep the latest callback without re-subscribing the rAF loop
  useEffect(() => {
    fnRef.current = fn;
  });
  useEffect(() => {
    let id = 0;
    let lastRaf = 0;
    const loop = () => {
      lastRaf = performance.now();
      fnRef.current();
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    const iv = window.setInterval(() => {
      if (performance.now() - lastRaf > 300) fnRef.current();
    }, 120);
    return () => {
      cancelAnimationFrame(id);
      clearInterval(iv);
    };
  }, []);
}
