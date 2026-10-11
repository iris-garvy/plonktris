// Plonktris game rules — pure, deterministic, no React / DOM.
//
// The server (crates/server/src/engine.rs) is a line-for-line port of this file and replays
// every submitted solution through it. ANY rule change here must be mirrored there; the shared
// fixtures in shared/engine-fixtures.json are checked by both sides to keep them in lockstep.
//
// Scoring (attack / T-spin / combo / b2b / PC) is intentionally identical to the original
// plonktris rules so puzzles published before the rewrite stay valid.

// ---------------------------------------------------------------------------
// board + pieces
// ---------------------------------------------------------------------------

export const COLS = 10;
/** 21 rows: row 0 is the spawn buffer above the visible field, rows 1-20 are visible. */
export const ROWS = 21;
export const HIDDEN_ROWS = 1;

export const EMPTY = 0;
export const GARBAGE = 8;

/** A board cell: 0 = empty, 1-7 = piece colour, 8 = garbage. Row 0 = top. */
export type Board = number[][];

/** Piece ids (client side): 1 I, 2 O, 3 T, 4 S, 5 Z, 6 L, 7 J. The API uses id - 1 (0-6). */
export const I = 1, O = 2, T = 3, S = 4, Z = 5, L = 6, J = 7;
export const PIECE_IDS = [I, O, T, S, Z, L, J] as const;
export const PIECE_NAMES: Record<number, string> = {
  1: 'I', 2: 'O', 3: 'T', 4: 'S', 5: 'Z', 6: 'L', 7: 'J', 8: 'G',
};

/** [piece][rotation] → four [x, y] offsets inside the piece's bounding box (SRS orientation). */
export const SHAPES: Record<number, readonly (readonly [number, number])[][]> = {
  1: [
    [[0, 1], [1, 1], [2, 1], [3, 1]],
    [[2, 0], [2, 1], [2, 2], [2, 3]],
    [[0, 2], [1, 2], [2, 2], [3, 2]],
    [[1, 0], [1, 1], [1, 2], [1, 3]],
  ],
  2: [
    [[0, 0], [1, 0], [0, 1], [1, 1]],
    [[0, 0], [1, 0], [0, 1], [1, 1]],
    [[0, 0], [1, 0], [0, 1], [1, 1]],
    [[0, 0], [1, 0], [0, 1], [1, 1]],
  ],
  3: [
    [[1, 0], [0, 1], [1, 1], [2, 1]],
    [[1, 0], [1, 1], [2, 1], [1, 2]],
    [[0, 1], [1, 1], [2, 1], [1, 2]],
    [[1, 0], [0, 1], [1, 1], [1, 2]],
  ],
  4: [
    [[1, 0], [2, 0], [0, 1], [1, 1]],
    [[1, 0], [1, 1], [2, 1], [2, 2]],
    [[1, 1], [2, 1], [0, 2], [1, 2]],
    [[0, 0], [0, 1], [1, 1], [1, 2]],
  ],
  5: [
    [[0, 0], [1, 0], [1, 1], [2, 1]],
    [[2, 0], [1, 1], [2, 1], [1, 2]],
    [[0, 1], [1, 1], [1, 2], [2, 2]],
    [[1, 0], [0, 1], [1, 1], [0, 2]],
  ],
  6: [
    [[2, 0], [0, 1], [1, 1], [2, 1]],
    [[1, 0], [1, 1], [1, 2], [2, 2]],
    [[0, 1], [1, 1], [2, 1], [0, 2]],
    [[0, 0], [1, 0], [1, 1], [1, 2]],
  ],
  7: [
    [[0, 0], [0, 1], [1, 1], [2, 1]],
    [[1, 0], [2, 0], [1, 1], [1, 2]],
    [[0, 1], [1, 1], [2, 1], [2, 2]],
    [[1, 0], [1, 1], [0, 2], [1, 2]],
  ],
};

/**
 * SRS wall kicks, [kind (0 = JLSTZ, 1 = I)][fromRotation * 2 + (cw ? 1 : 0)][test] → [dx, dy].
 * dy is "up" (guideline convention), so a kick moves the piece to row - dy.
 */
export const SRS_KICKS: readonly (readonly (readonly [number, number])[])[][] = [
  [
    [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
    [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
    [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  ],
  [
    [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
    [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
    [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
    [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
    [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
    [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
    [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
    [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  ],
];

export function emptyBoard(): Board {
  return Array.from({ length: ROWS }, () => new Array<number>(COLS).fill(EMPTY));
}

export function cloneBoard(board: Board): Board {
  return board.map(r => r.slice());
}

/** Spawn column of the piece's bounding box: O spawns at 4, everything else at 3. */
export function spawnCol(piece: number): number {
  return piece === O ? 4 : 3;
}

export interface CellPos { row: number; col: number; }

export function pieceCells(piece: number, rot: number, row: number, col: number): CellPos[] {
  return SHAPES[piece][rot & 3].map(([dx, dy]) => ({ row: row + dy, col: col + dx }));
}

export function fits(board: Board, piece: number, rot: number, row: number, col: number): boolean {
  for (const [dx, dy] of SHAPES[piece][rot & 3]) {
    const r = row + dy, c = col + dx;
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return false;
    if (board[r][c] !== EMPTY) return false;
  }
  return true;
}

/** Lowest row the piece can fall to from `row` without moving sideways. */
export function dropRow(board: Board, piece: number, rot: number, row: number, col: number): number {
  let r = row;
  while (fits(board, piece, rot, r + 1, col)) r++;
  return r;
}

/** Removes full rows, shifting everything above down. Returns the new board and lines cleared. */
export function clearLines(board: Board): { board: Board; lines: number } {
  const kept = board.filter(row => row.some(c => c === EMPTY));
  const lines = ROWS - kept.length;
  if (lines === 0) return { board, lines: 0 };
  const fresh = Array.from({ length: lines }, () => new Array<number>(COLS).fill(EMPTY));
  return { board: [...fresh, ...kept], lines };
}

/** A valid puzzle board: right shape, no full rows, nothing in the hidden spawn row. */
export function validPuzzleBoard(board: Board): boolean {
  if (board.length !== ROWS || board.some(r => r.length !== COLS)) return false;
  if (board[0].some(c => c !== EMPTY)) return false;
  return board.every(r => r.some(c => c === EMPTY));
}

// ---------------------------------------------------------------------------
// actions — also the solution wire format (one byte per action)
// ---------------------------------------------------------------------------

export const Action = {
  Left: 0,
  Right: 1,
  Cw: 2,
  Ccw: 3,
  /** move down one row */
  Soft: 4,
  Hold: 5,
  /** hard drop + lock */
  Hard: 6,
  Rot180: 7,
} as const;
export type Action = typeof Action[keyof typeof Action];
export const NUM_ACTIONS = 8;

// ---------------------------------------------------------------------------
// ledger (what a solve achieved) + requirements
// ---------------------------------------------------------------------------

export const ATTACK_TABLE = [0, 0, 1, 2, 4];
export const TSPIN_REWARD = [0, 2, 3, 4, 0];
export const COMBO_TABLE = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5];
export const PC_BONUS = 10;

export interface Ledger {
  tss: number;
  tsd: number;
  tst: number;
  tetris: number;
  pc: number;
  attack: number;
  maxCombo: number;
  /** current combo: consecutive line-clearing pieces */
  combo: number;
  /** 1 while a back-to-back chain is live */
  b2b: number;
  lines: number;
}

export function emptyLedger(): Ledger {
  return { tss: 0, tsd: 0, tst: 0, tetris: 0, pc: 0, attack: 0, maxCombo: 0, combo: 0, b2b: 0, lines: 0 };
}

/** [tss, tsd, tst, tetris, pc, attack, max_combo, no_hold] — the API's 8-byte format. */
export type Requirements = number[];
export const REQUIREMENT_NAMES = ['TSS', 'TSD', 'TST', 'TETRIS', 'PC', 'ATTACK', 'COMBO', 'NO HOLD'] as const;

export function ledgerCounts(ledger: Ledger): number[] {
  return [ledger.tss, ledger.tsd, ledger.tst, ledger.tetris, ledger.pc, ledger.attack, ledger.maxCombo];
}

/** Whether the ledger satisfies the 7 counted requirements. NO HOLD is enforced by the engine. */
export function requirementsMet(ledger: Ledger, requirements: Requirements): boolean {
  const counts = ledgerCounts(ledger);
  for (let i = 0; i < 7; i++) if (counts[i] < (requirements[i] ?? 0)) return false;
  return true;
}

/** What the most recent lock did — for HUD call-outs ("T-SPIN DOUBLE", "B2B", "COMBO 3"). */
export interface LockEvent {
  piece: number;
  lines: number;
  tspin: boolean;
  /** this clear continued a back-to-back chain (and got the +1) */
  b2b: boolean;
  /** combo count after this lock (0 = no clear) */
  combo: number;
  pc: boolean;
  attack: number;
}

// ---------------------------------------------------------------------------
// game state
// ---------------------------------------------------------------------------

export interface ActivePiece { piece: number; rot: number; row: number; col: number; }

export type Status = 'playing' | 'done' | 'topout';

export interface GameState {
  board: Board;
  queue: readonly number[];
  /** index of the next undrawn queue piece */
  next: number;
  active: ActivePiece | null;
  hold: number | null;
  /** hold already used by the current piece (once per piece) */
  holdUsed: boolean;
  /** hold disabled entirely (the puzzle's NO HOLD requirement) */
  noHold: boolean;
  /** last effective action was a rotation — needed for T-spin detection */
  lastRotate: boolean;
  placed: number;
  ledger: Ledger;
  status: Status;
  lastLock: LockEvent | null;
}

function spawnPiece(s: GameState, piece: number): GameState {
  const col = spawnCol(piece);
  if (!fits(s.board, piece, 0, 0, col)) {
    return { ...s, active: null, status: 'topout' };
  }
  return { ...s, active: { piece, rot: 0, row: 0, col }, lastRotate: false };
}

/** `queue` holds client piece ids (1-7). */
export function newGame(board: Board, queue: readonly number[], noHold = false): GameState {
  const s: GameState = {
    board: cloneBoard(board),
    queue,
    next: 0,
    active: null,
    hold: null,
    holdUsed: false,
    noHold,
    lastRotate: false,
    placed: 0,
    ledger: emptyLedger(),
    status: queue.length === 0 ? 'done' : 'playing',
    lastLock: null,
  };
  if (queue.length === 0) return s;
  return spawnPiece({ ...s, next: 1 }, queue[0]);
}

/** Whether HOLD would do anything right now. */
export function canHold(s: GameState): boolean {
  return s.status === 'playing' && s.active != null && !s.noHold && !s.holdUsed
    && (s.hold != null || s.next < s.queue.length);
}

function tspinCorners(board: Board, row: number, col: number): boolean {
  let n = 0;
  for (const [dx, dy] of [[0, 0], [2, 0], [0, 2], [2, 2]]) {
    const r = row + dy, c = col + dx;
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS || board[r][c] !== EMPTY) n++;
  }
  return n >= 3;
}

function lock(s: GameState): GameState {
  const a = s.active!;
  const landRow = dropRow(s.board, a.piece, a.rot, a.row, a.col);
  // a spin only counts if the rotation was the last thing that moved the piece:
  // a hard drop that actually falls cancels it
  const spin = s.lastRotate && landRow === a.row;
  const tspin = a.piece === T && spin && tspinCorners(s.board, landRow, a.col);

  const placedBoard = cloneBoard(s.board);
  for (const { row, col } of pieceCells(a.piece, a.rot, landRow, a.col)) placedBoard[row][col] = a.piece;
  const { board, lines: rawLines } = clearLines(placedBoard);
  const lines = Math.min(rawLines, 4);

  const old = s.ledger;
  let attack = ATTACK_TABLE[lines];
  if (tspin) attack += TSPIN_REWARD[lines];
  const keepB2b = lines === 4 || (tspin && lines > 0);
  const b2bBonus = keepB2b && old.b2b > 0;
  if (b2bBonus) attack += old.b2b;
  const pc = board.every(r => r.every(c => c === EMPTY));
  if (pc) attack += PC_BONUS;
  const cleared = lines > 0;
  if (cleared) attack += COMBO_TABLE[Math.min(old.combo, COMBO_TABLE.length - 1)];
  const combo = cleared ? old.combo + 1 : 0;

  const ledger: Ledger = {
    tss: old.tss + (tspin && lines === 1 ? 1 : 0),
    tsd: old.tsd + (tspin && lines === 2 ? 1 : 0),
    tst: old.tst + (tspin && lines === 3 ? 1 : 0),
    tetris: old.tetris + (lines === 4 ? 1 : 0),
    pc: old.pc + (pc ? 1 : 0),
    attack: old.attack + attack,
    maxCombo: Math.max(old.maxCombo, combo),
    combo,
    // only a line clear touches b2b: tetris / t-spin clears keep it, other clears break it
    b2b: cleared ? (keepB2b ? 1 : 0) : old.b2b,
    lines: old.lines + rawLines,
  };

  const after: GameState = {
    ...s,
    board,
    active: null,
    holdUsed: false,
    lastRotate: false,
    placed: s.placed + 1,
    ledger,
    lastLock: { piece: a.piece, lines, tspin, b2b: b2bBonus, combo, pc, attack },
  };

  if (after.placed >= s.queue.length) return { ...after, status: 'done' };
  if (after.next < s.queue.length) {
    return spawnPiece({ ...after, next: after.next + 1 }, s.queue[after.next]);
  }
  // queue exhausted: the held piece comes out
  return spawnPiece({ ...after, hold: null }, after.hold!);
}

function tryMove(s: GameState, a: ActivePiece, drow: number, dcol: number): GameState {
  if (!fits(s.board, a.piece, a.rot, a.row + drow, a.col + dcol)) return s;
  return { ...s, active: { ...a, row: a.row + drow, col: a.col + dcol }, lastRotate: false };
}

function tryRotate(s: GameState, a: ActivePiece, turn: 1 | 2 | 3): GameState {
  if (a.piece === O) return s;
  const rot = (a.rot + turn) & 3;
  // 180s have no kick table: in place or not at all
  const kicks: readonly (readonly [number, number])[] = turn === 2
    ? [[0, 0]]
    : SRS_KICKS[a.piece === I ? 1 : 0][a.rot * 2 + (turn === 1 ? 1 : 0)];
  for (const [dx, dy] of kicks) {
    const row = a.row - dy, col = a.col + dx;
    if (fits(s.board, a.piece, rot, row, col)) {
      return { ...s, active: { ...a, rot, row, col }, lastRotate: true };
    }
  }
  return s;
}

function doHold(s: GameState, a: ActivePiece): GameState {
  if (!canHold(s)) return s;
  if (s.hold == null) {
    return spawnPiece({ ...s, hold: a.piece, holdUsed: true, next: s.next + 1 }, s.queue[s.next]);
  }
  return spawnPiece({ ...s, hold: a.piece, holdUsed: true }, s.hold);
}

/**
 * Applies one action. Returns the SAME object when the action has no effect (blocked move,
 * failed rotation, hold not allowed, game over) — callers use `next !== prev` to decide
 * whether to record it. Ineffective actions never change any state, including the spin flag.
 */
export function step(s: GameState, action: number): GameState {
  const a = s.active;
  if (s.status !== 'playing' || a == null) return s;
  switch (action) {
    case Action.Left:   return tryMove(s, a, 0, -1);
    case Action.Right:  return tryMove(s, a, 0, 1);
    case Action.Soft:   return tryMove(s, a, 1, 0);
    case Action.Cw:     return tryRotate(s, a, 1);
    case Action.Ccw:    return tryRotate(s, a, 3);
    case Action.Rot180: return tryRotate(s, a, 2);
    case Action.Hold:   return doHold(s, a);
    case Action.Hard:   return lock(s);
    default:            return s;
  }
}

/** Row the active piece would land on (for the ghost). */
export function ghostRow(s: GameState): number | null {
  const a = s.active;
  return a ? dropRow(s.board, a.piece, a.rot, a.row, a.col) : null;
}

// ---------------------------------------------------------------------------
// replay — exactly what the server does with a submitted solution
// ---------------------------------------------------------------------------

export type ReplayError =
  | 'bad_action'      // a byte outside 0-7
  | 'topout'          // a piece couldn't spawn
  | 'incomplete'      // actions ran out before every piece was placed
  | 'trailing'        // actions left over after the last piece locked
  | 'requirements';   // all pieces placed, requirements not met

export interface ReplayResult {
  ok: boolean;
  error: ReplayError | null;
  ledger: Ledger;
  placed: number;
}

/**
 * Replays `solution` on a puzzle. `queue` holds client ids (1-7); `requirements` is the 8-byte
 * format. Ineffective actions are skipped (they're no-ops), matching `step`.
 */
export function replay(
  board: Board, queue: readonly number[], requirements: Requirements, solution: readonly number[],
): ReplayResult {
  let s = newGame(board, queue, !!requirements[7]);
  for (let i = 0; i < solution.length; i++) {
    const act = solution[i];
    if (!Number.isInteger(act) || act < 0 || act >= NUM_ACTIONS) {
      return { ok: false, error: 'bad_action', ledger: s.ledger, placed: s.placed };
    }
    if (s.status === 'done') return { ok: false, error: 'trailing', ledger: s.ledger, placed: s.placed };
    s = step(s, act);
    if (s.status === 'topout') return { ok: false, error: 'topout', ledger: s.ledger, placed: s.placed };
  }
  if (s.status !== 'done') return { ok: false, error: 'incomplete', ledger: s.ledger, placed: s.placed };
  if (!requirementsMet(s.ledger, requirements)) {
    return { ok: false, error: 'requirements', ledger: s.ledger, placed: s.placed };
  }
  return { ok: true, error: null, ledger: s.ledger, placed: s.placed };
}

// ---------------------------------------------------------------------------
// API format conversions
// ---------------------------------------------------------------------------

/** 210 occupancy bits (row-major, row 0 = top) → board with garbage cells. */
export function boardFromBits(bits: readonly number[]): Board {
  return Array.from({ length: ROWS }, (_, r) =>
    Array.from({ length: COLS }, (_, c) => (bits[r * COLS + c] ? GARBAGE : EMPTY)));
}

export function boardToBits(board: Board): number[] {
  const out: number[] = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) out.push(board[r][c] !== EMPTY ? 1 : 0);
  return out;
}

/** API piece ids (0-6) ↔ client ids (1-7). */
export const queueFromApi = (q: readonly number[]): number[] => q.map(id => id + 1);
export const queueToApi = (q: readonly number[]): number[] => q.map(id => id - 1);
