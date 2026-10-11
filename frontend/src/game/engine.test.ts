import { describe, expect, it } from 'vitest';
import {
  Action, I, J, O, T, canHold, emptyBoard, newGame, replay, step, type Board, type GameState,
} from './engine';

/** Rows of '.'/'X', bottom-aligned onto an empty board. */
function boardFrom(rows: string[]): Board {
  const b = emptyBoard();
  const off = b.length - rows.length;
  rows.forEach((r, i) => { for (let c = 0; c < 10; c++) if (r[c] === 'X') b[off + i][c] = 8; });
  return b;
}

function run(s: GameState, actions: number[]): GameState {
  for (const a of actions) {
    const n = step(s, a);
    expect(n, `action ${a} should be effective`).not.toBe(s);
    s = n;
  }
  return s;
}

const soft = (n: number) => Array<number>(n).fill(Action.Soft);

describe('engine rules', () => {
  it('T-spin double through an SRS kick', () => {
    // overhangs at row 18 cols 2 and 5: the T can't drop into the slot, only kick into it
    const board = boardFrom([
      'XXX..X....',
      'XXX...XXXX',
      'XXXX.XXXXX',
    ]);
    let s = newGame(board, [T]);
    s = run(s, [Action.Cw, Action.Left, ...soft(17)]);
    expect(s.active).toEqual({ piece: T, rot: 1, row: 17, col: 2 });
    expect(step(s, Action.Soft)).toBe(s); // resting

    s = run(s, [Action.Cw]);
    // tests (0,0) and (1,0) are blocked; (1,-1) moves it right one and down one
    expect(s.active).toEqual({ piece: T, rot: 2, row: 18, col: 3 });
    expect(s.lastRotate).toBe(true);

    s = run(s, [Action.Hard]);
    expect(s.lastLock).toMatchObject({ tspin: true, lines: 2 });
    expect(s.ledger.tsd).toBe(1);
    expect(s.status).toBe('done');
  });

  it('a hard drop that falls cancels the spin', () => {
    const board = boardFrom(['XXXX.XXXXX']);
    let s = newGame(board, [T, O]);
    s = run(s, [Action.Rot180, Action.Hard]); // rotated at the top, then fell
    expect(s.lastLock?.tspin).toBe(false);
  });

  it('hold works once per piece', () => {
    let s = newGame(emptyBoard(), [T, I, O, J]);
    s = run(s, [Action.Hold]);
    expect(s.hold).toBe(T);
    expect(s.active?.piece).toBe(I);
    expect(s.holdUsed).toBe(true);
    expect(canHold(s)).toBe(false);
    expect(step(s, Action.Hold)).toBe(s); // second hold on the same piece: no-op

    s = run(s, [Action.Hard]); // I locks, O spawns, hold available again
    expect(s.active?.piece).toBe(O);
    expect(canHold(s)).toBe(true);
    s = run(s, [Action.Hold]); // swap with the held T
    expect(s.active?.piece).toBe(T);
    expect(s.hold).toBe(O);
  });

  it('NO HOLD disables hold entirely', () => {
    const s = newGame(emptyBoard(), [T, I], true);
    expect(canHold(s)).toBe(false);
    expect(step(s, Action.Hold)).toBe(s);
  });

  it('when the queue runs out the held piece comes out by itself', () => {
    let s = newGame(emptyBoard(), [T, I]);
    s = run(s, [Action.Hold]); // hold T, play I (queue now exhausted)
    expect(s.next).toBe(2);
    s = run(s, [Action.Hard]);
    expect(s.active?.piece).toBe(T);
    expect(s.hold).toBeNull();
    expect(s.status).toBe('playing');
    s = run(s, [Action.Hard]);
    expect(s.status).toBe('done');
    expect(s.placed).toBe(2);
  });

  it('with an empty hold and an empty queue, hold is a no-op', () => {
    const s = newGame(emptyBoard(), [T]);
    expect(canHold(s)).toBe(false);
    expect(step(s, Action.Hold)).toBe(s);
  });

  it('180 rotation: in place, no kicks; O never rotates', () => {
    let s = newGame(emptyBoard(), [T, O]);
    s = run(s, [Action.Rot180]);
    expect(s.active).toEqual({ piece: T, rot: 2, row: 0, col: 3 });
    expect(s.lastRotate).toBe(true);

    // blocked in place → 180 has no kicks → no-op, while a kickable CW still works
    const board = emptyBoard();
    board[2][4] = 8; // where the stem of a downward T would go
    let b = newGame(board, [T]);
    expect(step(b, Action.Rot180)).toBe(b);
    b = run(b, [Action.Cw]);
    expect(b.active).toMatchObject({ rot: 1, col: 2 }); // kicked left

    let o = newGame(emptyBoard(), [O]);
    expect(step(o, Action.Rot180)).toBe(o);
    expect(step(o, Action.Cw)).toBe(o);
    o = run(o, [Action.Left]);
    expect(o.active?.col).toBe(3);
  });

  it('ineffective actions return the same object (and keep the spin flag)', () => {
    let s = newGame(emptyBoard(), [T, I], true);
    s = run(s, [Action.Cw]);
    expect(s.lastRotate).toBe(true);
    expect(step(s, Action.Hold)).toBe(s); // NO HOLD
    let wall = s;
    while (step(wall, Action.Right) !== wall) wall = step(wall, Action.Right);
    wall = run(wall, [Action.Ccw, Action.Cw]);
    expect(wall.lastRotate).toBe(true);
    expect(step(wall, Action.Right)).toBe(wall);
    expect(wall.lastRotate).toBe(true);
  });

  it('replay agrees with stepping', () => {
    const board = boardFrom(['XXX..X....', 'XXX...XXXX', 'XXXX.XXXXX']);
    const sol = [Action.Cw, Action.Left, ...soft(17), Action.Cw, Action.Hard];
    expect(replay(board, [T], [0, 1, 0, 0, 0, 0, 0, 0], sol)).toMatchObject({ ok: true });
    expect(replay(board, [T], [0, 2, 0, 0, 0, 0, 0, 0], sol)).toMatchObject({ ok: false, error: 'requirements' });
    expect(replay(board, [T], [0, 1, 0, 0, 0, 0, 0, 0], [...sol, Action.Left])).toMatchObject({ error: 'trailing' });
  });
});
