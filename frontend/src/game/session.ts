// One attempt at a puzzle: the engine state plus everything around it — the recorded solution,
// per-piece undo points, timer, key count, and the finish / reset notifications.
// Framework-free; PuzzlePlayer subscribes to it with useSyncExternalStore.

import {
  Action, newGame, requirementsMet, step,
  type Board, type GameState, type Ledger, type LockEvent, type Requirements,
} from './engine';

/** The server rejects solutions longer than this. */
export const MAX_SOLUTION_LENGTH = 8192;

export interface SessionPuzzle {
  board: Board;
  /** client piece ids 1-7 */
  queue: readonly number[];
  /** 8-byte API format; [7] = NO HOLD */
  requirements: Requirements;
}

export interface SessionResult {
  success: boolean;
  solution: number[];
  ledger: Ledger;
  timeMs: number;
  keys: number;
  pieces: number;
}

export interface SessionSnapshot {
  game: GameState;
  /** the most recent lock, with a sequence number so repeated identical call-outs re-trigger;
   *  null after undo / restart */
  lock: { seq: number; event: LockEvent } | null;
  /** performance.now() of the first effective input, null until then */
  startedAt: number | null;
  /** performance.now() of the final lock, null while running */
  finishedAt: number | null;
  keys: number;
  /** actions recorded so far */
  moves: number;
  /** the solution hit MAX_SOLUTION_LENGTH; only undo / restart help now */
  atMoveLimit: boolean;
}

export interface SessionCallbacks {
  onFinish?: (result: SessionResult) => void;
  onReset?: () => void;
}

interface PieceStart {
  state: GameState;
  /** solution length when this piece became active */
  len: number;
}

export class PuzzleSession {
  readonly puzzle: SessionPuzzle;
  callbacks: SessionCallbacks = {};

  private now: () => number;
  private state!: GameState;
  private solution: number[] = [];
  /** starts[i] = the moment piece i (i = pieces placed so far) became active */
  private starts: PieceStart[] = [];
  private startedAt: number | null = null;
  private finishedAt: number | null = null;
  private keys = 0;
  private counted = new Set<number>();
  private lockSeq = 0;
  private lock: SessionSnapshot['lock'] = null;
  private finished = false;
  private snap!: SessionSnapshot;
  private listeners = new Set<() => void>();

  constructor(puzzle: SessionPuzzle, now: () => number = () => performance.now()) {
    this.puzzle = puzzle;
    this.now = now;
    this.reset();
    this.snap = this.makeSnapshot();
  }

  // useSyncExternalStore API ------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  getSnapshot = (): SessionSnapshot => this.snap;

  setCallbacks(callbacks: SessionCallbacks): void {
    this.callbacks = callbacks;
  }

  get game(): GameState {
    return this.state;
  }

  getSolution(): number[] {
    return this.solution.slice();
  }

  // actions -----------------------------------------------------------------

  /** Applies one engine action; records it and returns true if it did anything. */
  act(action: number, press?: number): boolean {
    if (this.state.status !== 'playing') return false;
    if (this.solution.length >= MAX_SOLUTION_LENGTH) return false;
    const next = step(this.state, action);
    if (next === this.state) return false;

    if (this.startedAt == null) this.startedAt = this.now();
    if (press != null && !this.counted.has(press)) {
      this.counted.add(press);
      this.keys++;
    }
    this.solution.push(action);
    this.state = next;

    if (action === Action.Hard) {
      this.lock = { seq: ++this.lockSeq, event: next.lastLock! };
      if (next.status === 'playing') this.starts.push({ state: next, len: this.solution.length });
    }

    if (next.status !== 'playing') {
      this.finished = true;
      this.finishedAt = this.now();
      this.emit();
      this.callbacks.onFinish?.(this.result());
      return true;
    }
    this.emit();
    return true;
  }

  /** Back to the start of the previously placed piece (its actions leave the solution). */
  undo(): void {
    const idx = Math.max(0, this.state.placed - 1);
    const target = this.starts[idx];
    if (!target) return;
    if (target.state === this.state && this.solution.length === target.len) return; // nothing to undo
    this.starts.length = idx + 1;
    this.solution.length = target.len;
    this.state = target.state;
    this.lock = null;
    this.unfinish();
    this.emit();
  }

  /** A fresh attempt: board, queue, timer and key count all reset. */
  restart(): void {
    const wasFinished = this.finished;
    const untouched = this.solution.length === 0 && this.startedAt == null;
    if (untouched && !wasFinished) return;
    this.reset();
    if (wasFinished) this.callbacks.onReset?.();
    this.emit();
  }

  result(): SessionResult {
    const s = this.state;
    const end = this.finishedAt ?? this.now();
    return {
      success: s.status === 'done' && requirementsMet(s.ledger, this.puzzle.requirements),
      solution: this.solution.slice(),
      ledger: s.ledger,
      timeMs: this.startedAt == null ? 0 : Math.max(0, Math.round(end - this.startedAt)),
      keys: this.keys,
      pieces: s.placed,
    };
  }

  // internals ---------------------------------------------------------------

  private reset(): void {
    const p = this.puzzle;
    this.state = newGame(p.board, p.queue, !!p.requirements[7]);
    this.solution = [];
    this.starts = [{ state: this.state, len: 0 }];
    this.startedAt = null;
    this.finishedAt = null;
    this.keys = 0;
    this.counted.clear();
    this.lock = null;
    this.finished = false;
  }

  private unfinish(): void {
    if (!this.finished) return;
    this.finished = false;
    this.finishedAt = null;
    this.callbacks.onReset?.();
  }

  private makeSnapshot(): SessionSnapshot {
    return {
      game: this.state,
      lock: this.lock,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      keys: this.keys,
      moves: this.solution.length,
      atMoveLimit: this.solution.length >= MAX_SOLUTION_LENGTH,
    };
  }

  private emit(): void {
    this.snap = this.makeSnapshot();
    for (const l of this.listeners) l();
  }
}
