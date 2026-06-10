import { useRef, useEffect } from 'react';

// Guideline-style handling: DAS (delayed auto shift) then ARR (auto repeat rate).
const DAS = 150;  // ms before auto-repeat kicks in
const ARR = 30;   // ms between repeats while held
const SDR = 30;   // soft drop repeat rate

export function useDasArr(actions) {
  // keep latest move closures so timers never act on stale state
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  const timers = useRef({});

  function start(dir) {
    if (timers.current[dir]) return; // already held
    actionsRef.current[dir]();
    const delay = dir === 'down' ? SDR : DAS;
    const rate  = dir === 'down' ? SDR : ARR;
    const timeout = setTimeout(() => {
      timers.current[dir].interval = setInterval(() => actionsRef.current[dir](), rate);
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
