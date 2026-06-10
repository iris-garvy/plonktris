import { PIECE_TYPES, TETROMINOES } from '../tetrisUtils';

// Renders a piece cropped to its bounding box so it centers cleanly in flex parents.
export default function PieceMini({ pieceId, size = 14, dimmed = false }) {
  const shape = pieceId != null ? TETROMINOES[pieceId]?.[0] : null;
  const color = pieceId != null ? PIECE_TYPES[pieceId]?.color : null;

  if (!shape) {
    return (
      <div
        className="piece-mini-empty"
        style={{ width: size * 2, height: size * 2, opacity: dimmed ? 0.3 : 1 }}
      />
    );
  }

  const xs = shape.map(([dx]) => dx);
  const ys = shape.map(([, dy]) => dy);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const filled = new Set(shape.map(([dx, dy]) => `${dx - minX},${dy - minY}`));

  return (
    <div
      className="piece-mini"
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${w}, ${size}px)`,
        gridTemplateRows:    `repeat(${h}, ${size}px)`,
        gap: 1,
        opacity: dimmed ? 0.3 : 1,
      }}
    >
      {Array.from({ length: h }, (_, dy) =>
        Array.from({ length: w }, (_, dx) => {
          const on = filled.has(`${dx},${dy}`);
          return (
            <div
              key={`${dy}-${dx}`}
              style={on ? {
                background: color,
                border: `1px solid color-mix(in srgb, ${color} 60%, white)`,
                borderRadius: 1,
              } : { borderRadius: 1 }}
            />
          );
        })
      )}
    </div>
  );
}
