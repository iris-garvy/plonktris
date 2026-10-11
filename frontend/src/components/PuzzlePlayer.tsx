// Plays one puzzle: owns a PuzzleSession (engine state + recorded solution), drives it with the
// InputController, and draws board / hold / queue / requirement progress / lock call-outs.
import {
  memo, useEffect, useImperativeHandle, useMemo, useRef, useState, useSyncExternalStore,
  type CSSProperties, type ReactNode, type Ref,
} from 'react';
import {
  REQUIREMENT_NAMES, canHold, ghostRow, ledgerCounts,
  type Board, type Ledger, type LockEvent, type Requirements,
} from '../game/engine';
import { InputController } from '../game/input';
import { PuzzleSession } from '../game/session';
import { keyLabelShort, type BindingAction, type Bindings, type Handling } from '../keybindings';
import Playfield from './Playfield';
import PieceMini from './PieceMini';
import TouchControls, { useCoarsePointer } from './TouchControls';
import { useCellSize } from './useCellSize';
import './PuzzlePlayer.css';

export interface PuzzleSpec {
  board: Board;
  /** client piece ids 1-7 */
  queue: number[];
  /** 8-byte API format; [7] = NO HOLD (hold disabled) */
  requirements: Requirements;
}

export interface FinishResult {
  /** every piece placed AND requirements met */
  success: boolean;
  /** flat action bytes — exactly what the server replays */
  solution: number[];
  ledger: Ledger;
  /** first input → final lock */
  timeMs: number;
  /** key presses that did something */
  keys: number;
  pieces: number;
}

export interface PuzzlePlayerHandle {
  restart(): void;
  undo(): void;
}

export interface PuzzlePlayerProps {
  puzzle: PuzzleSpec;
  bindings: Bindings;
  handling: Handling;
  /** fires once when the last piece locks (success or not) */
  onFinish: (result: FinishResult) => void;
  /** fires when a restart/undo voids a previously finished run */
  onReset?: () => void;
  /** drawn centered over the board (result card etc.) */
  overlay?: ReactNode;
  /** rendered under the hold box */
  sidePanel?: ReactNode;
  /** ignore keyboard input (e.g. while a modal is open) */
  disabled?: boolean;
  ref?: Ref<PuzzlePlayerHandle>;
}

/** Content key, so a parent re-creating an identical puzzle object doesn't reset the run. */
function puzzleKey(p: PuzzleSpec): string {
  return JSON.stringify([p.board, p.queue, p.requirements]);
}

export default function PuzzlePlayer({
  puzzle, bindings, handling, onFinish, onReset, overlay, sidePanel, disabled, ref,
}: PuzzlePlayerProps) {
  // one session per puzzle (re-created when the puzzle's content changes)
  const key = puzzleKey(puzzle);
  const [current, setCurrent] = useState(() => ({ key, session: new PuzzleSession(puzzle) }));
  let session = current.session;
  if (current.key !== key) {
    session = new PuzzleSession(puzzle);
    setCurrent({ key, session });
  }
  const snap = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const game = snap.game;

  // latest callbacks without re-subscribing
  const callbacks = useRef({ onFinish, onReset });
  useEffect(() => { callbacks.current = { onFinish, onReset }; });
  useEffect(() => {
    session.setCallbacks({
      onFinish: r => callbacks.current.onFinish(r),
      onReset: () => callbacks.current.onReset?.(),
    });
    return () => session.setCallbacks({});
  }, [session]);

  // keyboard: one controller for the component's lifetime; config + target are pushed in below
  const [ctrl] = useState(() => new InputController(null, { bindings, handling }));
  useEffect(() => ctrl.attach(window), [ctrl]);
  useEffect(() => { ctrl.setBindings(bindings); }, [ctrl, bindings]);
  useEffect(() => { ctrl.setHandling(handling); }, [ctrl, handling]);
  useEffect(() => { ctrl.setDisabled(!!disabled); }, [ctrl, disabled]);
  useEffect(() => {
    ctrl.setTarget({
      act: (a, press) => session.act(a, press),
      undo: () => session.undo(),
      restart: () => session.restart(),
    });
  }, [ctrl, session]);

  useImperativeHandle(ref, () => ({
    restart: () => session.restart(),
    undo: () => session.undo(),
  }), [session]);

  // layout: hold column (3.4) + gap (0.4) + board (10) + gap + queue column (3.4)
  const rootRef = useRef<HTMLDivElement>(null);
  const cell = useCellSize(rootRef, { units: 17.6, extra: 6, rows: 24.5 });
  const coarse = useCoarsePointer();

  const ghost = ghostRow(game);
  const holdState = game.noHold ? 'off' : canHold(game) ? 'ready' : 'used';
  const remaining = game.queue.slice(game.next);
  const total = game.queue.length;
  const finished = game.status !== 'playing';

  return (
    <div
      ref={rootRef}
      className={`pp${coarse ? ' pp-coarse' : ''}`}
      style={{ '--cell': `${cell}px` } as CSSProperties}
      // read-only hooks for tests / tooling: piece:rot:row:col, status, recorded actions
      data-active={game.active ? `${game.active.piece}:${game.active.rot}:${game.active.row}:${game.active.col}` : ''}
      data-status={game.status}
      data-moves={snap.moves}
    >
      <div className="pp-chips">
        <RequirementChips requirements={puzzle.requirements} ledger={game.ledger} />
      </div>

      <div className="pp-label pp-hold-label">hold</div>
      <div className="pp-left">
        <div
          className={`pp-hold ${holdState}`}
          title={holdState === 'off' ? 'hold is disabled for this puzzle' : holdState === 'used' ? 'hold already used for this piece' : undefined}
        >
          {holdState === 'off'
            ? <span className="pp-hold-off">off</span>
            : game.hold != null && <PieceMini pieceId={game.hold} dimmed={holdState === 'used'} />}
        </div>
        <LockCallout lock={snap.lock} />
        {sidePanel != null && <div className="pp-side">{sidePanel}</div>}
      </div>

      <div className="pp-board">
        <Playfield
          board={game.board}
          active={game.active}
          ghostRow={ghost}
          cellSize={cell}
          faded={game.status === 'topout'}
          label="puzzle board"
        />
        {game.status === 'topout' && overlay == null && (
          <div className="pp-banner">topped out — undo or restart</div>
        )}
        {overlay != null && <div className="pp-overlay">{overlay}</div>}
      </div>

      <div className="pp-label pp-next-label">next</div>
      <div className="pp-right">
        <NextQueue pieces={remaining} />
        <div className="pp-stats">
          <div className="pp-stat">
            <span>piece</span>
            <b>{Math.min(game.placed + (finished ? 0 : 1), total)}/{total}</b>
          </div>
          <div className="pp-stat">
            <span>time</span>
            <b><Timer startedAt={snap.startedAt} finishedAt={snap.finishedAt} /></b>
          </div>
          <div className="pp-stat">
            <span>keys</span>
            <b>{snap.keys}</b>
          </div>
        </div>
      </div>

      <div className="pp-foot">
        {snap.atMoveLimit && <div className="pp-warn">move limit reached — undo or restart</div>}
        {coarse
          ? <TouchControls controller={ctrl} noHold={game.noHold} />
          : <ControlsHint bindings={bindings} noHold={game.noHold} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// pieces of the HUD (memoised: they only change on locks / holds, not on every move)
// ---------------------------------------------------------------------------

const RequirementChips = memo(function RequirementChips(
  { requirements, ledger }: { requirements: Requirements; ledger: Ledger },
) {
  const counts = ledgerCounts(ledger);
  const chips: ReactNode[] = [];
  for (let i = 0; i < 7; i++) {
    const need = requirements[i] ?? 0;
    if (need <= 0) continue;
    const met = counts[i] >= need;
    chips.push(
      <span key={i} className={`pp-chip${met ? ' met' : ''}`}>
        {REQUIREMENT_NAMES[i]} <b>{counts[i]}/{need}</b>
      </span>,
    );
  }
  if (requirements[7]) chips.push(<span key="nohold" className="pp-chip tag">no hold</span>);
  if (chips.length === 0) chips.push(<span key="none" className="pp-chip tag">place every piece</span>);
  return <>{chips}</>;
});

const NextQueue = memo(function NextQueue({ pieces }: { pieces: number[] }) {
  const big = pieces.slice(0, 5);
  const rest = pieces.slice(5);
  return (
    <div className="pp-next">
      <div className="pp-next-big">
        {big.map((p, i) => (
          <div key={i} className="pp-next-item">
            <PieceMini pieceId={p} />
          </div>
        ))}
        {big.length === 0 && <div className="pp-next-empty">—</div>}
      </div>
      {rest.length > 0 && (
        <div className="pp-next-rest" title={`${rest.length} more`}>
          {rest.map((p, i) => <PieceMini key={i} pieceId={p} />)}
        </div>
      )}
    </div>
  );
});

function calloutLines(e: LockEvent): { text: string; kind: string }[] {
  const out: { text: string; kind: string }[] = [];
  const n = ['', 'SINGLE', 'DOUBLE', 'TRIPLE', 'TETRIS'];
  if (e.tspin) out.push({ text: e.lines ? `T-SPIN ${n[e.lines]}` : 'T-SPIN', kind: 'spin' });
  else if (e.lines === 4) out.push({ text: 'TETRIS', kind: 'tetris' });
  else if (e.lines > 0) out.push({ text: n[e.lines], kind: 'plain' });
  if (e.b2b) out.push({ text: 'B2B', kind: 'b2b' });
  if (e.combo >= 2) out.push({ text: `COMBO ${e.combo}`, kind: 'combo' });
  if (e.pc) out.push({ text: 'PERFECT CLEAR', kind: 'pc' });
  if (out.length && e.attack > 0) out.push({ text: `+${e.attack} ATK`, kind: 'atk' });
  return out;
}

const LockCallout = memo(function LockCallout({ lock }: { lock: { seq: number; event: LockEvent } | null }) {
  const lines = lock ? calloutLines(lock.event) : [];
  return (
    <div className="pp-callout" aria-live="polite">
      {lines.length > 0 && (
        <div key={lock!.seq} className="pp-callout-inner">
          {lines.map(l => <div key={l.text} className={`pp-callout-line ${l.kind}`}>{l.text}</div>)}
        </div>
      )}
    </div>
  );
});

function formatTime(ms: number): string {
  const s = ms / 1000;
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${m}:${rest < 10 ? '0' : ''}${rest.toFixed(1)}`;
}

function Timer({ startedAt, finishedAt }: { startedAt: number | null; finishedAt: number | null }) {
  const [now, setNow] = useState(() => performance.now());
  const running = startedAt != null && finishedAt == null;
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(id);
  }, [running]);
  if (startedAt == null) return <>{formatTime(0)}</>;
  return <>{formatTime(Math.max(0, (finishedAt ?? Math.max(now, startedAt)) - startedAt))}</>;
}

const HINTS: [BindingAction[], string][] = [
  [['left', 'right'], 'move'],
  [['softDrop'], 'soft'],
  [['place'], 'drop'],
  [['rotateCw', 'rotateCcw', 'rotate180'], 'rotate'],
  [['hold'], 'hold'],
  [['undo'], 'undo'],
  [['restart'], 'restart'],
];

const ControlsHint = memo(function ControlsHint({ bindings, noHold }: { bindings: Bindings; noHold: boolean }) {
  const items = useMemo(() => HINTS
    .filter(([acts]) => !(noHold && acts[0] === 'hold'))
    .map(([acts, label]) => {
      const keys = acts.map(a => bindings[a]).filter(Boolean).map(keyLabelShort);
      return keys.length ? { keys: keys.join(' '), label } : null;
    })
    .filter((x): x is { keys: string; label: string } => x != null), [bindings, noHold]);
  return (
    <div className="pp-hint">
      {items.map(it => (
        <span key={it.label} className="pp-hint-item"><kbd>{it.keys}</kbd> {it.label}</span>
      ))}
    </div>
  );
});
