import { useRef, useEffect } from 'react';
import { DEFAULT_HANDLING, type Handling } from './keybindings';

export type DasDir = 'left' | 'right' | 'down';
type DasActions = Record<DasDir, () => void>;

/**
 * DAS/ARR auto-shift.
 *
 * Horizontal (left/right) behaves like standard Tetris: the two directions are
 * mutually exclusive and the *most recently pressed* one wins. Pressing the
 * opposite direction takes over immediately (cancelling the current repeat);
 * releasing the active direction falls back to the other one if it's still held.
 * A press does an initial move, waits DAS, then auto-repeats every ARR.
 *
 * Soft drop (down) repeats independently at ARR.
 *
 * NOTE: handling is currently locked to DEFAULT_HANDLING (the `handling` arg is
 * ignored for now) — see keybindings editor. Restore `handlingRef` use to make
 * DAS/ARR user-configurable again.
 */
export function useDasArr(actions: DasActions, _handling?: Handling) {
  // keep latest move closures so timers never act on stale state
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  // which of the keys are physically held right now
  const held = useRef({ left: false, right: false, down: false });
  // the horizontal direction currently auto-repeating (last press wins)
  const activeH = useRef<'left' | 'right' | null>(null);

  const hTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const dInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  function clearH() {
    if (hTimeout.current) clearTimeout(hTimeout.current);
    if (hInterval.current) clearInterval(hInterval.current);
    hTimeout.current = null;
    hInterval.current = null;
  }

  function clearD() {
    if (dInterval.current) clearInterval(dInterval.current);
    dInterval.current = null;
  }

  // (re)start horizontal auto-shift in `dir`: initial move, wait DAS, repeat every ARR
  function chargeH(dir: 'left' | 'right') {
    clearH();
    activeH.current = dir;
    const { das, arr } = DEFAULT_HANDLING;
    actionsRef.current[dir]();
    hTimeout.current = setTimeout(() => {
      hInterval.current = setInterval(() => {
        const d = activeH.current;
        if (d) actionsRef.current[d]();
      }, Math.max(arr, 1));
    }, Math.max(das, 0));
  }

  function start(dir: DasDir) {
    if (dir === 'down') {
      if (held.current.down) return; // ignore OS key-repeat / double fire
      held.current.down = true;
      clearD();
      actionsRef.current.down();
      dInterval.current = setInterval(() => actionsRef.current.down(), Math.max(DEFAULT_HANDLING.arr, 1));
      return;
    }
    if (held.current[dir]) return;
    held.current[dir] = true;
    chargeH(dir); // newest press takes over, cancelling the opposite direction
  }

  function stop(dir: DasDir) {
    if (dir === 'down') {
      held.current.down = false;
      clearD();
      return;
    }
    held.current[dir] = false;
    if (activeH.current === dir) {
      clearH();
      activeH.current = null;
      const other = dir === 'left' ? 'right' : 'left';
      if (held.current[other]) chargeH(other); // resume the still-held direction
    }
  }

  function stopAll() {
    clearH();
    clearD();
    held.current = { left: false, right: false, down: false };
    activeH.current = null;
  }

  useEffect(() => stopAll, []);

  return { start, stop, stopAll };
}
