import { useRef, useEffect } from 'react';
import { DEFAULT_HANDLING, type Handling } from './keybindings';

export type DasDir = 'left' | 'right' | 'down';
type DasActions = Record<DasDir, () => void>;
type DirTimers = { timeout: ReturnType<typeof setTimeout>; interval: ReturnType<typeof setInterval> | null };

export function useDasArr(actions: DasActions, handling?: Handling) {
  // keep latest move closures / settings so timers never act on stale state
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  const handlingRef = useRef(handling);
  handlingRef.current = handling;

  const timers = useRef<Partial<Record<DasDir, DirTimers | null>>>({});

  function start(dir: DasDir) {
    if (timers.current[dir]) return; // already held
    const { das, arr } = { ...DEFAULT_HANDLING, ...handlingRef.current };
    actionsRef.current[dir]();
    const delay = dir === 'down' ? arr : das;
    const timeout = setTimeout(() => {
      const t = timers.current[dir];
      if (t) t.interval = setInterval(() => actionsRef.current[dir](), arr);
    }, delay);
    timers.current[dir] = { timeout, interval: null };
  }

  function stop(dir: DasDir) {
    const t = timers.current[dir];
    if (t) {
      clearTimeout(t.timeout);
      if (t.interval) clearInterval(t.interval);
    }
    timers.current[dir] = null;
  }

  function stopAll() {
    (['left', 'right', 'down'] as DasDir[]).forEach(stop);
  }

  useEffect(() => stopAll, []);

  return { start, stop, stopAll };
}
