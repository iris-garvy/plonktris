export const BOARD_COLS = 10;
export const BOARD_ROWS = 21;

/** Frontend piece ids: 1-7 playable (I O T S Z L J), 8 = gray garbage, 0 = empty. */
export type PieceId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
/** A board cell: 0 (empty) or a PieceId. */
export type Cell = number;
/** 21 rows x 10 cols, row 0 = top (hidden spawn row). */
export type Board = Cell[][];
export type Rotation = 0 | 1 | 2 | 3;
export interface CellPos { row: number; col: number; }

export const PIECE_TYPES: Record<number, { name: string; color: string }> = {
  1: { name: 'I', color: '#00f5ff' },
  2: { name: 'O', color: '#ffe600' },
  3: { name: 'T', color: '#a000f0' },
  4: { name: 'S', color: '#00e000' },
  5: { name: 'Z', color: '#f00000' },
  6: { name: 'L', color: '#f0a000' },
  7: { name: 'J', color: '#0000f0' },
  8: { name: 'G', color: '#b1b1b1' },
};
export const NUM_PIECES = 7;
export const EMPTY = 0;

type Shape = [number, number][];

export const TETROMINOES: Record<number, Shape[]> = {
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

/** [piece kind (0 = JLSTZ, 1 = I)][initial_rotation * 2 + is_cw][kick][dx, dy] */
export const SRS_KICKS: Record<number, [number, number][][]> = {
  0: [
    [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
    [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
    [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  ],
  1: [
    [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
    [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
    [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
    [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
    [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
    [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
    [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
    [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  ],
};

export function clearLines(board: Board): Board {
  const surviving = board.filter(row => row.some(cell => cell === EMPTY));
  const numCleared = BOARD_ROWS - surviving.length;
  const emptyRows = Array.from({ length: numCleared }, () => new Array(BOARD_COLS).fill(EMPTY));
  return [...emptyRows, ...surviving];
}

// o piece column 4 spawn all else 3
export function spawnCol(pieceId: number | null | undefined): number {
  return pieceId === 2 ? 4 : 3;
}

export function boardToUint8(board: Board): Uint8Array {
  const out = new Uint8Array(BOARD_ROWS * BOARD_COLS);
  for (let r = 0; r < BOARD_ROWS; r++) {
    for (let c = 0; c < BOARD_COLS; c++) {
      out[r * BOARD_COLS + c] = board[r][c] > 0 ? 1 : 0;
    }
  }
  return out;
}

export function getPieceCells(pieceId: number, rotation: number, startRow: number, startCol: number): CellPos[] {
  const shape = TETROMINOES[pieceId]?.[rotation % 4];
  if (!shape) return [];
  return shape.map(([dx, dy]) => ({ row: startRow + dy, col: startCol + dx }));
}

export function isValidPlacement(board: Board, pieceId: number, rotation: number, startRow: number, startCol: number): boolean {
  const cells = getPieceCells(pieceId, rotation, startRow, startCol);
  for (const { row, col } of cells) {
    if (row < 0 || row >= BOARD_ROWS || col < 0 || col >= BOARD_COLS) return false;
    if (board[row][col] !== EMPTY) return false;
  }
  return true;
}

export function hardDrop(board: Board, pieceId: number, rotation: number, startRow: number, startCol: number): number {
  let endRow = startRow;
  while (isValidPlacement(board, pieceId, rotation, endRow + 1, startCol)) {
    endRow += 1;
  }
  return endRow;
}

/** Action encoding shared with the circuit. */
export const ACTION_LEFT  = 0;
export const ACTION_RIGHT = 1;
export const ACTION_CW    = 2;
export const ACTION_CCW   = 3;
export const ACTION_SD    = 4;
export const ACTION_HOLD  = 5;
export const ACTION_NOOP  = 6;
export const MAX_ACTIONS  = 32;

export type Action = number;
/** One 32-slot action list per placed piece. */
export type SecretMoves = Action[][];

export function movesToUint8(secretMoves: SecretMoves): Uint8Array {
  const numPieces = secretMoves.length;
  const out = new Uint8Array(numPieces * MAX_ACTIONS).fill(ACTION_NOOP);
  for (let p = 0; p < numPieces; p++) {
    const actions = secretMoves[p];
    for (let a = 0; a < Math.min(actions.length, MAX_ACTIONS); a++) {
      out[p * MAX_ACTIONS + a] = actions[a];
    }
  }
  return out;
}

/** Returns [rotation, row, col] — unchanged when no kick fits. */
export function rotate(
  board: Board, pieceId: number, rotation: number,
  startRow: number, startCol: number, isCw: boolean,
): [number, number, number] {
  const finalRotation = (rotation + (isCw ? 1 : 3)) % 4;
  if (pieceId !== 2) {
    // kick row layout matches the circuit: initial_rotation * 2 + is_cw
    const kickRow = rotation * 2 + (isCw ? 1 : 0);
    const kicks = SRS_KICKS[pieceId === 1 ? 1 : 0][kickRow];
    for (let kick = 0; kick < 5; kick++) {
      const tryRow = startRow - kicks[kick][1];
      const tryCol = startCol + kicks[kick][0];

      if (isValidPlacement(board, pieceId, finalRotation, tryRow, tryCol)) {
        return [finalRotation, tryRow, tryCol];
      }
    }
  }
  return [rotation, startRow, startCol];
}
