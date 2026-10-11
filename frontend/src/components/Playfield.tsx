// Canvas playfield: board + subtle grid, ghost, active piece, and the spawn row (row 0) drawn as
// a buffer strip above the well's top edge. Pure renderer — draws from engine data, no per-cell
// React elements. Sharp at any devicePixelRatio: everything is laid out in device pixels.
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { COLS, ROWS, pieceCells, type ActivePiece, type Board, type CellPos } from '../game/engine';
import { PIECE_COLORS, mix, withAlpha } from '../game/colors';
import './Playfield.css';

export interface PlayfieldMark {
  row: number;
  col: number;
  /** cell value whose colour to use (0 = "erase" preview) */
  value: number;
  kind: 'preview' | 'refuse';
}

export type CellPointerKind = 'down' | 'move' | 'up' | 'leave';

interface PlayfieldProps {
  board: Board;
  active?: ActivePiece | null;
  /** row to draw the active piece's ghost at (null / omitted = no ghost) */
  ghostRow?: number | null;
  /** CSS pixels per cell */
  cellSize: number;
  /** wash everything out (topped out / finished) */
  faded?: boolean;
  /** editor overlays (hover previews, refused cells) */
  marks?: readonly PlayfieldMark[];
  className?: string;
  /** pointer events mapped to board cells (null = outside the 10 columns / 21 rows) */
  onCellPointer?: (kind: CellPointerKind, cell: CellPos | null, e: PointerEvent<HTMLCanvasElement>) => void;
  /** accessible description */
  label?: string;
}

interface Metrics {
  dpr: number;
  /** device px */
  cell: number;
  frame: number;
  line: number;
  width: number;
  height: number;
}

function metricsFor(cellSize: number, dpr: number): Metrics {
  const cell = Math.max(4, Math.round(cellSize * dpr));
  const frame = Math.max(1, Math.round(2 * dpr));
  const line = Math.max(1, Math.round(dpr));
  return { dpr, cell, frame, line, width: COLS * cell + 2 * frame, height: ROWS * cell + frame };
}

function useDevicePixelRatio(): number {
  const [dpr, setDpr] = useState(() => (typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1));
  useEffect(() => {
    const mq = window.matchMedia(`(resolution: ${dpr}dppx)`);
    const onChange = () => setDpr(window.devicePixelRatio || 1);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [dpr]);
  return dpr;
}

interface Theme {
  well: string;
  border: string;
  spawn: string;
  grid: string;
}

function readTheme(el: Element): Theme {
  const cs = getComputedStyle(el);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    well: v('--bg-panel', '#ffffff'),
    border: v('--border', '#e6d8d2'),
    spawn: v('--pink-soft', '#ffbdde'),
    grid: 'rgba(0, 0, 0, 0.07)',
  };
}

// mix() is cheap but runs a lot per frame; memoise the derived shades per colour
const shadeCache = new Map<string, { light: string; shade: string; edge: string; ghost: string; glow: string; ghostEdge: string }>();
function shades(color: string) {
  let s = shadeCache.get(color);
  if (!s) {
    s = {
      light: mix(color, 0.5, '#ffffff'),
      shade: mix(color, 0.4),
      edge: mix(color, 0.3),
      ghost: withAlpha(color, 0.26),
      ghostEdge: mix(color, 0.3),
      glow: withAlpha(color, 0.45),
    };
    shadeCache.set(color, s);
  }
  return s;
}

function draw(canvas: HTMLCanvasElement, m: Metrics, theme: Theme, p: PlayfieldProps) {
  if (canvas.width !== m.width) canvas.width = m.width;
  if (canvas.height !== m.height) canvas.height = m.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { cell, frame, line } = m;
  const wellTop = cell; // row 1 starts one cell down; row 0 is the spawn strip above
  const wellW = COLS * cell;
  const wellH = (ROWS - 1) * cell;
  const x0 = (col: number) => frame + col * cell;
  const y0 = (row: number) => row * cell;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, m.width, m.height);

  // spawn strip: a faint tint, no grid, outside the well
  ctx.fillStyle = withAlphaSafe(theme.spawn, 0.22);
  ctx.fillRect(frame, 0, wellW, cell);
  // dotted guide along its top so it reads as "buffer", not as page background
  ctx.fillStyle = withAlphaSafe(theme.spawn, 0.9);
  const dot = line, gap = Math.max(3, Math.round(cell / 6));
  for (let x = frame; x < frame + wellW; x += dot + gap) ctx.fillRect(x, 0, dot, line);

  // well
  ctx.fillStyle = theme.well;
  ctx.fillRect(frame, wellTop, wellW, wellH);
  ctx.fillStyle = theme.grid;
  for (let c = 1; c < COLS; c++) ctx.fillRect(x0(c), wellTop, line, wellH);
  for (let r = 2; r < ROWS; r++) ctx.fillRect(frame, y0(r), wellW, line);

  // walls + floor; the top edge is a thinner line so the spawn strip sits "above" the field
  ctx.fillStyle = theme.border;
  ctx.fillRect(0, wellTop, frame, wellH + frame);
  ctx.fillRect(frame + wellW, wellTop, frame, wellH + frame);
  ctx.fillRect(0, wellTop + wellH, m.width, frame);
  ctx.fillRect(frame, wellTop, wellW, line);

  const block = (row: number, col: number, color: string) => {
    const x = x0(col), y = y0(row), s = cell, sh = shades(color);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, s, s);
    ctx.fillStyle = sh.light;
    ctx.fillRect(x, y, s, line);
    ctx.fillStyle = sh.shade;
    ctx.fillRect(x, y + s - 2 * line, s, line);
    ctx.fillStyle = sh.edge;
    ctx.fillRect(x + s - line, y, line, s);
    ctx.fillRect(x, y + s - line, s, line);
  };

  // settled cells
  const board = p.board;
  for (let r = 0; r < ROWS; r++) {
    const rowCells = board[r];
    if (!rowCells) continue;
    for (let c = 0; c < COLS; c++) {
      const v = rowCells[c];
      if (v) block(r, c, PIECE_COLORS[v] ?? PIECE_COLORS[8]);
    }
  }

  const a = p.active;
  if (a) {
    const color = PIECE_COLORS[a.piece];
    const sh = shades(color);
    const cells = pieceCells(a.piece, a.rot, a.row, a.col);

    // ghost (skipping cells the piece itself covers)
    if (p.ghostRow != null && p.ghostRow !== a.row) {
      const own = new Set(cells.map(c => c.row * COLS + c.col));
      ctx.save();
      ctx.lineWidth = line;
      ctx.setLineDash([Math.max(2, Math.round(2 * m.dpr)), Math.max(2, Math.round(2 * m.dpr))]);
      for (const g of pieceCells(a.piece, a.rot, p.ghostRow, a.col)) {
        if (own.has(g.row * COLS + g.col)) continue;
        const x = x0(g.col), y = y0(g.row);
        ctx.fillStyle = sh.ghost;
        ctx.fillRect(x, y, cell, cell);
        ctx.strokeStyle = sh.ghostEdge;
        ctx.strokeRect(x + line / 2, y + line / 2, cell - line, cell - line);
      }
      ctx.restore();
    }

    // active piece with a soft glow
    ctx.save();
    ctx.shadowColor = sh.glow;
    ctx.shadowBlur = 6 * m.dpr;
    ctx.fillStyle = color;
    for (const c of cells) ctx.fillRect(x0(c.col), y0(c.row), cell, cell);
    ctx.restore();
    for (const c of cells) block(c.row, c.col, color);
  }

  if (p.marks) {
    for (const mk of p.marks) {
      const x = x0(mk.col), y = y0(mk.row);
      if (mk.kind === 'preview') {
        if (mk.value) {
          ctx.fillStyle = withAlpha(PIECE_COLORS[mk.value] ?? PIECE_COLORS[8], 0.4);
          ctx.fillRect(x, y, cell, cell);
        } else {
          ctx.fillStyle = 'rgba(255, 189, 222, 0.35)';
          ctx.fillRect(x, y, cell, cell);
        }
      } else {
        ctx.fillStyle = 'rgba(214, 51, 108, 0.22)';
        ctx.fillRect(x, y, cell, cell);
        ctx.strokeStyle = 'rgba(214, 51, 108, 0.85)';
        ctx.lineWidth = Math.max(1, Math.round(1.5 * m.dpr));
        const i = Math.round(cell * 0.28);
        ctx.beginPath();
        ctx.moveTo(x + i, y + i); ctx.lineTo(x + cell - i, y + cell - i);
        ctx.moveTo(x + cell - i, y + i); ctx.lineTo(x + i, y + cell - i);
        ctx.stroke();
      }
    }
  }

  if (p.faded) {
    ctx.fillStyle = withAlphaSafe(theme.well, 0.55);
    ctx.fillRect(0, 0, m.width, m.height);
  }
}

// theme colours come from CSS and may not be hex; only hex gets alpha applied, others pass through
function withAlphaSafe(color: string, alpha: number): string {
  return /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(color) ? withAlpha(color, alpha) : color;
}

function Playfield(props: PlayfieldProps) {
  const { cellSize, className, onCellPointer, label } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const themeRef = useRef<Theme | null>(null);
  const dpr = useDevicePixelRatio();
  const m = useMemo(() => metricsFor(cellSize, dpr), [cellSize, dpr]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!themeRef.current) themeRef.current = readTheme(canvas);
    draw(canvas, m, themeRef.current, props);
  });

  function cellAt(e: PointerEvent<HTMLCanvasElement>): CellPos | null {
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = m.width / rect.width, sy = m.height / rect.height;
    const x = (e.clientX - rect.left) * sx - m.frame;
    const y = (e.clientY - rect.top) * sy;
    const col = Math.floor(x / m.cell), row = Math.floor(y / m.cell);
    if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return null;
    return { row, col };
  }

  const handlers = onCellPointer ? {
    onPointerDown: (e: PointerEvent<HTMLCanvasElement>) => onCellPointer('down', cellAt(e), e),
    onPointerMove: (e: PointerEvent<HTMLCanvasElement>) => onCellPointer('move', cellAt(e), e),
    onPointerUp: (e: PointerEvent<HTMLCanvasElement>) => onCellPointer('up', cellAt(e), e),
    onPointerCancel: (e: PointerEvent<HTMLCanvasElement>) => onCellPointer('up', null, e),
    onPointerLeave: (e: PointerEvent<HTMLCanvasElement>) => onCellPointer('leave', null, e),
    onContextMenu: (e: MouseEvent) => e.preventDefault(),
  } : {};

  return (
    <canvas
      ref={canvasRef}
      className={`playfield${onCellPointer ? ' interactive' : ''}${className ? ` ${className}` : ''}`}
      style={{ width: m.width / m.dpr, height: m.height / m.dpr }}
      role="img"
      aria-label={label ?? 'tetris board'}
      {...handlers}
    />
  );
}

export default memo(Playfield);
