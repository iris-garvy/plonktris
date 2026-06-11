export const BOARD_COLS = 10;
export const BOARD_ROWS = 21;
export const PIECE_TYPES = {
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

export const TETROMINOES = {
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

export const SRS_KICKS = {
  0: [
    [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
    [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
    [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],],
  1: [
    [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
    [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
    [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
    [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
    [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
    [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
    [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
    [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
]};



export function clearLines(board) {
  const surviving = board.filter(row => row.some(cell => cell === EMPTY));
  const numCleared = BOARD_ROWS - surviving.length;
  const emptyRows = Array.from({ length: numCleared }, () => new Array(BOARD_COLS).fill(EMPTY));
  return [...emptyRows, ...surviving];
}

// O pieces spawn one column right (centered), matching the circuit's spawn rule.
export function spawnCol(pieceId) {
  return pieceId === 2 ? 4 : 3;
}

// Circuit expects 0/1 occupancy bits, row 0 = top (same orientation as the UI).
export function boardToUint8(board) {
  const out = new Uint8Array(BOARD_ROWS * BOARD_COLS);
  for (let r = 0; r < BOARD_ROWS; r++) {
    for (let c = 0; c < BOARD_COLS; c++) {
      out[r * BOARD_COLS + c] = board[r][c] > 0 ? 1 : 0;
    }
  }
  return out;
}

export function getPieceCells(pieceId, rotation, startRow, startCol) {
  const shape = TETROMINOES[pieceId]?.[rotation % 4];
  if (!shape) return [];
  return shape.map(([dx, dy]) => ({ row: startRow + dy, col: startCol + dx }));
}

// FIX 1: use board[row][col] instead of cells[row][col]
export function isValidPlacement(board, pieceId, rotation, startRow, startCol) {
  const cells = getPieceCells(pieceId, rotation, startRow, startCol);
  for (const { row, col } of cells) {
    if (row < 0 || row >= BOARD_ROWS || col < 0 || col >= BOARD_COLS) return false;
    if (board[row][col] !== EMPTY) return false;
  }
  return true;
}


export function hardDrop(board, pieceId, rotation, startRow, startCol) {
  let endRow = startRow;
  while (isValidPlacement(board, pieceId, rotation, endRow + 1, startCol)) {
    endRow += 1;
  }
  return endRow;
}

export const ACTION_LEFT  = 0;
export const ACTION_RIGHT = 1;
export const ACTION_CW    = 2;
export const ACTION_CCW   = 3;
export const ACTION_SD    = 4;
export const ACTION_HOLD  = 5;
export const ACTION_NOOP  = 6;
export const MAX_ACTIONS  = 32;

export function movesToUint8(secretMoves) {
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

export function rotate(board, pieceId, rotation, startRow, startCol, is_cw) {
  let finalRotation = (rotation + is_cw + 3 * !is_cw) % 4;
  if (pieceId != 2) {
    // kick row layout matches the circuit: initial_rotation * 2 + is_cw
    const kickRow = rotation * 2 + is_cw;
    const kicks = SRS_KICKS[Number(pieceId === 1)][kickRow];
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