import { BOARD_COLS, BOARD_ROWS, EMPTY } from './tetrisUtils';

// Mirrors of the circuit's tables (crates/circuit/src/lib.rs)
export const ATTACK_TABLE = [0, 0, 1, 2, 4];
export const TSPIN_REWARD = [0, 2, 3, 4, 0];
export const COMBO_TABLE = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5];

export function emptyLedger() {
  return {
    tss: 0, tsd: 0, tst: 0, tetris: 0, pc: 0,
    attack: 0, maxCombo: 0, heldUsed: false,
    combo: 0, b2b: 0,
  };
}

// circuit block_collision: out of bounds counts as occupied
function blocked(board, row, col) {
  if (row < 0 || row >= BOARD_ROWS || col < 0 || col >= BOARD_COLS) return true;
  return board[row][col] !== EMPTY;
}

// circuit three_corners: >=3 occupied corners of the T's 3x3 box,
// checked against the board BEFORE the piece is merged
export function tspinCorners(board, row, col) {
  let n = 0;
  for (const [dx, dy] of [[0, 0], [2, 0], [0, 2], [2, 2]]) {
    if (blocked(board, row + dy, col + dx)) n++;
  }
  return n >= 3;
}

// Mirrors circuit lock_piece ledger update exactly (except max_combo, which
// implements the intended max() — see the geq stride note in the circuit).
export function lockLedger(ledger, {
  boardBefore,      // board before the piece merged
  boardCleared,     // board after merge + line clears
  linesCleared,
  pieceId,          // frontend piece id (T = 3)
  landRow, col,     // lock position
  lastActionRotate, // rotation flag AND piece couldn't drop at lock
  heldOccupied,     // hold slot occupied at lock time
}) {
  const next = { ...ledger };
  const lines = Math.min(linesCleared, 4);
  const isTspin = pieceId === 3 && lastActionRotate && tspinCorners(boardBefore, landRow, col);

  let attack = ATTACK_TABLE[lines];
  if (isTspin) attack += TSPIN_REWARD[lines];

  const keepB2b = lines === 4 || isTspin;
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
  next.b2b      = keepB2b ? 1 : 0;
  next.heldUsed = ledger.heldUsed || heldOccupied;
  return next;
}

// Mirrors verify_requirements: each counter must reach its requirement,
// and a no-hold requirement forbids ever holding.
export function requirementsMet(ledger, requirements) {
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
