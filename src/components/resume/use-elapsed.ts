"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * A seconds counter for long actions. Tailoring takes 20-40 seconds; a label that counts
 * tells you it's working, where a static spinner that long reads as hung.
 *
 * The clock lives in here — `start()` and `stop()` are called from event handlers — so no
 * component reads the time during render, and nothing sets state synchronously inside an
 * effect (only the interval callback does).
 */
export function useElapsed(): { seconds: number; running: boolean; start: () => void; stop: () => void } {
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);

  useEffect(() => {
    if (startedAt === null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);

  const start = useCallback(() => {
    const t = Date.now();
    setStartedAt(t);
    setNow(t);
  }, []);
  const stop = useCallback(() => setStartedAt(null), []);

  return {
    seconds: startedAt === null ? 0 : Math.max(0, Math.round((now - startedAt) / 1000)),
    running: startedAt !== null,
    start,
    stop,
  };
}
