// Keyboard "stamping" for the board editor: walk the puzzle's queue with the normal controls
// and hard-drop pieces onto the board as coloured cells. Uses the real engine for movement /
// rotation / hold, but a stamp that would complete a row (or poke into the hidden spawn row)
// is refused — an editor board must stay a valid puzzle board.

import {
  Action, dropRow, fits, newGame, pieceCells, spawnCol, step,
  type Board, type CellPos, type GameState,
} from './engine';

export type StampResult =
  | { ok: true; board: Board }
  | { ok: false; cells: CellPos[] };

export class StampFlow {
  readonly queue: readonly number[];
  private state: GameState | null;
  private listeners = new Set<() => void>();

  constructor(board: Board, queue: readonly number[]) {
    this.queue = queue;
    this.state = queue.length ? newGame(board, queue) : null;
  }

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => { this.listeners.delete(l); };
  };

  getSnapshot = (): GameState | null => this.state;

  /** The board changed under us (painting, undo…): keep the piece where it is if it still fits. */
  setBoard(board: Board): void {
    const s = this.state;
    if (!s || s.board === board) return;
    let next: GameState = { ...s, board };
    const a = s.active;
    if (a && !fits(board, a.piece, a.rot, a.row, a.col)) {
      const col = spawnCol(a.piece);
      next = fits(board, a.piece, 0, 0, col)
        ? { ...next, active: { piece: a.piece, rot: 0, row: 0, col }, lastRotate: false }
        : next;
    }
    if (next.status === 'topout' && this.queue.length) {
      // there may be room again
      const fresh = newGame(board, this.queue);
      if (fresh.status === 'playing') next = fresh;
    }
    this.state = next;
    this.emit();
  }

  /** Puts back a snapshot taken with getSnapshot() (undo / redo of a stamp). */
  restore(state: GameState | null): void {
    if (state === this.state) return;
    this.state = state;
    this.emit();
  }

  /** Back to the first queue piece. */
  restart(board: Board): void {
    this.state = this.queue.length ? newGame(board, this.queue) : null;
    this.emit();
  }

  /** Movement / rotation / hold. Returns whether anything changed. */
  act(action: number): boolean {
    const s = this.state;
    if (!s || action === Action.Hard) return false;
    const n = step(s, action);
    if (n === s) return false;
    this.state = n;
    this.emit();
    return true;
  }

  /** Hard drop: the new board, or the cells that were refused. */
  stamp(): StampResult | null {
    const s = this.state;
    if (!s || !s.active) return null;
    const a = s.active;
    const land = dropRow(s.board, a.piece, a.rot, a.row, a.col);
    const cells = pieceCells(a.piece, a.rot, land, a.col);
    const n = step(s, Action.Hard);
    if (n === s) return null;
    if (n.ledger.lines > s.ledger.lines || n.board[0].some(v => v !== 0)) {
      return { ok: false, cells };
    }
    // ran out of pieces: start the queue over so you can keep building
    this.state = n.status === 'done' ? newGame(n.board, this.queue) : n;
    this.emit();
    return { ok: true, board: n.board };
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
}
