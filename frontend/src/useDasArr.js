import { useRef, useEffect } from 'react';
import { DEFAULT_HANDLING } from './keybindings';

// Guideline-style handling: DAS (delayed auto shift) then ARR (auto repeat rate).
// Soft drop repeats at ARR with no initial delay.
export function useDasArr(actions, handling) {
  // keep latest move closures / settings so timers never act on stale state
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  const handlingRef = useRef(handling);
  handlingRef.current = handling;

  const timers = useRef({});

  function start(dir) {
    if (timers.current[dir]) return; // already held
    const { das, arr } = { ...DEFAULT_HANDLING, ...handlingRef.current };
    actionsRef.current[dir]();
    const delay = dir === 'down' ? arr : das;
    const timeout = setTimeout(() => {
      timers.current[dir].interval = setInterval(() => actionsRef.current[dir](), arr);
    }, delay);
    timers.current[dir] = { timeout, interval: null };
  }

  function stop(dir) {
    const t = timers.current[dir];
    if (t) {
      clearTimeout(t.timeout);
      if (t.interval) clearInterval(t.interval);
    }
    timers.current[dir] = null;
  }

  function stopAll() {
    ['left', 'right', 'down'].forEach(stop);
  }

  useEffect(() => stopAll, []);

  return { start, stop, stopAll };
}
