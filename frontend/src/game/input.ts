// Keyboard (and touch-button) input → engine actions, with jstris-style handling.
//
// Framework-free: the controller owns key state and the auto-repeat loop, and talks to the game
// through a tiny InputTarget. Time comes from an injectable clock so the DAS / ARR / soft drop
// timing can be unit-tested without a browser.
//
// Behaviour:
// - rotations / hold / hard drop / undo / restart fire on keydown only (OS auto-repeat ignored)
// - left/right: immediate move on press, then after DAS repeat every ARR (ARR 0 = straight to
//   the wall). The most recently pressed direction wins; releasing it falls back to the other
//   one if that's still held (as a fresh press).
// - DAS charge survives piece changes: holding a direction through a lock / hold moves the new
//   piece immediately once charged (to the wall with ARR 0), like jstris.
// - soft drop: one row on press, then one row every `softDrop` ms (0 = instantly to the floor,
//   and it keeps the piece on the floor while held).
// - every effective move goes to the target as one engine action; the target reports whether it
//   did anything (the engine returns the same state object for no-ops) so instant moves know
//   when to stop.

import { Action } from './engine';
import {
  BINDING_ACTIONS, baseKey, keySig, normKey,
  type BindingAction, type Bindings, type Handling,
} from '../keybindings';

export interface InputClock {
  now(): number;
  requestFrame(cb: () => void): number;
  cancelFrame(id: number): void;
}

export const browserClock: InputClock = {
  now: () => performance.now(),
  requestFrame: cb => requestAnimationFrame(cb),
  cancelFrame: id => cancelAnimationFrame(id),
};

export interface InputTarget {
  /**
   * Apply one engine action. Return true if it changed the game, false if it was a no-op
   * (blocked, game over, …). `press` identifies the key press that caused it (auto-repeats
   * share their key's id) — handy for counting "keys that did something".
   */
  act(action: Action, press: number): boolean;
  undo?(): void;
  restart?(): void;
}

/** The parts of a KeyboardEvent the controller looks at (plain objects work in tests). */
export interface KeyEventLike {
  key: string;
  code?: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  repeat?: boolean;
  isComposing?: boolean;
  /** already handled by someone else (e.g. the editor's ⌘⇧Z redo) */
  defaultPrevented?: boolean;
  target?: unknown;
  preventDefault?(): void;
}

const HELD_COMMANDS = ['left', 'right', 'softDrop'] as const;
type HeldCommand = typeof HELD_COMMANDS[number];
type Dir = 'left' | 'right';

/** Most auto-repeat moves applied in one frame while catching up (ARR > 0). */
const MAX_CATCHUP = 20;
/** Cap for "instant" moves (ARR 0 / soft drop 0) — more than the board is wide or tall. */
const MAX_INSTANT = 32;

/** Keys typed into form fields or inside a modal never drive the game. */
export function isTypingTarget(t: unknown): boolean {
  if (!t || typeof t !== 'object') return false;
  const el = t as { tagName?: string; isContentEditable?: boolean; closest?: (sel: string) => unknown };
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  return typeof el.closest === 'function' && el.closest('.modal-overlay') != null;
}

const DISCRETE: Partial<Record<BindingAction, Action>> = {
  rotateCw: Action.Cw,
  rotateCcw: Action.Ccw,
  rotate180: Action.Rot180,
  hold: Action.Hold,
  place: Action.Hard,
};

export interface InputControllerOptions {
  bindings: Bindings;
  handling: Handling;
  clock?: InputClock;
}

export class InputController {
  private target: InputTarget | null;
  private bindings!: Bindings;
  private handling: Handling;
  private clock: InputClock;
  private disabled = false;
  private keyMap = new Map<string, BindingAction>();

  // physical state of the held commands
  private held: Record<HeldCommand, boolean> = { left: false, right: false, softDrop: false };
  private heldCode: Record<HeldCommand, string | null> = { left: null, right: null, softDrop: null };
  private heldPress: Record<HeldCommand, number> = { left: 0, right: 0, softDrop: 0 };

  // horizontal auto-shift: the active direction, when its DAS started charging, next ARR repeat
  private dir: Dir | null = null;
  private dasStart = 0;
  private nextRepeat = 0;
  // soft drop repeat
  private nextSoft = 0;

  private pressSeq = 0;
  private frame: number | null = null;

  constructor(target: InputTarget | null, opts: InputControllerOptions) {
    this.target = target;
    this.handling = opts.handling;
    this.clock = opts.clock ?? browserClock;
    this.setBindings(opts.bindings);
  }

  // -------------------------------------------------------------------------
  // configuration
  // -------------------------------------------------------------------------

  setTarget(target: InputTarget | null): void {
    this.target = target;
  }

  setBindings(bindings: Bindings): void {
    if (this.bindings) this.releaseAll(); // keyups might not match the new bindings
    this.bindings = bindings;
    this.keyMap.clear();
    for (const a of BINDING_ACTIONS) {
      const sig = bindings[a];
      if (sig && !this.keyMap.has(sig)) this.keyMap.set(sig, a);
    }
  }

  setHandling(handling: Handling): void {
    this.handling = handling;
  }

  setDisabled(disabled: boolean): void {
    if (disabled === this.disabled) return;
    this.disabled = disabled;
    if (disabled) this.releaseAll();
  }

  // -------------------------------------------------------------------------
  // DOM wiring
  // -------------------------------------------------------------------------

  /** Listens on the window; returns a detach function. */
  attach(win: Window = window): () => void {
    const down = (e: KeyboardEvent) => { this.handleKeyDown(e); };
    const up = (e: KeyboardEvent) => this.handleKeyUp(e);
    const blur = () => this.releaseAll();
    const vis = () => { if (win.document.visibilityState !== 'visible') this.releaseAll(); };
    win.addEventListener('keydown', down);
    win.addEventListener('keyup', up);
    win.addEventListener('blur', blur);
    win.document.addEventListener('visibilitychange', vis);
    return () => {
      win.removeEventListener('keydown', down);
      win.removeEventListener('keyup', up);
      win.removeEventListener('blur', blur);
      win.document.removeEventListener('visibilitychange', vis);
      this.releaseAll();
    };
  }

  /** Returns true when the event was a game key (and its default was prevented). */
  handleKeyDown(e: KeyEventLike): boolean {
    if (e.isComposing || e.defaultPrevented || this.disabled || isTypingTarget(e.target)) return false;
    const cmd = this.keyMap.get(keySig({ key: e.key, metaKey: !!e.metaKey, ctrlKey: !!e.ctrlKey }));
    if (!cmd) return false;
    e.preventDefault?.(); // space / arrows must never scroll the page
    if (e.repeat) return true; // we do our own repeat
    this.press(cmd, e.code);
    return true;
  }

  handleKeyUp(e: KeyEventLike): void {
    // macOS doesn't send keyups for keys released while ⌘ is down: let go of everything
    if (e.key === 'Meta') { this.releaseAll(); return; }
    const k = normKey(e.key);
    for (const cmd of HELD_COMMANDS) {
      if (!this.held[cmd]) continue;
      const b = this.bindings[cmd];
      // match the base key (a modifier may have changed since keydown) or the physical key
      if ((b && normKey(baseKey(b)) === k) || (e.code && e.code === this.heldCode[cmd])) {
        this.release(cmd);
      }
    }
  }

  // -------------------------------------------------------------------------
  // commands (keyboard and on-screen buttons both end up here)
  // -------------------------------------------------------------------------

  press(cmd: BindingAction, code?: string): void {
    if (this.disabled) return;
    const now = this.clock.now();
    if (cmd === 'left' || cmd === 'right' || cmd === 'softDrop') {
      if (this.held[cmd]) return;
      this.held[cmd] = true;
      this.heldCode[cmd] = code ?? null;
      this.heldPress[cmd] = ++this.pressSeq;
      if (cmd === 'softDrop') this.startSoft(now);
      else this.startShift(cmd, now);
      this.settle(now, false);
      this.ensureLoop();
      return;
    }
    const press = ++this.pressSeq;
    const action = DISCRETE[cmd];
    if (action != null) {
      if (this.target?.act(action, press)) {
        this.settle(now, action === Action.Hard || action === Action.Hold);
      }
      return;
    }
    if (cmd === 'undo') this.target?.undo?.();
    else if (cmd === 'restart') this.target?.restart?.();
    // a brand-new piece: a held direction has to charge again
    this.rearm(now);
  }

  release(cmd: BindingAction): void {
    if (cmd !== 'left' && cmd !== 'right' && cmd !== 'softDrop') return;
    if (!this.held[cmd]) return;
    this.held[cmd] = false;
    this.heldCode[cmd] = null;
    if (cmd === 'softDrop' || this.dir !== cmd) return;
    const other: Dir = cmd === 'left' ? 'right' : 'left';
    if (this.held[other]) {
      const now = this.clock.now();
      this.startShift(other, now);
      this.settle(now, false);
    } else {
      this.dir = null;
    }
  }

  releaseAll(): void {
    this.held = { left: false, right: false, softDrop: false };
    this.heldCode = { left: null, right: null, softDrop: null };
    this.dir = null;
    if (this.frame != null) {
      this.clock.cancelFrame(this.frame);
      this.frame = null;
    }
  }

  dispose(): void {
    this.releaseAll();
    this.target = null;
  }

  /** Applies whatever auto-repeat is due. Runs every animation frame while a key is held. */
  tick(now: number = this.clock.now()): void {
    if (this.disabled) return;
    this.autoShift(now);
    this.autoSoft(now);
  }

  /** Whether a direction / soft drop is currently held (for tests and debugging). */
  isHeld(cmd: HeldCommand): boolean {
    return this.held[cmd];
  }

  // -------------------------------------------------------------------------
  // internals
  // -------------------------------------------------------------------------

  private act(action: Action, press: number): boolean {
    return this.target?.act(action, press) ?? false;
  }

  private shift(): boolean {
    const d = this.dir;
    if (!d) return false;
    return this.act(d === 'left' ? Action.Left : Action.Right, this.heldPress[d]);
  }

  private shiftToWall(): void {
    for (let i = 0; i < MAX_INSTANT && this.shift(); i++) { /* keep going */ }
  }

  private softToFloor(): void {
    for (let i = 0; i < MAX_INSTANT && this.act(Action.Soft, this.heldPress.softDrop); i++) { /* keep going */ }
  }

  private charged(now: number): boolean {
    return this.dir != null && now >= this.dasStart + this.handling.das;
  }

  private startShift(d: Dir, now: number): void {
    this.dir = d;
    this.dasStart = now;
    // repeats land at dasStart + das + k*arr; with DAS 0 the press itself is the first move
    this.nextRepeat = now + this.handling.das + (this.handling.das <= 0 ? this.handling.arr : 0);
    this.shift();
    this.autoShift(now); // DAS 0
  }

  private startSoft(now: number): void {
    const sd = this.handling.softDrop;
    if (sd <= 0) {
      this.softToFloor();
    } else {
      this.act(Action.Soft, this.heldPress.softDrop);
      this.nextSoft = now + sd;
    }
  }

  private autoShift(now: number): void {
    if (!this.charged(now)) return;
    const arr = this.handling.arr;
    if (arr <= 0) {
      this.shiftToWall();
      return;
    }
    let n = 0;
    while (now >= this.nextRepeat && n < MAX_CATCHUP) {
      this.shift();
      this.nextRepeat += arr;
      n++;
    }
    if (now >= this.nextRepeat) this.nextRepeat = now + arr; // way behind (frozen tab): drop backlog
  }

  private autoSoft(now: number): void {
    if (!this.held.softDrop) return;
    const sd = this.handling.softDrop;
    if (sd <= 0) {
      this.softToFloor();
      return;
    }
    let n = 0;
    while (now >= this.nextSoft && n < MAX_CATCHUP) {
      this.act(Action.Soft, this.heldPress.softDrop);
      this.nextSoft += sd;
      n++;
    }
    if (now >= this.nextSoft) this.nextSoft = now + sd;
  }

  /**
   * After a discrete action: re-apply the "instant" held inputs right away (so an ARR-0
   * direction or instant soft drop keeps the piece pinned, without waiting a frame), and on a
   * fresh piece let a charged direction move it immediately (DAS carry-over).
   */
  private settle(now: number, spawned: boolean): void {
    if (this.charged(now)) {
      if (this.handling.arr <= 0) {
        this.shiftToWall();
      } else if (spawned) {
        this.shift();
        this.nextRepeat = now + this.handling.arr;
      }
    }
    if (this.held.softDrop && this.handling.softDrop <= 0) this.softToFloor();
  }

  private rearm(now: number): void {
    if (this.dir) {
      this.dasStart = now;
      this.nextRepeat = now + this.handling.das + (this.handling.das <= 0 ? this.handling.arr : 0);
    }
    this.nextSoft = now + this.handling.softDrop;
  }

  private ensureLoop(): void {
    if (this.frame != null) return;
    if (!this.held.left && !this.held.right && !this.held.softDrop) return;
    this.frame = this.clock.requestFrame(this.onFrame);
  }

  private onFrame = (): void => {
    this.frame = null;
    this.tick();
    this.ensureLoop();
  };
}
