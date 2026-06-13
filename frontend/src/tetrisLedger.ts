import { BOARD_COLS, BOARD_ROWS, EMPTY, type Board } from './tetrisUtils';

// Mirrors of the circuit's tables (crates/circuit/src/lib.rs)
export const ATTACK_TABLE = [0, 0, 1, 2, 4];
export const TSPIN_REWARD = [0, 2, 3, 4, 0];
export const COMBO_TABLE = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5];

/** Frontend mirror of the circuit's ledger (lock_piece). */
export interface Ledger {
  tss: number;
  tsd: number;
  tst: number;
  tetris: number;
  pc: number;
  attack: number;
  maxCombo: number;
  heldUsed: boolean;
  combo: number;
  b2b: number;
}

/** tss, tsd, tst, tetris, pc, attack, max_combo, no_hold — same as the circuit. */
export type Requirements = number[];

export function emptyLedger(): Ledger {
  return {
    tss: 0, tsd: 0, tst: 0, tetris: 0, pc: 0,
    attack: 0, maxCombo: 0, heldUsed: false,
    combo: 0, b2b: 0,
  };
}

function blocked(board: Board, row: number, col: number): boolean {
  if (row < 0 || row >= BOARD_ROWS || col < 0 || col >= BOARD_COLS) return true;
  return board[row][col] !== EMPTY;
}

export function tspinCorners(board: Board, row: number, col: number): boolean {
  let n = 0;
  for (const [dx, dy] of [[0, 0], [2, 0], [0, 2], [2, 2]]) {
    if (blocked(board, row + dy, col + dx)) n++;
  }
  return n >= 3;
}

export interface LockInput {
  boardBefore: Board;
  boardCleared: Board;
  linesCleared: number;
  pieceId: number;
  landRow: number;
  col: number;
  lastActionRotate: boolean;
  heldOccupied: boolean;
}

export function lockLedger(ledger: Ledger, {
  boardBefore,
  boardCleared,
  linesCleared,
  pieceId,
  landRow, col,
  lastActionRotate,
  heldOccupied,
}: LockInput): Ledger {
  const next = { ...ledger };
  const lines = Math.min(linesCleared, 4);
  const isTspin = pieceId === 3 && lastActionRotate && tspinCorners(boardBefore, landRow, col);

  let attack = ATTACK_TABLE[lines];
  if (isTspin) attack += TSPIN_REWARD[lines];

  const keepB2b = lines === 4 || (isTspin && lines > 0);
  if (keepB2b) attack += ledger.b2b;

  const isPc = boardCleared.every(r => r.every(c => c === EMPTY));
  if (isPc) attack += 10;

  const addCombo = lines > 0;
  if (addCombo) attack += COMBO_TABLE[Math.min(ledger.combo, COMBO_TABLE.length - 1)];
  const newCombo = addCombo ? ledger.combo + 1 : 0;

  if (isTspin && lines === 1) next.tss++;
  if (isTspin && lines === 2) next.tsd++;
  if (isTspin && lines === 3) next.tst++;
  if (lines === 4) next.tetris++;
  if (isPc) next.pc++;
  next.attack  += attack;
  next.maxCombo = Math.max(ledger.maxCombo, newCombo);
  next.combo    = newCombo;
  // only a line clear touches b2b: tetris/t-spin keep it, other clears reset it
  if (lines > 0) next.b2b = keepB2b ? 1 : 0;
  next.heldUsed = ledger.heldUsed || heldOccupied;
  return next;
}

export function requirementsMet(ledger: Ledger, requirements: Requirements): boolean {
  const counts = [
    ledger.tss, ledger.tsd, ledger.tst, ledger.tetris,
    ledger.pc, ledger.attack, ledger.maxCombo,
  ];
  for (let i = 0; i < 7; i++) {
    if (counts[i] < requirements[i]) return false;
  }
  if (requirements[7] && ledger.heldUsed) return false;
  return true;
}
