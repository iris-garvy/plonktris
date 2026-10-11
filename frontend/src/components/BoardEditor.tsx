// Board editor for puzzle creation: paint cells with a palette, erase with right-drag, shift-click
// for a garbage row, undo / redo, clear — and stamp the queue's pieces with the normal game keys.
// Never emits a board with a full row or anything in the hidden spawn row.
import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore,
  type CSSProperties, type PointerEvent, type ReactNode,
} from 'react';
import { Eraser, Redo2, Rows3, Trash2, Undo2 } from 'lucide-react';
import { Action, COLS, dropRow, emptyBoard, PIECE_NAMES, type Board, type CellPos } from '../game/engine';
import { PIECE_COLORS } from '../game/colors';
import { InputController, isTypingTarget } from '../game/input';
import { StampFlow } from '../game/stamp';
import type { GameState } from '../game/engine';
import { keyLabelShort, type Bindings, type Handling } from '../keybindings';
import Playfield, { type CellPointerKind, type PlayfieldMark } from './Playfield';
import PieceMini from './PieceMini';
import { useCellSize } from './useCellSize';
import './BoardEditor.css';

export interface BoardEditorProps {
  board: Board;
  /** every edit; boards passed here never contain full rows or anything in row 0 */
  onChange: (board: Board) => void;
  /** the puzzle's queue (client ids 1-7), e.g. for stamping pieces with the keyboard */
  queue: number[];
  bindings: Bindings;
  handling: Handling;
  /** rendered beside the board (left column, under the hold/tools area) */
  sidePanel?: ReactNode;
  /** ignore keyboard input (e.g. while typing in the puzzle name field) */
  disabled?: boolean;
}

/** palette order: garbage first, then I O T S Z L J */
const PALETTE = [8, 1, 2, 3, 4, 5, 6, 7];
const HISTORY_LIMIT = 200;

function sameBoard(a: Board | null, b: Board | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let r = 0; r < a.length; r++) {
    for (let c = 0; c < COLS; c++) if (a[r][c] !== b[r][c]) return false;
  }
  return true;
}

function isEmptyBoard(b: Board): boolean {
  return b.every(r => r.every(v => v === 0));
}

/** Sets one cell; null = refused (would complete the row). Returns `b` itself when unchanged. */
function setCell(b: Board, row: number, col: number, value: number): Board | null {
  if (b[row][col] === value) return b;
  if (value !== 0 && b[row].every((v, c) => c === col || v !== 0)) return null;
  const next = b.map(r => r.slice());
  next[row][col] = value;
  return next;
}

/** Garbage-row tool: fill the row with `value` except `hole` (value 0 clears the row). */
function fillRow(b: Board, row: number, hole: number, value: number): Board {
  const line = Array.from({ length: COLS }, (_, c) => (value === 0 || c === hole ? 0 : value));
  if (b[row].every((v, c) => v === line[c])) return b;
  const next = b.map(r => r.slice());
  next[row] = line;
  return next;
}

/** An undo / redo step: the board to go back to, and for stamps the piece flow as it was. */
interface HistoryEntry {
  board: Board;
  /** undefined = a paint edit (the stamping flow is left alone) */
  flow?: GameState | null;
}

interface Stroke {
  value: number;
  rowMode: boolean;
  before: Board;
  changed: boolean;
  last: string | null;
}

export default function BoardEditor({
  board, onChange, queue, bindings, handling, sidePanel, disabled,
}: BoardEditorProps) {
  const [paint, setPaint] = useState(8); // 0 = eraser
  const [rowTool, setRowTool] = useState(false);
  const [hist, setHist] = useState<{ undo: HistoryEntry[]; redo: HistoryEntry[] }>({ undo: [], redo: [] });
  const [hover, setHover] = useState<{ cell: CellPos; shift: boolean } | null>(null);
  const [refused, setRefused] = useState<{ cells: CellPos[]; id: number } | null>(null);

  // latest board (props, or what we just emitted before the parent re-rendered)
  const boardRef = useRef(board);
  const emitted = useRef<Board | null>(null);
  const histRef = useRef(hist);
  const stroke = useRef<Stroke | null>(null);
  const onChangeRef = useRef(onChange);
  useLayoutEffect(() => {
    onChangeRef.current = onChange;
    histRef.current = hist;
  });

  // a board we didn't produce (a different puzzle loaded) → forget the edit history
  useLayoutEffect(() => {
    boardRef.current = board;
    if (emitted.current && !sameBoard(board, emitted.current)) {
      emitted.current = null;
      setHist({ undo: [], redo: [] });
    }
  }, [board]);

  const emit = useCallback((next: Board) => {
    boardRef.current = next;
    emitted.current = next;
    onChangeRef.current(next);
  }, []);

  const pushHistory = useCallback((before: Board, flow?: GameState | null) => {
    const next = { undo: [...histRef.current.undo, { board: before, flow }].slice(-HISTORY_LIMIT), redo: [] };
    histRef.current = next;
    setHist(next);
  }, []);

  // set below, once the stamping flow exists (undo / redo of a stamp also rewinds the piece flow)
  const flowRef = useRef<StampFlow | null>(null);

  const travel = useCallback((from: 'undo' | 'redo') => {
    const h = histRef.current;
    const stack = h[from];
    if (!stack.length) return;
    const entry = stack[stack.length - 1];
    const flow = flowRef.current;
    const back: HistoryEntry = {
      board: boardRef.current,
      flow: entry.flow !== undefined ? flow?.getSnapshot() ?? null : undefined,
    };
    const next = from === 'undo'
      ? { undo: h.undo.slice(0, -1), redo: [...h.redo, back] }
      : { undo: [...h.undo, back], redo: h.redo.slice(0, -1) };
    histRef.current = next;
    setHist(next);
    emit(entry.board);
    if (entry.flow !== undefined) flow?.restore(entry.flow);
  }, [emit]);
  const undo = useCallback(() => travel('undo'), [travel]);
  const redo = useCallback(() => travel('redo'), [travel]);

  const clear = useCallback(() => {
    const b = boardRef.current;
    if (isEmptyBoard(b)) return;
    pushHistory(b);
    emit(emptyBoard());
  }, [emit, pushHistory]);

  const refuseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashRefused = useCallback((cells: CellPos[]) => {
    if (refuseTimer.current) clearTimeout(refuseTimer.current);
    setRefused({ cells, id: Date.now() });
    refuseTimer.current = setTimeout(() => setRefused(null), 900);
  }, []);
  useEffect(() => () => { if (refuseTimer.current) clearTimeout(refuseTimer.current); }, []);

  // --- painting --------------------------------------------------------------

  function applyAt(cell: CellPos) {
    const s = stroke.current;
    if (!s || cell.row === 0) return;
    const k = `${cell.row},${cell.col}`;
    if (s.last === k) return;
    s.last = k;
    const b = boardRef.current;
    const next = s.rowMode ? fillRow(b, cell.row, cell.col, s.value) : setCell(b, cell.row, cell.col, s.value);
    if (next == null) {
      flashRefused([cell]);
      return;
    }
    if (next === b) return;
    s.changed = true;
    emit(next);
  }

  function onCellPointer(kind: CellPointerKind, cell: CellPos | null, e: PointerEvent<HTMLCanvasElement>) {
    if (kind === 'down') {
      if (!cell || cell.row === 0 || (e.button !== 0 && e.button !== 2)) return;
      e.preventDefault();
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* synthetic / inactive pointer */ }
      const erase = e.button === 2 || paint === 0;
      const rowMode = rowTool || e.shiftKey;
      const b = boardRef.current;
      let value = erase ? 0 : paint;
      // clicking a cell that already has this colour starts an erasing stroke (toggle)
      if (!rowMode && !erase && b[cell.row][cell.col] === paint) value = 0;
      stroke.current = { value, rowMode, before: b, changed: false, last: null };
      setHover(null);
      applyAt(cell);
      return;
    }
    if (kind === 'move') {
      if (e.pointerType === 'mouse' && !stroke.current) {
        setHover(h => (cell && cell.row > 0
          ? (h && h.cell.row === cell.row && h.cell.col === cell.col && h.shift === e.shiftKey ? h : { cell, shift: e.shiftKey })
          : null));
      }
      if (stroke.current && cell) applyAt(cell);
      return;
    }
    if (kind === 'up') {
      const s = stroke.current;
      stroke.current = null;
      if (s?.changed) pushHistory(s.before);
      return;
    }
    if (kind === 'leave') setHover(null);
  }

  // --- keyboard stamping -------------------------------------------------------

  const queueKey = queue.join(',');
  const [flowState, setFlowState] = useState(() => ({ key: queueKey, flow: new StampFlow(board, queue) }));
  let flow = flowState.flow;
  if (flowState.key !== queueKey) {
    flow = new StampFlow(board, queue);
    setFlowState({ key: queueKey, flow });
  }
  const stampState = useSyncExternalStore(flow.subscribe, flow.getSnapshot);
  useLayoutEffect(() => {
    flowRef.current = flow;
    flow.setBoard(board);
  }, [flow, board]);

  const [ctrl] = useState(() => new InputController(null, { bindings, handling }));
  useEffect(() => ctrl.attach(window), [ctrl]);
  useEffect(() => { ctrl.setBindings(bindings); }, [ctrl, bindings]);
  useEffect(() => { ctrl.setHandling(handling); }, [ctrl, handling]);
  useEffect(() => { ctrl.setDisabled(!!disabled); }, [ctrl, disabled]);
  useEffect(() => {
    ctrl.setTarget({
      act: action => {
        if (action !== Action.Hard) return flow.act(action);
        const before = flow.getSnapshot();
        const r = flow.stamp();
        if (!r) return false;
        if (!r.ok) {
          flashRefused(r.cells);
          return false;
        }
        pushHistory(boardRef.current, before);
        emit(r.board);
        return true;
      },
      undo,
      restart: () => flow.restart(boardRef.current),
    });
  }, [ctrl, flow, undo, emit, pushHistory, flashRefused]);

  // redo + palette shortcuts (capture phase, so ⌘⇧Z doesn't also reach the controller as ⌘Z)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (disabled || e.repeat || isTypingTarget(e.target)) return;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (mod && ((k === 'z' && e.shiftKey) || k === 'y')) {
        e.preventDefault();
        e.stopImmediatePropagation();
        redo();
        return;
      }
      if (mod || e.altKey) return;
      if (Object.values(bindings).includes(k)) return; // the key is a game control
      if (k >= '1' && k <= '8') setPaint(PALETTE[(Number(k) % 8)] ?? 8);
      else if (k === '0') setPaint(0);
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [disabled, bindings, redo]);

  // --- layout + drawing ---------------------------------------------------------

  // left column (3.4) + gap (0.4) + board (10)
  const rootRef = useRef<HTMLDivElement>(null);
  const cell = useCellSize(rootRef, { units: 13.8, extra: 6, rows: 24.5 });

  const active = stampState?.active ?? null;
  const ghost = active ? dropRow(board, active.piece, active.rot, active.row, active.col) : null;

  const marks = useMemo(() => {
    const out: PlayfieldMark[] = [];
    if (hover) {
      const { row, col } = hover.cell;
      if (rowTool || hover.shift) {
        const value = paint === 0 ? 0 : paint;
        for (let c = 0; c < COLS; c++) if (c !== col || value === 0) out.push({ row, col: c, value, kind: 'preview' });
      } else if (board[row][col] === 0 || paint === 0) {
        out.push({ row, col, value: paint, kind: 'preview' });
      }
    }
    if (refused) for (const c of refused.cells) out.push({ ...c, value: 0, kind: 'refuse' });
    return out;
  }, [hover, rowTool, paint, board, refused]);

  const remaining = stampState ? stampState.queue.slice(stampState.next, stampState.next + 5) : [];
  const k = (a: keyof Bindings) => (bindings[a] ? keyLabelShort(bindings[a]) : '');

  return (
    <div ref={rootRef} className="be" style={{ '--cell': `${cell}px` } as CSSProperties}>
      <div className="be-toolbar" role="toolbar" aria-label="paint colours">
        {PALETTE.map(id => (
          <button
            key={id}
            type="button"
            className={`be-swatch${paint === id ? ' active' : ''}`}
            style={{ '--swatch': PIECE_COLORS[id] } as CSSProperties}
            title={`${id === 8 ? 'garbage' : PIECE_NAMES[id]} (${id})`}
            aria-label={id === 8 ? 'garbage' : `${PIECE_NAMES[id]} colour`}
            aria-pressed={paint === id}
            onClick={() => setPaint(id)}
          />
        ))}
        <button
          type="button"
          className={`be-swatch eraser${paint === 0 ? ' active' : ''}`}
          title="eraser (0) — or right-drag"
          aria-label="eraser"
          aria-pressed={paint === 0}
          onClick={() => setPaint(0)}
        >
          <Eraser />
        </button>
      </div>

      <div className="be-label be-hold-label">{queue.length ? 'hold' : ''}</div>
      <div className="be-left">
        {queue.length > 0 && (
          <>
            <div className="be-hold" title="stamping: hold">
              {stampState?.hold != null && <PieceMini pieceId={stampState.hold} />}
            </div>
            <div className="be-next" title="stamping: next pieces">
              {remaining.map((p, i) => <PieceMini key={i} pieceId={p} />)}
            </div>
          </>
        )}
        <div className="be-tools">
          <button
            type="button"
            className={`be-tool${rowTool ? ' active' : ''}`}
            onClick={() => setRowTool(t => !t)}
            aria-pressed={rowTool}
            title="garbage row: click fills the row except that cell (or shift-click)"
          >
            <Rows3 /><span>row</span>
          </button>
          <button type="button" className="be-tool" onClick={undo} disabled={!hist.undo.length} title={`undo (${k('undo') || '⌘Z'})`}>
            <Undo2 /><span>undo</span>
          </button>
          <button type="button" className="be-tool" onClick={redo} disabled={!hist.redo.length} title="redo (⌘⇧Z)">
            <Redo2 /><span>redo</span>
          </button>
          <button type="button" className="be-tool danger" onClick={clear} disabled={isEmptyBoard(board)} title="clear the board">
            <Trash2 /><span>clear</span>
          </button>
        </div>
        {sidePanel != null && <div className="be-side">{sidePanel}</div>}
      </div>

      <div className="be-board">
        <Playfield
          board={board}
          active={active}
          ghostRow={ghost}
          cellSize={cell}
          marks={marks}
          onCellPointer={onCellPointer}
          label="board editor"
        />
        {refused && (
          <div key={refused.id} className="be-refused">a puzzle board can't have full rows</div>
        )}
      </div>

      <div className="be-foot">
        <span><kbd>drag</kbd> paint</span>
        <span><kbd>right-drag</kbd> erase</span>
        <span><kbd>shift</kbd>+click garbage row</span>
        <span><kbd>{k('undo') || '⌘Z'}</kbd> undo</span>
        {queue.length > 0 && (
          <span><kbd>{[k('left'), k('right')].filter(Boolean).join(' ')} {k('place')}</kbd> stamp pieces</span>
        )}
      </div>
    </div>
  );
}

