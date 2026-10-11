import { describe, expect, it } from 'vitest';
import { Action, I, O, T, emptyBoard, replay, type Board } from './engine';
import { PuzzleSession, type SessionResult } from './session';

function boardFrom(rows: string[]): Board {
  const b = emptyBoard();
  const off = b.length - rows.length;
  rows.forEach((r, i) => { for (let c = 0; c < 10; c++) if (r[c] === 'X') b[off + i][c] = 8; });
  return b;
}

const TSD = {
  board: boardFrom(['XXX..X....', 'XXX...XXXX', 'XXXX.XXXXX']),
  queue: [T, I],
  requirements: [0, 1, 0, 0, 0, 0, 0, 0],
};
const TSD_MOVES = [Action.Cw, Action.Left, ...Array<number>(17).fill(Action.Soft), Action.Cw, Action.Hard];

describe('PuzzleSession', () => {
  it('records only effective actions and finishes once with a replayable solution', () => {
    let t = 1000;
    const s = new PuzzleSession(TSD, () => t);
    const results: SessionResult[] = [];
    s.callbacks.onFinish = r => results.push(r);

    expect(s.act(Action.Hold)).toBe(true); // hold T, I comes in
    expect(s.act(Action.Hold)).toBe(false); // once per piece
    expect(s.getSolution()).toEqual([Action.Hold]);
    s.undo(); // nothing placed yet: back to the very start
    expect(s.getSolution()).toEqual([]);
    expect(s.game.hold).toBeNull();

    for (const a of TSD_MOVES) { t += 10; s.act(a, a); }
    expect(s.game.ledger.tsd).toBe(1);
    expect(s.getSnapshot().lock?.event).toMatchObject({ tspin: true, lines: 2 });
    t += 10;
    s.act(Action.Hard, 999); // the I
    expect(results).toHaveLength(1);
    const r = results[0];
    expect(r.success).toBe(true);
    expect(r.pieces).toBe(2);
    expect(r.timeMs).toBe(10 * (TSD_MOVES.length + 1)); // clock started at the (undone) hold: undo keeps time running
    expect(replay(TSD.board, TSD.queue, TSD.requirements, r.solution).ok).toBe(true);
    expect(s.act(Action.Left)).toBe(false); // game over: nothing records
  });

  it('undo goes back to the start of the previous piece and voids a finish', () => {
    const s = new PuzzleSession({ board: emptyBoard(), queue: [O, O], requirements: [0, 0, 0, 0, 0, 1, 0, 0] });
    let resets = 0;
    let finishes = 0;
    s.callbacks = { onFinish: () => finishes++, onReset: () => resets++ };
    s.act(Action.Left);
    s.act(Action.Hard);
    s.act(Action.Right);
    s.act(Action.Right);
    expect(s.getSolution()).toHaveLength(4);
    s.undo(); // back to the start of the first piece (both pieces' actions gone)
    expect(s.getSolution()).toEqual([]);
    expect(s.game.placed).toBe(0);

    s.act(Action.Hard);
    s.act(Action.Hard);
    expect(finishes).toBe(1); // failed (no attack), but finished
    s.undo(); // back to the start of the last piece
    expect(resets).toBe(1);
    expect(s.game.status).toBe('playing');
    expect(s.game.placed).toBe(1);
    expect(s.getSolution()).toEqual([Action.Hard]);
  });

  it('counts each key press once, however many moves it made', () => {
    const s = new PuzzleSession({ board: emptyBoard(), queue: [T], requirements: [0, 0, 0, 0, 0, 1, 0, 0] });
    s.act(Action.Left, 1);
    s.act(Action.Left, 1);
    s.act(Action.Left, 1);
    s.act(Action.Left, 1); // blocked: not effective
    s.act(Action.Cw, 2);
    expect(s.getSnapshot().keys).toBe(2);
    s.restart();
    expect(s.getSnapshot().keys).toBe(0);
    expect(s.getSnapshot().startedAt).toBeNull();
  });
});
