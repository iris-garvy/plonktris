import { describe, expect, it } from 'vitest';
import { Action } from './engine';
import { InputController, type InputClock, type InputTarget } from './input';
import { DEFAULT_BINDINGS, migrateBindings, type Handling } from '../keybindings';

/** Manual clock: frames only run when the test advances time. */
class FakeClock implements InputClock {
  t = 0;
  private frames = new Map<number, () => void>();
  private nextId = 1;
  now() { return this.t; }
  requestFrame(cb: () => void) { const id = this.nextId++; this.frames.set(id, cb); return id; }
  cancelFrame(id: number) { this.frames.delete(id); }
  /** advance to `until`, running pending frames every `step` ms (default ~60 fps) */
  advance(ms: number, step = 1000 / 60) {
    const end = this.t + ms;
    while (this.t + step <= end + 1e-9) {
      this.t += step;
      this.runFrames();
    }
    if (this.t < end) { this.t = end; this.runFrames(); }
  }
  runFrames() {
    const due = [...this.frames.values()];
    this.frames.clear();
    for (const cb of due) cb();
  }
}

/** A 10-wide, 21-tall field with a 1x1 "piece": enough to observe movement. */
class FakeGame implements InputTarget {
  col = 4;
  row = 0;
  log: { action: number; press: number; t: number }[] = [];
  constructor(private clock: FakeClock) {}
  act(action: number, press: number) {
    let ok = false;
    if (action === Action.Left && this.col > 0) { this.col--; ok = true; }
    else if (action === Action.Right && this.col < 9) { this.col++; ok = true; }
    else if (action === Action.Soft && this.row < 20) { this.row++; ok = true; }
    else if (action === Action.Hard) { this.col = 4; this.row = 0; ok = true; } // lock + new piece
    else if (action === Action.Cw || action === Action.Ccw || action === Action.Rot180) ok = true;
    if (ok) this.log.push({ action, press, t: this.clock.now() });
    return ok;
  }
  undoCalls = 0;
  undo() { this.undoCalls++; this.col = 4; this.row = 0; }
}

function setup(handling: Partial<Handling> = {}) {
  const clock = new FakeClock();
  const game = new FakeGame(clock);
  const h: Handling = { das: 100, arr: 20, softDrop: 50, ...handling };
  const ctrl = new InputController(game, { bindings: DEFAULT_BINDINGS, handling: h, clock });
  const down = (key: string, extra: Record<string, unknown> = {}) => ctrl.handleKeyDown({ key, ...extra });
  const up = (key: string, extra: Record<string, unknown> = {}) => ctrl.handleKeyUp({ key, ...extra });
  return { clock, game, ctrl, down, up };
}

describe('InputController — horizontal DAS / ARR', () => {
  it('moves on press, waits DAS, then repeats every ARR', () => {
    const { clock, game, down, up } = setup({ das: 100, arr: 20 });
    down('ArrowLeft');
    expect(game.col).toBe(3); // immediate
    clock.advance(99, 1);
    expect(game.col).toBe(3); // still charging
    clock.advance(1, 1);
    expect(game.col).toBe(2); // DAS reached: first repeat
    clock.advance(20, 1);
    expect(game.col).toBe(1);
    clock.advance(19, 1);
    expect(game.col).toBe(1);
    clock.advance(1, 1);
    expect(game.col).toBe(0);
    up('ArrowLeft');
    clock.advance(200, 1);
    expect(game.col).toBe(0);
  });

  it('keeps the right average rate at 60 fps (several repeats per frame when ARR < frame)', () => {
    const { clock, game, down } = setup({ das: 50, arr: 5 });
    game.col = 0;
    down('ArrowRight');
    expect(game.col).toBe(1);
    clock.advance(1000 / 60 * 3); // 50ms: DAS charges on the 3rd frame
    expect(game.col).toBe(2);
    clock.advance(1000 / 60); // +16.7ms → 3 more repeats (at 55, 60, 65)
    expect(game.col).toBe(5);
  });

  it('ARR 0 goes straight to the wall once DAS charges', () => {
    const { clock, game, down } = setup({ das: 100, arr: 0 });
    down('ArrowRight');
    expect(game.col).toBe(5);
    clock.advance(90);
    expect(game.col).toBe(5);
    clock.advance(20);
    expect(game.col).toBe(9);
  });

  it('DAS 0 + ARR 0 is instant on press', () => {
    const { game, down } = setup({ das: 0, arr: 0 });
    down('ArrowLeft');
    expect(game.col).toBe(0);
  });

  it('ignores OS auto-repeat keydowns and prevents default on bound keys', () => {
    const { game, down } = setup();
    let prevented = 0;
    const preventDefault = () => { prevented++; };
    down('ArrowLeft', { preventDefault });
    down('ArrowLeft', { repeat: true, preventDefault });
    down('ArrowLeft', { repeat: true, preventDefault });
    expect(game.col).toBe(3);
    expect(prevented).toBe(3);
    expect(down('q', { preventDefault })).toBe(false); // unbound: untouched
    expect(prevented).toBe(3);
  });

  it('most recent direction wins; releasing it falls back to the other', () => {
    const { clock, game, down, up } = setup({ das: 100, arr: 20 });
    down('ArrowLeft');
    expect(game.col).toBe(3);
    clock.advance(50, 1);
    down('ArrowRight'); // takes over immediately, with its own DAS
    expect(game.col).toBe(4);
    clock.advance(99, 1);
    expect(game.col).toBe(4); // left is suppressed, right still charging
    clock.advance(1, 1);
    expect(game.col).toBe(5);
    up('ArrowRight'); // left still held → resumes as a fresh press
    expect(game.col).toBe(4);
    clock.advance(99, 1);
    expect(game.col).toBe(4);
    clock.advance(1, 1);
    expect(game.col).toBe(3);
    up('ArrowLeft');
    clock.advance(100, 1);
    expect(game.col).toBe(3);
  });

  it('releasing the suppressed direction changes nothing', () => {
    const { clock, game, down, up } = setup({ das: 100, arr: 20 });
    down('ArrowLeft');
    down('ArrowRight');
    up('ArrowLeft');
    clock.advance(100, 1);
    expect(game.col).toBe(5); // right kept charging
  });

  it('DAS charge carries over to the next piece (ARR 0: new piece goes to the wall)', () => {
    const { clock, game, down } = setup({ das: 100, arr: 0 });
    down('ArrowLeft');
    clock.advance(120);
    expect(game.col).toBe(0);
    down(' '); // hard drop → new piece at col 4
    expect(game.col).toBe(0); // moved before anything rendered
  });

  it('DAS carry-over with ARR > 0: the new piece moves immediately, then at ARR', () => {
    const { clock, game, down } = setup({ das: 100, arr: 30 });
    down('ArrowLeft');
    clock.advance(300, 1); // at the wall
    expect(game.col).toBe(0);
    down(' ');
    expect(game.col).toBe(3);
    clock.advance(29, 1);
    expect(game.col).toBe(3);
    clock.advance(1, 1);
    expect(game.col).toBe(2);
  });

  it('an uncharged direction does not carry over until DAS completes', () => {
    const { clock, game, down } = setup({ das: 100, arr: 0 });
    down('ArrowLeft'); // col 3
    clock.advance(40, 1);
    down(' '); // new piece at col 4, DAS not charged yet
    expect(game.col).toBe(4);
    clock.advance(60, 1); // DAS completes while still held
    expect(game.col).toBe(0);
  });

  it('undo re-arms DAS for a held direction', () => {
    const { clock, game, down, ctrl } = setup({ das: 100, arr: 0 });
    down('ArrowLeft');
    clock.advance(150, 1);
    expect(game.col).toBe(0);
    down('z', { metaKey: true }); // mod+z = undo
    expect(game.undoCalls).toBe(1);
    expect(game.col).toBe(4);
    clock.advance(99, 1);
    expect(game.col).toBe(4);
    clock.advance(2, 1);
    expect(game.col).toBe(0);
    expect(ctrl.isHeld('left')).toBe(true);
  });

  it('keyup matches the base key and the physical key (modifier / shift changes)', () => {
    const { ctrl, down, up } = setup();
    down('ArrowLeft', { code: 'ArrowLeft' });
    expect(ctrl.isHeld('left')).toBe(true);
    up('ArrowLeft', { metaKey: true });
    expect(ctrl.isHeld('left')).toBe(false);

    const custom = setup();
    custom.ctrl.setBindings({ ...DEFAULT_BINDINGS, left: ',' });
    custom.down(',', { code: 'Comma' });
    custom.up('<', { code: 'Comma' }); // released with shift held: different key, same code
    expect(custom.ctrl.isHeld('left')).toBe(false);
  });

  it('blur / disable release everything', () => {
    const { clock, game, ctrl, down } = setup({ das: 100, arr: 20 });
    down('ArrowLeft');
    ctrl.releaseAll(); // what window blur does
    clock.advance(300, 1);
    expect(game.col).toBe(3);

    down('ArrowRight');
    ctrl.setDisabled(true);
    clock.advance(300, 1);
    expect(game.col).toBe(4);
    expect(down('ArrowRight')).toBe(false); // disabled: not handled at all
    expect(game.col).toBe(4);
  });

  it('ignores keys typed into inputs or inside a modal', () => {
    const { game, down } = setup();
    expect(down('ArrowLeft', { target: { tagName: 'INPUT' } })).toBe(false);
    expect(down('ArrowLeft', { target: { tagName: 'DIV', closest: (s: string) => (s === '.modal-overlay' ? {} : null) } })).toBe(false);
    expect(game.col).toBe(4);
    expect(down('ArrowLeft', { target: { tagName: 'DIV', closest: () => null } })).toBe(true);
    expect(game.col).toBe(3);
  });

  it('ignores keydowns another handler already consumed', () => {
    const { game, down } = setup();
    expect(down('ArrowLeft', { defaultPrevented: true })).toBe(false);
    expect(game.col).toBe(4);
  });
});

describe('InputController — soft drop', () => {
  it('one row on press, then one row every `softDrop` ms', () => {
    const { clock, game, down, up } = setup({ softDrop: 50 });
    down('ArrowDown');
    expect(game.row).toBe(1);
    clock.advance(49, 1);
    expect(game.row).toBe(1);
    clock.advance(1, 1);
    expect(game.row).toBe(2);
    clock.advance(100, 1);
    expect(game.row).toBe(4);
    up('ArrowDown');
    clock.advance(200, 1);
    expect(game.row).toBe(4);
  });

  it('softDrop 0 = instantly to the floor, and keeps new pieces on the floor while held', () => {
    const { clock, game, down } = setup({ softDrop: 0 });
    down('ArrowDown');
    expect(game.row).toBe(20);
    down(' '); // new piece
    expect(game.row).toBe(20);
    clock.advance(50);
    expect(game.row).toBe(20);
  });
});

describe('InputController — discrete actions', () => {
  it('rotations / hold / hard drop fire once per keydown and report their press id', () => {
    const { game, down } = setup();
    down('ArrowUp');
    down('ArrowUp', { repeat: true });
    down('z');
    down('a');
    expect(game.log.map(l => l.action)).toEqual([Action.Cw, Action.Ccw, Action.Rot180]);
    expect(new Set(game.log.map(l => l.press)).size).toBe(3);
  });

  it('auto-repeats share the press id of their key', () => {
    const { clock, game, down } = setup({ das: 50, arr: 10 });
    down('ArrowRight');
    clock.advance(100, 1);
    const presses = new Set(game.log.map(l => l.press));
    expect(game.log.length).toBeGreaterThan(3);
    expect(presses.size).toBe(1);
  });

  it('mod+key bindings need the modifier; plain key does not trigger them', () => {
    const { game, down } = setup();
    down('z'); // rotate ccw, not undo
    expect(game.undoCalls).toBe(0);
    down('z', { ctrlKey: true });
    expect(game.undoCalls).toBe(1);
    expect(down('r', { metaKey: true })).toBe(false); // ⌘R reloads the page, not restart
  });
});

describe('bindings migration', () => {
  it('maps the old clearBoard key onto restart and adds rotate180', () => {
    const old = {
      left: 'ArrowLeft', right: 'ArrowRight', softDrop: 'ArrowDown', rotateCw: 'ArrowUp',
      rotateCcw: 'z', hold: 'c', place: ' ', undo: 'mod+z', clearBoard: 'Backspace',
    };
    const b = migrateBindings(old);
    expect(b.restart).toBe('Backspace');
    expect(b.rotate180).toBe('a');
    expect('clearBoard' in b).toBe(false);
  });

  it('leaves a new action unbound when its default key is already taken', () => {
    const b = migrateBindings({ ...DEFAULT_BINDINGS, rotate180: undefined, hold: 'a' });
    expect(b.hold).toBe('a');
    expect(b.rotate180).toBe('');
  });

  it('empty storage → defaults', () => {
    expect(migrateBindings({})).toEqual(DEFAULT_BINDINGS);
    expect(migrateBindings(null)).toEqual(DEFAULT_BINDINGS);
  });
});
