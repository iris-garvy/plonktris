import { SHAPES } from '../game/engine';
import { PIECE_COLORS, mix } from '../game/colors';

interface PieceMiniProps {
  pieceId: number | null;
  /** px per cell; a parent can override with the --mini-cell CSS variable */
  size?: number;
  dimmed?: boolean;
}

// Renders a piece (spawn orientation) cropped to its bounding box so it centers cleanly in flex
// parents. One small SVG per piece — cheap enough to render a whole 30-piece queue.
export default function PieceMini({ pieceId, size = 14, dimmed = false }: PieceMiniProps) {
  const shape = pieceId != null ? SHAPES[pieceId]?.[0] : null;
  const cell = `var(--mini-cell, ${size}px)`;

  if (!shape) {
    return (
      <div
        className="piece-mini-empty"
        style={{
          width: `calc(${cell} * 2)`,
          height: `calc(${cell} * 2)`,
          opacity: dimmed ? 0.3 : 1,
          background: 'var(--bg-raised)',
          border: '1px solid var(--border)',
          flexShrink: 0,
        }}
      />
    );
  }

  const color = PIECE_COLORS[pieceId!];
  const edge = mix(color, 0.3);
  const xs = shape.map(([dx]) => dx);
  const ys = shape.map(([, dy]) => dy);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const w = Math.max(...xs) - minX + 1;
  const h = Math.max(...ys) - minY + 1;
  const g = 0.06; // gap between cells, in cells

  return (
    <svg
      className="piece-mini"
      viewBox={`0 0 ${w} ${h}`}
      style={{
        width: `calc(${cell} * ${w})`,
        height: `calc(${cell} * ${h})`,
        opacity: dimmed ? 0.3 : 1,
        display: 'block',
        flexShrink: 0,
      }}
      aria-hidden="true"
    >
      {shape.map(([dx, dy]) => (
        <rect
          key={`${dx},${dy}`}
          x={dx - minX + g}
          y={dy - minY + g}
          width={1 - 2 * g}
          height={1 - 2 * g}
          fill={color}
          stroke={edge}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}
