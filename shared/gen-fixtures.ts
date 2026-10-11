// Generates shared/engine-fixtures.json from the TypeScript engine — the source of truth.
//
//   node shared/gen-fixtures.ts
//
// The Rust server replays every case through its port (crates/server/src/engine.rs, test
// `matches_ts_engine_fixtures`) and must agree exactly. Re-run this after ANY change to
// frontend/src/game/engine.ts, then run `cargo test`.
//
// Each case stores the inputs in API format (board = 210 occupancy bits, queue = ids 0-6,
// requirements = 8 bytes, solution = action bytes) and what engine.ts's `replay` returned, plus
// the cells of the board it stopped on. Output is deterministic (seeded PRNG).
//
// Plain Node (v23.6+) runs this directly: engine.ts only uses erasable TypeScript syntax.

import { writeFileSync } from 'node:fs';
import * as E from '../frontend/src/game/engine.ts';

const A = E.Action;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

interface Expected {
  ok: boolean;
  error: E.ReplayError | null;
  ledger: E.Ledger;
  placed: number;
  final_board: number[];
}

interface Case {
  name: string;
  board: number[];
  queue: number[];
  requirements: number[];
  solution: number[];
  expected: Expected;
}

/** Runs engine.ts's replay, plus the same loop by hand to capture the final board. */
function run(boardBits: number[], queueApi: number[], requirements: number[], solution: number[]): Expected {
  const board = E.boardFromBits(boardBits);
  const queue = E.queueFromApi(queueApi);
  const r = E.replay(board, queue, requirements, solution);

  let s = E.newGame(board, queue, !!requirements[7]);
  for (const act of solution) {
    if (!Number.isInteger(act) || act < 0 || act >= E.NUM_ACTIONS) break;
    if (s.status === 'done') break;
    s = E.step(s, act);
    if (s.status === 'topout') break;
  }
  // our loop must stop exactly where replay() did
  if (s.placed !== r.placed || JSON.stringify(s.ledger) !== JSON.stringify(r.ledger)) {
    throw new Error('final-state walk disagrees with replay()');
  }
  return { ok: r.ok, error: r.error, ledger: r.ledger, placed: r.placed, final_board: s.board.flat() };
}

const cases: Case[] = [];
const names = new Set<string>();

function add(
  name: string, board: number[], queue: number[], requirements: number[], solution: number[],
  check?: (r: Expected) => boolean,
): Expected {
  if (names.has(name)) throw new Error(`duplicate case name ${name}`);
  if (board.length !== E.ROWS * E.COLS) throw new Error(`${name}: board must be 210 bits`);
  if (requirements.length !== 8) throw new Error(`${name}: requirements must be 8 bytes`);
  names.add(name);
  const expected = run(board, queue, requirements, solution);
  if (check && !check(expected)) {
    throw new Error(`hand-crafted case "${name}" doesn't do what its name says: ${JSON.stringify({
      ok: expected.ok, error: expected.error, ledger: expected.ledger, placed: expected.placed })}`);
  }
  cases.push({ name, board, queue, requirements, solution, expected });
  return expected;
}

/** Board from bottom-aligned row strings ('X' = filled, '.' = empty), e.g. ['XXXX.XXXXX']. */
function rows(...bottom: string[]): number[] {
  const bits = new Array<number>(E.ROWS * E.COLS).fill(0);
  const top = E.ROWS - bottom.length;
  bottom.forEach((line, i) => {
    if (line.length !== E.COLS) throw new Error(`row "${line}" must be ${E.COLS} wide`);
    for (let c = 0; c < E.COLS; c++) bits[(top + i) * E.COLS + c] = line[c] === 'X' ? 1 : 0;
  });
  return bits;
}
const EMPTY_BOARD = rows();

/** Queue from piece letters, in API ids (I=0 … J=6). */
function q(letters: string): number[] {
  return [...letters].map(ch => 'IOTSZLJ'.indexOf(ch)).map(id => {
    if (id < 0) throw new Error(`bad piece letter in ${letters}`);
    return id;
  });
}

/** Requirements bytes. */
function req(r: Partial<Record<'tss' | 'tsd' | 'tst' | 'tetris' | 'pc' | 'attack' | 'combo', number>> = {},
  noHold = false): number[] {
  return [r.tss ?? 0, r.tsd ?? 0, r.tst ?? 0, r.tetris ?? 0, r.pc ?? 0, r.attack ?? 0, r.combo ?? 0, noHold ? 1 : 0];
}

/** Action list from tokens: L R CW CCW 180 D(soft) HOLD HD, with optional *n repeats. */
function acts(src: string): number[] {
  const map: Record<string, number> = {
    L: A.Left, R: A.Right, CW: A.Cw, CCW: A.Ccw, D: A.Soft, HOLD: A.Hold, HD: A.Hard, '180': A.Rot180,
  };
  const out: number[] = [];
  for (const tok of src.trim().split(/\s+/).filter(Boolean)) {
    const [name, times] = tok.split('*');
    if (/^\d+$/.test(name) && name !== '180') { out.push(Number(name)); continue; } // raw byte
    const a = map[name];
    if (a === undefined) throw new Error(`bad action token ${tok}`);
    for (let i = 0; i < (times ? Number(times) : 1); i++) out.push(a);
  }
  return out;
}

const ok = (r: Expected) => r.ok;
const err = (e: E.ReplayError) => (r: Expected) => r.error === e;

// ---------------------------------------------------------------------------
// hand-crafted cases
// ---------------------------------------------------------------------------

// T-spin double, no kick: T stands up (CW) above the slot, drops in, then CW again flips it
// into the slot under the overhang at (18,3).
const TSD_BOARD = rows(
  'XXXX......',
  'XXX...XXXX',
  'XXXX.XXXXX',
);
add('tsd_basic', TSD_BOARD, q('T'), req({ tsd: 1 }), acts('CW HD'), r => !r.ok && r.ledger.tsd === 0);
add('tsd_spin_into_slot', TSD_BOARD, q('T'), req({ tsd: 1 }), acts('CW D*18 CW HD'),
  r => r.ok && r.ledger.tsd === 1 && r.ledger.attack === 4 && r.ledger.b2b === 1);
add('tsd_wrong_requirement', TSD_BOARD, q('T'), req({ tst: 1 }), acts('CW D*18 CW HD'), err('requirements'));

// T-spin triple: the T reaches (16,3) under the roof, and CCW only fits via the 5th kick test
// (1,-2), dropping it two rows into the vertical slot.
const TST_BOARD = rows(
  '.....XXXXX',
  '......XXXX',
  'XXXXX.XXXX',
  'XXXX..XXXX',
  'XXXXX.XXXX',
);
add('tst_kick', TST_BOARD, q('T'), req({ tst: 1 }), acts('L D*16 R CCW HD'),
  r => r.ok && r.ledger.tst === 1 && r.ledger.attack === 6 && r.ledger.lines === 3);
// the same kick with holes left in the upper rows: only two / one of the three rows clear
add('tsd_kick', rows(
  '.....XXXXX',
  '......XXXX',
  '.XXXX.XXXX',
  'XXXX..XXXX',
  'XXXXX.XXXX',
), q('T'), req({ tsd: 1 }), acts('L D*16 R CCW HD'), r => r.ok && r.ledger.tsd === 1 && r.ledger.attack === 4);
add('tss_kick', rows(
  '.....XXXXX',
  '......XXXX',
  '.XXXX.XXXX',
  '.XXX..XXXX',
  'XXXXX.XXXX',
), q('T'), req({ tss: 1 }), acts('L D*16 R CCW HD'), r => r.ok && r.ledger.tss === 1 && r.ledger.attack === 2);
// rotating CW instead of CCW from the same spot kicks the T *up* a row (3rd test); it locks
// there with the spin flag set but only 0 corners filled — no T-spin, no lines
add('tst_board_wrong_rotation', TST_BOARD, q('T'), req({ tst: 1 }), acts('L D*16 R CW HD'),
  r => r.error === 'requirements' && r.ledger.lines === 0);

// Spins that don't count. Wall on the left; T stood up (CW) at the top, then hard-dropped: it
// lands in a 3-corner spot and clears two lines, but the drop moved it, so no T-spin.
const WALL_BOARD = rows(
  'XXXX......',
  'XXXX......',
  'XXXX......',
  'XXXX..XXXX',
  'XXXX.XXXXX',
);
add('spin_cancelled_by_drop', WALL_BOARD, q('T'), req({ tsd: 1 }), acts('CW HD'),
  r => r.error === 'requirements' && r.ledger.tsd === 0 && r.ledger.lines === 2 && r.ledger.attack === 1);
// …and soft-dropping after the rotation also cancels it (last action wasn't a rotation)
add('spin_cancelled_by_soft_drop', WALL_BOARD, q('T'), req({ attack: 1 }), acts('CW D*18 HD'),
  r => r.ok && r.ledger.tsd === 0 && r.ledger.lines === 2);
// an ineffective soft drop at the bottom doesn't clear the spin flag; in the TSD slot the T
// still scores the spin
add('ineffective_action_keeps_spin', TSD_BOARD, q('T'), req({ tsd: 1 }), acts('CW D*18 CW D D L L HD'),
  r => r.ok && r.ledger.tsd === 1);
// a T-spin with no lines: spin flag + 3 corners, but nothing clears
add('tspin_zero_lines', rows(
  'XXXX......',
  '.XX...XXXX',
  'XXXX.XXXX.',
), q('T'), req({ tsd: 1 }), acts('CW D*18 CW HD'), r => r.error === 'requirements' && r.ledger.lines === 0);
// a non-T piece "spinning" into a slot gets nothing extra
add('non_t_spin_no_bonus', rows(
  'XXXX......',
  'XXX...XXXX',
  'XXXX.XXXXX',
), q('L'), req({ attack: 1 }), acts('CW D*17 CW HD'), r => r.ledger.tss + r.ledger.tsd + r.ledger.tst === 0);

// Tetris + perfect clear
const TETRIS_BOARD = rows(
  'XXXXXXXXX.',
  'XXXXXXXXX.',
  'XXXXXXXXX.',
  'XXXXXXXXX.',
);
add('tetris_pc', TETRIS_BOARD, q('I'), req({ tetris: 1, pc: 1 }), acts('CW R*4 HD'),
  r => r.ok && r.ledger.tetris === 1 && r.ledger.pc === 1 && r.ledger.attack === 14);
add('tetris', rows(
  'X.........',
  'XXXXXXXXX.',
  'XXXXXXXXX.',
  'XXXXXXXXX.',
  'XXXXXXXXX.',
), q('I'), req({ tetris: 1 }), acts('CW R*4 HD'),
  r => r.ok && r.ledger.tetris === 1 && r.ledger.pc === 0 && r.ledger.attack === 4);
add('pc_single', rows('XXXXXX....'), q('I'), req({ pc: 1 }), acts('R*3 HD'),
  r => r.ok && r.ledger.pc === 1 && r.ledger.attack === 10 && r.ledger.lines === 1);
add('pc_requires_empty_board', rows('X.........', 'XXXXXX....'), q('I'), req({ pc: 1 }), acts('R*3 HD'),
  err('requirements'));

// Back-to-back: tetris, tetris (+1), then a plain single breaks the chain, then tetris (no +1)
const B2B_BOARD = rows(
  'X.........',
  'XXXXXXXXX.',
  'XXXXXXXXX.',
  'XXXXXXXXX.',
  'XXXXXXXXX.',
  'XXXXXXXXX.',
  'XXXXXXXXX.',
  'XXXXXXXXX.',
  'XXXXXXXXX.',
);
add('b2b_tetris_tetris', B2B_BOARD, q('II'), req({ tetris: 2, attack: 9 }), acts('CW R*4 HD CW R*4 HD'),
  r => r.ok && r.ledger.attack === 9 && r.ledger.b2b === 1);
add('b2b_survives_non_clear', B2B_BOARD, q('IOI'), req({ tetris: 2, attack: 9 }),
  // a piece that clears nothing doesn't touch b2b (but resets the combo)
  acts('CW R*4 HD L*4 HD CW R*4 HD'), r => r.ok && r.ledger.attack === 9 && r.ledger.maxCombo === 1);
add('b2b_chain_broken', rows(
  'X.........',
  'XXXXXX....',
  'XXXXXXXXX.',
  'XXXXXXXXX.',
  'XXXXXXXXX.',
  'XXXXXXXXX.',
  'XXXXXXXXX.',
  'XXXXXXXXX.',
  'XXXXXXXXX.',
  'XXXXXXXXX.',
), q('IOIOI'), req({ tetris: 2 }),
  // tetris; O (no clear); flat I single → breaks b2b; O (no clear); tetris without the +1
  acts('CW R*4 HD L*4 HD R*3 HD L*4 HD CW R*4 HD'),
  r => r.ok && r.ledger.tetris === 2 && r.ledger.attack === 8 && r.ledger.b2b === 1);
// tetris then TSD: the T-spin continues the chain from the tetris (+1)
add('b2b_tetris_then_tsd', rows(
  'XXXXXXXXX.',
  'XXXXXXXXX.',
  'XXXXXXXXX.',
  'XXXXXXXXX.',
  'XXXX.....X',
  'XXX...XXXX',
  'XXXX.XXXXX',
), q('IT'), req({ tsd: 1, tetris: 1 }), acts('CW R*4 HD CW D*18 CW HD'),
  r => r.ok && r.ledger.tsd === 1 && r.ledger.tetris === 1 && r.ledger.attack === 9);

// Combo chain: four O pieces, each clearing two rows of the right-hand well
const COMBO_BOARD = rows(
  'X.........',
  'XXXXXXXX..',
  'XXXXXXXX..',
  'XXXXXXXX..',
  'XXXXXXXX..',
  'XXXXXXXX..',
  'XXXXXXXX..',
  'XXXXXXXX..',
  'XXXXXXXX..',
);
add('combo_chain', COMBO_BOARD, q('OOOO'), req({ combo: 4 }), acts('R*4 HD R*4 HD R*4 HD R*4 HD'),
  r => r.ok && r.ledger.maxCombo === 4 && r.ledger.attack === 6 && r.ledger.combo === 4);
add('combo_broken', COMBO_BOARD, q('OOOO'), req({ combo: 3 }), acts('R*4 HD R*4 HD L*4 HD R*4 HD'),
  r => r.error === 'requirements' && r.ledger.maxCombo === 2 && r.ledger.combo === 1);

// Hold
add('hold_then_tetris_then_held_piece', TETRIS_BOARD, q('OI'), req({ tetris: 1 }),
  // hold O (I comes out), tetris (+PC), queue exhausted → held O auto-spawns, drop it
  acts('HOLD CW R*4 HD HD'),
  r => r.ok && r.placed === 2 && r.ledger.tetris === 1 && r.ledger.pc === 1);
add('hold_once_per_piece', TETRIS_BOARD, q('OI'), req({ tetris: 1 }),
  // the second HOLD is ineffective (already held this piece) and is skipped
  acts('HOLD HOLD CW R*4 HD HD'), r => r.ok && r.placed === 2);
add('hold_swap', TETRIS_BOARD, q('TIO'), req({ tetris: 1 }),
  // hold T → I; tetris; O spawns, swap with held T; drop T; held O comes out at the end
  acts('HOLD CW R*4 HD HOLD HD L*4 HD'), r => r.ok && r.placed === 3);
add('hold_single_piece_ineffective', EMPTY_BOARD, q('T'), req({}), acts('HOLD HD'),
  r => r.ok && r.placed === 1);
add('hold_with_empty_queue_and_hold', EMPTY_BOARD, q('TO'), req({}),
  // hold T (O out), drop O; T comes out, can't hold (queue empty, hold empty) → HOLD skipped
  acts('HOLD HD HOLD HD'), r => r.ok && r.placed === 2);
add('no_hold_ignores_hold', TETRIS_BOARD, q('IO'), req({ tetris: 1 }, true), acts('HOLD CW R*4 HD HD'),
  r => r.ok && r.placed === 2);
add('no_hold_breaks_hold_solution', TETRIS_BOARD, q('OI'), req({ tetris: 1 }, true),
  // the same moves as hold_then_tetris_then_held_piece, but HOLD is disabled: O goes in the well
  acts('HOLD CW R*4 HD HD'), r => !r.ok && r.ledger.tetris === 0);
add('no_hold_flag_any_nonzero_byte', TETRIS_BOARD, q('OI'), [0, 0, 0, 1, 0, 0, 0, 7],
  acts('HOLD CW R*4 HD HD'), r => !r.ok);

// 180 rotation
add('rot180_effective', rows('XXX...XXXX'), q('J'), req({}), acts('180 HD'), r => r.ok);
add('rot180_double_pc', rows('XXX...XXXX', 'XXX.XXXXXX'), q('L'), req({ pc: 1 }),
  // L flipped (three across, foot down-left) fills both gaps
  acts('180 HD'), r => r.ok && r.ledger.pc === 1 && r.ledger.lines === 2 && r.ledger.attack === 11);
add('rot180_blocked_no_kicks', EMPTY_BOARD, q('T'), req({}),
  // on the floor a 180 would poke below the board; with no kick table it simply fails
  acts('D*19 180 HD'), r => r.ok && r.final_board[194] === E.T && r.final_board[203] === E.T);
add('rot180_tspin_single', rows(
  'XX...XXXXX',
  'XX....XXXX',
  'XXXX.XXXXX',
), q('T'), req({ tss: 1 }), acts('L D*18 R 180 HD'), r => r.ok && r.ledger.tss === 1 && r.ledger.attack === 2);
add('o_never_rotates', EMPTY_BOARD, q('O'), req({}), acts('CW CCW 180 HD'), r => r.placed === 1);

// I-piece kicks against the walls and floor
add('i_kick_left_wall', EMPTY_BOARD, q('I'), req({}), acts('CW L*5 CW HD'),
  r => r.final_board.slice(200, 204).every(c => c === E.I));
add('i_kick_right_wall', EMPTY_BOARD, q('I'), req({}), acts('CCW R*5 CCW HD'),
  r => r.final_board.slice(206, 210).every(c => c === E.I));
add('i_kick_floor', EMPTY_BOARD, q('I'), req({}), acts('D*19 CW HD'),
  r => [176, 186, 196, 206].every(i => r.final_board[i] === E.I));
add('i_into_well', rows(
  'XXXXXXXX.X',
  'XXXXXXXX.X',
  'XXXXXXXX.X',
  'XXXXXXXX.X',
), q('I'), req({ tetris: 1 }), acts('R*3 D*16 CW HD'), r => r.ok && r.ledger.pc === 1);
add('mixed_pieces_kicks', rows(
  'XXXXX..XXX',
  'XXXX..XXXX',
  'XXXXX.XXXX',
), q('SZLJ'), req({}), acts('D*5 CW CW CCW HD R*2 CCW D*10 CW HD L*4 HD CW R*5 HD'), () => true);

// Top out
const PILLAR = rows(...Array.from({ length: 19 }, () => '....X.....'));
add('topout_after_lock', PILLAR, q('TT'), req({}), acts('HD HD'), r => r.error === 'topout' && r.placed === 1);
add('topout_on_first_spawn', rows(...Array.from({ length: 20 }, () => '....X.....')), q('T'), req({}),
  acts('HD'), err('topout'));
add('topout_initial_empty_solution', rows(...Array.from({ length: 20 }, () => '....X.....')), q('T'), req({}),
  [], err('incomplete'));
add('i_spawns_over_pillar', rows(...Array.from({ length: 20 }, () => '....X.....')), q('I'), req({}),
  acts('HD'), r => r.error === 'topout');
// only the I's spawn footprint reaches column 6: holding the T brings out the I, which can't spawn
add('topout_from_hold', rows(...Array.from({ length: 20 }, () => '......X...')), q('TI'), req({}),
  acts('HOLD'), r => r.error === 'topout' && r.placed === 0);

// Replay errors
add('incomplete', EMPTY_BOARD, q('TO'), req({}), acts('HD'), r => r.error === 'incomplete' && r.placed === 1);
add('incomplete_empty', EMPTY_BOARD, q('TO'), req({}), [], err('incomplete'));
add('trailing', EMPTY_BOARD, q('T'), req({}), acts('HD L'), err('trailing'));
add('trailing_ineffective', EMPTY_BOARD, q('O'), req({}), acts('HD CW'), err('trailing'));
add('bad_action', EMPTY_BOARD, q('T'), req({}), [A.Left, 8, A.Hard], r => r.error === 'bad_action' && r.placed === 0);
add('bad_action_255', EMPTY_BOARD, q('T'), req({}), [255], err('bad_action'));
add('bad_action_after_done', EMPTY_BOARD, q('T'), req({}), [A.Hard, 200], err('bad_action'));
add('requirements_not_met', EMPTY_BOARD, q('T'), req({ tss: 1 }), acts('HD'), err('requirements'));
add('zero_requirements_ok', EMPTY_BOARD, q('IOTSZLJ'), req({}),
  acts('L*3 HD R*4 HD CW L*4 HD R*2 HD CW R*4 HD L HD R*2 HD'), r => r.ok || r.error === 'topout');
add('max_queue_30', EMPTY_BOARD, q('IOTSZLJIOTSZLJIOTSZLJIOTSZLJIO'), req({}),
  acts(Array.from({ length: 30 }, (_, i) => ['L*3', 'R*3', '', 'L', 'R', 'L*2', 'R*2'][i % 7] + ' HD').join(' ')),
  () => true);

// ---------------------------------------------------------------------------
// randomized cases
// ---------------------------------------------------------------------------

function mulberry32(seed: number) {
  let t = seed >>> 0;
  const next = () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    /** integer in [lo, hi] */
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)],
    chance: (p: number) => next() < p,
  };
}
type Rng = ReturnType<typeof mulberry32>;

/** Cheese row: full except one or two holes. */
function cheeseRow(rng: Rng): string {
  const row = new Array<string>(E.COLS).fill('X');
  row[rng.int(0, E.COLS - 1)] = '.';
  if (rng.chance(0.3)) row[rng.int(0, E.COLS - 1)] = '.';
  return row.join('');
}

/** A TSD or TST setup at a random column (randomly mirrored) on top of a little cheese, so the
 *  bot gets real T-spin doubles/triples (kicks included) on varied boards. */
function tslotBoard(rng: Rng): number[] {
  const fill = (from: number, to: number, holes: number[] = []) =>
    Array.from({ length: E.COLS }, (_, c) => (c >= from && c <= to && !holes.includes(c) ? 'X' : '.')).join('');
  let lines: string[];
  if (rng.chance(0.5)) {
    // TSD: overhang at column c, slot c..c+2 (see TSD_BOARD)
    const c = rng.int(0, 7);
    lines = [fill(0, c), fill(0, 9, [c, c + 1, c + 2]), fill(0, 9, [c + 1])];
  } else {
    // TST: roof over slot column s, nub at s-1 (see TST_BOARD)
    const sc = rng.int(3, 8);
    lines = [fill(sc, 9), fill(sc + 1, 9), fill(0, 9, [sc]), fill(0, 9, [sc - 1, sc]), fill(0, 9, [sc])];
  }
  if (rng.chance(0.3)) lines[0] = lines[0].replace(/X/g, () => (rng.chance(0.5) ? 'X' : '.'));
  for (let k = rng.int(0, 3); k > 0; k--) lines.push(cheeseRow(rng));
  if (rng.chance(0.5)) lines = lines.map(l => [...l].reverse().join(''));
  return rows(...lines);
}

/** Low garbage: no full rows, row 0 always empty. */
function randomBoard(rng: Rng, style: string): number[] {
  if (style === 'tslot') return tslotBoard(rng);
  const bits = new Array<number>(E.ROWS * E.COLS).fill(0);
  const height = style === 'empty' ? 0 : style === 'tall' ? rng.int(10, 18) : rng.int(1, 8);
  const well = rng.int(0, E.COLS - 1);
  for (let r = E.ROWS - height; r < E.ROWS; r++) {
    const row = new Array<number>(E.COLS).fill(0);
    if (style === 'cheese') {
      row.fill(1);
      row[rng.int(0, E.COLS - 1)] = 0;
      if (rng.chance(0.3)) row[rng.int(0, E.COLS - 1)] = 0;
    } else if (style === 'well') {
      row.fill(1);
      row[well] = 0;
    } else {
      const density = style === 'tall' ? 0.3 + 0.4 * rng.next() : 0.4 + 0.5 * rng.next();
      for (let c = 0; c < E.COLS; c++) row[c] = rng.chance(density) ? 1 : 0;
      if (row.every(x => x === 1)) row[rng.int(0, E.COLS - 1)] = 0;
    }
    for (let c = 0; c < E.COLS; c++) bits[r * E.COLS + c] = row[c];
  }
  return bits;
}

const MOVES = [A.Left, A.Right, A.Soft, A.Cw, A.Ccw, A.Rot180] as const;

/** Every placement reachable from the current state, with the shortest action path to it. */
function placements(s: E.GameState): { path: number[]; after: E.GameState }[] {
  const key = (st: E.GameState) => {
    const a = st.active!;
    return `${a.rot},${a.row},${a.col},${st.lastRotate ? 1 : 0}`;
  };
  const seen = new Map<string, number[]>([[key(s), []]]);
  const frontier: { st: E.GameState; path: number[] }[] = [{ st: s, path: [] }];
  const best = new Map<string, { st: E.GameState; path: number[] }>();
  for (let i = 0; i < frontier.length; i++) {
    const { st, path } = frontier[i];
    const a = st.active!;
    const land = E.dropRow(st.board, a.piece, a.rot, a.row, a.col);
    const spin = st.lastRotate && land === a.row;
    const pk = `${a.rot},${land},${a.col},${spin ? 1 : 0}`;
    if (!best.has(pk)) best.set(pk, { st, path });
    for (const m of MOVES) {
      const nx = E.step(st, m);
      if (nx === st) continue;
      const k = key(nx);
      if (seen.has(k)) continue;
      const np = [...path, m];
      seen.set(k, np);
      frontier.push({ st: nx, path: np });
    }
  }
  return [...best.values()].map(({ st, path }) => ({ path: [...path, A.Hard], after: E.step(st, A.Hard) }));
}

function holes(board: E.Board): number {
  let n = 0;
  for (let c = 0; c < E.COLS; c++) {
    let roof = false;
    for (let r = 0; r < E.ROWS; r++) {
      if (board[r][c] !== E.EMPTY) roof = true;
      else if (roof) n++;
    }
  }
  return n;
}

function stackHeight(board: E.Board): number {
  for (let r = 0; r < E.ROWS; r++) if (board[r].some(c => c !== E.EMPTY)) return E.ROWS - r;
  return 0;
}

/** A bot that plays the puzzle "for real": BFS over reachable placements, greedy-ish scoring
 *  that likes attack, T-spins, clears and a flat stack, plus noise / holds / junk inputs. */
function playGame(rng: Rng, board: E.Board, queue: number[], noHold: boolean): number[] {
  const noise = rng.pick([0.5, 2, 6]);
  const holdRate = rng.pick([0, 0.15, 0.4]);
  const junkRate = rng.pick([0, 0.1, 0.3]);
  let s = E.newGame(board, queue, noHold);
  const out: number[] = [];
  const apply = (a: number) => { out.push(a); s = E.step(s, a); };
  let guard = 0;
  while (s.status === 'playing' && guard++ < 200) {
    if (rng.chance(junkRate)) {
      // a few random inputs, effective or not (replay must skip the ineffective ones)
      for (let k = rng.int(1, 3); k > 0 && s.status === 'playing'; k--) {
        apply(rng.pick([A.Left, A.Right, A.Cw, A.Ccw, A.Rot180, A.Soft, A.Hold]));
      }
      if (s.status !== 'playing') break;
    }
    if (rng.chance(holdRate) && (E.canHold(s) || noHold)) {
      apply(A.Hold);
      if (s.status !== 'playing') break;
    }
    const opts = placements(s);
    let bestScore = -Infinity;
    let choice = opts[0];
    for (const o of opts) {
      const lk = o.after.lastLock!;
      let score = lk.attack * 3 + lk.lines + (lk.tspin ? 8 : 0) + (lk.pc ? 30 : 0);
      if (o.after.status === 'topout') score -= 1000;
      score -= holes(o.after.board) * 1.5 + stackHeight(o.after.board) * 0.4;
      score += rng.next() * noise;
      if (score > bestScore) { bestScore = score; choice = o; }
    }
    for (const a of choice.path) apply(a);
  }
  return out;
}

/** Purely random inputs, weighted toward movement with frequent hard drops. */
function chaosGame(rng: Rng, board: E.Board, queue: number[], noHold: boolean): number[] {
  const weights: [number, number][] = [
    [A.Left, 4], [A.Right, 4], [A.Cw, 2], [A.Ccw, 2], [A.Rot180, 1], [A.Soft, 3], [A.Hold, 1], [A.Hard, 2],
  ];
  const total = weights.reduce((t, [, w]) => t + w, 0);
  let s = E.newGame(board, queue, noHold);
  const out: number[] = [];
  while (s.status === 'playing' && out.length < 600) {
    let x = rng.next() * total;
    let a: number = A.Hard;
    for (const [act, w] of weights) { if ((x -= w) < 0) { a = act; break; } }
    out.push(a);
    s = E.step(s, a);
  }
  return out;
}

function randomQueue(rng: Rng, style: string): number[] {
  const len = rng.chance(0.1) ? rng.int(12, 30) : rng.int(1, 9);
  const queue = Array.from({ length: len }, () => rng.int(0, 6));
  // T-slot boards: make sure a T turns up early
  if (style === 'tslot') queue[rng.chance(0.6) ? 0 : rng.int(0, Math.min(2, len - 1))] = 2;
  return queue;
}

/** Requirements derived from what the solution actually achieves: met, or just out of reach. */
function deriveRequirements(rng: Rng, bits: number[], queue: number[], noHold: boolean, sol: number[]): number[] {
  const base = [0, 0, 0, 0, 0, 0, 0, noHold ? 1 : 0];
  const r0 = E.replay(E.boardFromBits(bits), E.queueFromApi(queue), base, sol);
  const counts = E.ledgerCounts(r0.ledger);
  const reqs = base.slice();
  for (let i = 0; i < 7; i++) {
    if (rng.chance(0.5)) reqs[i] = Math.min(255, rng.chance(0.6) ? counts[i] : rng.int(0, counts[i]));
  }
  if (rng.chance(0.3)) {
    const i = rng.int(0, 6);
    reqs[i] = Math.min(255, counts[i] + rng.int(1, 2));
  }
  return reqs;
}

const rng = mulberry32(0x5eed2026);
const tally: Record<string, number> = {};

for (let g = 0; g < 300; g++) {
  const style = rng.pick(['cheese', 'cheese', 'messy', 'well', 'empty', 'tall', 'tslot', 'tslot'] as const);
  const bits = randomBoard(rng, style);
  const queue = randomQueue(rng, style);
  const noHold = rng.chance(0.2);
  const chaos = g % 6 === 5;
  const board = E.boardFromBits(bits);
  const sol = chaos ? chaosGame(rng, board, E.queueFromApi(queue), noHold)
    : playGame(rng, board, E.queueFromApi(queue), noHold);
  const reqs = deriveRequirements(rng, bits, queue, noHold, sol);
  const tag = chaos ? 'chaos' : 'bot';
  const r = add(`random_${tag}_${g}`, bits, queue, reqs, sol);
  tally[r.error ?? 'ok'] = (tally[r.error ?? 'ok'] ?? 0) + 1;

  // one mutation of most games, to cover the error paths on realistic streams
  const m = rng.int(0, 5);
  let mutated: number[] | null = null;
  let mname = '';
  if (m === 0 && sol.length > 1) { mutated = sol.slice(0, rng.int(0, sol.length - 1)); mname = 'truncated'; }
  else if (m === 1) { mutated = [...sol, rng.int(0, 7)]; mname = 'extra'; }
  else if (m === 2) {
    mutated = sol.slice();
    mutated.splice(rng.int(0, sol.length), 0, rng.int(8, 255));
    mname = 'badbyte';
  } else if (m === 3 && sol.length > 0) {
    // flip one action to a different valid one
    mutated = sol.slice();
    const i = rng.int(0, sol.length - 1);
    mutated[i] = (mutated[i] + rng.int(1, 7)) % 8;
    mname = 'flipped';
  }
  if (mutated) {
    const rm = add(`random_${tag}_${g}_${mname}`, bits, queue, reqs, mutated);
    tally[rm.error ?? 'ok'] = (tally[rm.error ?? 'ok'] ?? 0) + 1;
  }
}

// ---------------------------------------------------------------------------
// write
// ---------------------------------------------------------------------------

const totals = cases.reduce((t, c) => {
  const l = c.expected.ledger;
  t.tss += l.tss; t.tsd += l.tsd; t.tst += l.tst; t.tetris += l.tetris; t.pc += l.pc;
  t.lines += l.lines; t.b2b += c.expected.ledger.b2b; t.combo2 += l.maxCombo >= 2 ? 1 : 0;
  return t;
}, { tss: 0, tsd: 0, tst: 0, tetris: 0, pc: 0, lines: 0, b2b: 0, combo2: 0 });

const header = {
  _comment: 'GENERATED by `node shared/gen-fixtures.ts` from frontend/src/game/engine.ts — do not edit. '
    + 'Checked by crates/server/src/engine.rs (cargo test).',
  version: 1,
};
const body = cases.map(c => '    ' + JSON.stringify(c)).join(',\n');
const json = `{\n  "_comment": ${JSON.stringify(header._comment)},\n  "version": ${header.version},\n  "cases": [\n${body}\n  ]\n}\n`;
const outPath = new URL('./engine-fixtures.json', import.meta.url);
writeFileSync(outPath, json);
console.log(`wrote ${cases.length} cases to shared/engine-fixtures.json`);
console.log('outcomes:', tally);
console.log('totals across all cases:', totals);
