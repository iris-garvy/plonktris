// Sample puzzles for the dev playground (and handy fixtures for manual testing).
import { emptyBoard, type Board } from '../game/engine';

/** Rows of '.'/'X' (or piece letters), bottom-aligned onto an empty 21-row board. */
export function boardFromRows(rows: string[]): Board {
  const letters: Record<string, number> = { I: 1, O: 2, T: 3, S: 4, Z: 5, L: 6, J: 7, X: 8, G: 8 };
  const b = emptyBoard();
  const off = b.length - rows.length;
  rows.forEach((r, i) => {
    for (let c = 0; c < 10; c++) b[off + i][c] = letters[r[c]?.toUpperCase()] ?? 0;
  });
  return b;
}

export function queueFromText(text: string): number[] {
  const ids: Record<string, number> = { I: 1, O: 2, T: 3, S: 4, Z: 5, L: 6, J: 7 };
  return text.toUpperCase().split('').map(c => ids[c]).filter(Boolean);
}

export interface Sample {
  name: string;
  board: Board;
  queue: number[];
  requirements: number[];
}

// [tss, tsd, tst, tetris, pc, attack, max_combo, no_hold]
export const SAMPLES: Sample[] = [
  {
    // T: CW, left, soft drop, CW (kicks down-right into the slot), hard drop
    name: 'tsd (kick)',
    board: boardFromRows([
      'XXX..X....',
      'XXX...XXXX',
      'XXXX.XXXXX',
    ]),
    queue: queueFromText('TIO'),
    requirements: [0, 1, 0, 0, 0, 0, 0, 0],
  },
  {
    name: 'tetris · no hold',
    board: boardFromRows([
      'XXXXXXXXX.',
      'XXXXXXXXX.',
      'XXXXXXXXX.',
      'XXXXXXXXX.',
    ]),
    queue: queueFromText('OI'),
    requirements: [0, 0, 0, 1, 0, 0, 0, 1],
  },
  {
    // J flat (move right 1), then J upside down (180, right 2)
    name: 'pc',
    board: boardFromRows([
      'XXXX....XX',
      'XXXX....XX',
    ]),
    queue: queueFromText('JJ'),
    requirements: [0, 0, 0, 0, 1, 0, 0, 0],
  },
  {
    name: 'long queue',
    board: boardFromRows([
      'XXXXXXXX..',
      'XXXXXXXX..',
    ]),
    queue: queueFromText('OTISZLJOTISZLJIOTSZLJIOTSZLJIO'),
    requirements: [0, 0, 0, 0, 0, 2, 2, 0],
  },
  {
    name: 'near top out',
    board: boardFromRows(Array.from({ length: 18 }, (_, i) => (i % 2 ? 'XXXX.XXXXX' : 'XXXXX.XXXX'))),
    queue: queueFromText('TTT'),
    requirements: [0, 0, 0, 0, 0, 1, 0, 0],
  },
];
